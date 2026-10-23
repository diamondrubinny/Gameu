package net.rubinny.gameu.server

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.timeout
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import net.rubinny.gameu.AssetPolicy
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration.Companion.seconds

/** Reads bundled web assets (Android AssetManager in the app, files in tests). */
fun interface AssetSource {
    fun open(assetPath: String): InputStream?
}

/** Socket events forwarded to the page, where the room logic (ControllerSession) runs. */
interface PhoneEvents {
    fun onOpen(id: Int, ip: String)
    fun onText(id: Int, text: String)
    /** Binary or fragmented frames: always invalid for the protocol. */
    fun onInvalidFrame(id: Int)
    fun onClosed(id: Int)
}

/**
 * HTTP + WebSocket server for phone controllers. Serves only the controller and legal
 * pages; the TV screen itself is never reachable over the network.
 */
class PhoneServer(
    private val assets: AssetSource,
    private val events: PhoneEvents,
    private val limiter: ConnectionLimiter = ConnectionLimiter(),
) {
    private var server: EmbeddedServer<*, *>? = null
    private val sessions = ConcurrentHashMap<Int, DefaultWebSocketServerSession>()
    private val nextId = AtomicInteger(1)

    @Volatile
    var port: Int = -1
        private set

    /** Starts on the first free port of [ports] (use 0 for an ephemeral port). Returns the bound port. */
    @Synchronized
    fun start(ports: Iterable<Int> = 8080..8090): Int {
        check(server == null) { "already started" }
        var lastError: Throwable? = null
        for (p in ports) {
            val s = embeddedServer(CIO, port = p, host = "0.0.0.0") { module() }
            try {
                s.start(wait = false)
                server = s
                port = runBlocking { s.engine.resolvedConnectors().first().port }
                return port
            } catch (e: Throwable) {
                lastError = e
                runCatching { s.stop(0, 0) }
            }
        }
        throw IllegalStateException("No free port for the phone server", lastError)
    }

    @Synchronized
    fun stop() {
        closeAll(CloseReason.Codes.GOING_AWAY.code, "console stopped")
        server?.stop(200, 1000)
        server = null
        port = -1
    }

    val isRunning: Boolean get() = server != null

    /** Sends a text message to one phone; drops the connection if its queue is full. */
    fun send(id: Int, text: String) {
        val s = sessions[id] ?: return
        if (s.outgoing.trySend(Frame.Text(text)).isFailure) close(id, CloseReason.Codes.TRY_AGAIN_LATER.code, "slow consumer")
    }

    fun close(id: Int, code: Short, reason: String) {
        val s = sessions[id] ?: return
        s.launch { s.close(CloseReason(code, reason.take(100))) }
    }

    fun closeAll(code: Short, reason: String) {
        for (id in sessions.keys.toList()) close(id, code, reason)
    }

    private fun Application.module() {
        install(WebSockets) {
            pingPeriod = 15.seconds
            timeout = 15.seconds
            maxFrameSize = MAX_FRAME_BYTES
            masking = false
        }

        intercept(ApplicationCallPipeline.Plugins) {
            val host = call.request.headers["Host"]
            if (!HostRules.isAllowedHost(host)) {
                call.respondText("Misdirected request", status = HttpStatusCode(421, "Misdirected Request"))
                finish()
                return@intercept
            }
            if (call.request.path() == WS_PATH && !HostRules.isSameOrigin(call.request.headers["Origin"], host)) {
                call.respondText("Forbidden", status = HttpStatusCode.Forbidden)
                finish()
            }
        }

        routing {
            get("/") { call.respondRedirect("/c") }
            get("/favicon.ico") { call.respondText("", status = HttpStatusCode.NoContent) }

            webSocket(WS_PATH) {
                val ip = call.request.local.remoteAddress
                if (!limiter.tryAcquire(ip)) {
                    close(CloseReason(CloseReason.Codes.TRY_AGAIN_LATER, "busy"))
                    return@webSocket
                }
                val id = nextId.getAndIncrement()
                sessions[id] = this
                try {
                    events.onOpen(id, ip)
                    for (frame in incoming) {
                        if (frame is Frame.Text && frame.fin) events.onText(id, frame.readText())
                        else if (frame is Frame.Text || frame is Frame.Binary) events.onInvalidFrame(id)
                    }
                } finally {
                    sessions.remove(id)
                    limiter.release(ip)
                    events.onClosed(id)
                }
            }

            get("{path...}") {
                val path = call.request.path()
                val urlPath = if (path == "/c" || path == "/c/") "/c/index.html" else path
                if (call.request.httpMethod.value != "GET" || !AssetPolicy.isNetworkPath(urlPath)) return@get notFound()
                val assetPath = AssetPolicy.resolve(urlPath) ?: return@get notFound()
                val bytes = assets.open(assetPath)?.use { it.readBytes() } ?: return@get notFound()
                respondAsset(urlPath, assetPath, bytes, HttpStatusCode.OK)
            }
        }
    }

    private suspend fun io.ktor.server.routing.RoutingContext.notFound() {
        val page = AssetPolicy.resolve("/404.html")?.let { assets.open(it)?.use { s -> s.readBytes() } }
        if (page != null) respondAsset("/404.html", "www/404.html", page, HttpStatusCode.NotFound)
        else call.respondText("Not found", status = HttpStatusCode.NotFound)
    }

    private suspend fun io.ktor.server.routing.RoutingContext.respondAsset(urlPath: String, assetPath: String, bytes: ByteArray, status: HttpStatusCode) {
        val mime = AssetPolicy.mimeFor(assetPath) ?: "application/octet-stream"
        val charset = AssetPolicy.encodingFor(mime)
        for ((k, v) in AssetPolicy.networkHeadersFor(urlPath)) call.response.header(k, v)
        call.respondBytes(bytes, ContentType.parse(if (charset != null) "$mime; charset=$charset" else mime), status)
    }

    companion object {
        const val WS_PATH = "/ws/controller"
        const val MAX_FRAME_BYTES = 8L * 1024
    }
}
