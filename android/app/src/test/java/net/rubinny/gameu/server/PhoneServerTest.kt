package net.rubinny.gameu.server

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class PhoneServerTest {
    private val files = mapOf(
        "www/c/index.html" to "<!doctype html><title>controller</title>",
        "www/c/controller.js" to "console.log(1)",
        "www/legal/privacy.html" to "<!doctype html><title>privacy</title>",
        "www/404.html" to "<!doctype html><title>404</title>",
        "www/brand/logo.svg" to "<svg xmlns='http://www.w3.org/2000/svg'/>",
        "www/tv/index.html" to "<!doctype html><title>tv</title>",
        "www/games/snake/index.html" to "<!doctype html><title>game</title>",
    )

    /** Records page-bound events; the test plays the role of the page. */
    private class RecordingEvents : PhoneEvents {
        val events = LinkedBlockingQueue<String>()
        override fun onOpen(id: Int, ip: String) { events.add("open:$id:$ip") }
        override fun onText(id: Int, text: String) { events.add("text:$id:$text") }
        override fun onInvalidFrame(id: Int) { events.add("invalid:$id") }
        override fun onClosed(id: Int) { events.add("closed:$id") }
        fun next(): String = events.poll(5, TimeUnit.SECONDS) ?: error("no event")
    }

    private lateinit var events: RecordingEvents
    private lateinit var server: PhoneServer
    private var port = 0
    private val client = HttpClient(CIO) {
        install(WebSockets)
        followRedirects = false
        expectSuccess = false
    }

    @Before
    fun setUp() {
        events = RecordingEvents()
        server = PhoneServer(
            assets = { path -> files[path]?.let { ByteArrayInputStream(it.toByteArray()) } },
            events = events,
            limiter = ConnectionLimiter(maxTotal = 4, maxPerIp = 2),
        )
        port = server.start(listOf(0))
    }

    @After
    fun tearDown() {
        server.stop()
        client.close()
    }

    private fun get(path: String): HttpResponse = runBlocking { client.get("http://127.0.0.1:$port$path") }

    /** Raw HTTP so the Host header can be forged. */
    private fun rawStatus(path: String, host: String): Int = Socket("127.0.0.1", port).use { s ->
        s.getOutputStream().write("GET $path HTTP/1.1\r\nHost: $host\r\nConnection: close\r\n\r\n".toByteArray())
        s.getInputStream().bufferedReader().readLine().split(' ')[1].toInt()
    }

    private fun connect(origin: String = "http://127.0.0.1:$port"): DefaultClientWebSocketSession = runBlocking {
        client.webSocketSession("ws://127.0.0.1:$port${PhoneServer.WS_PATH}") { header("Origin", origin) }
    }

    private fun DefaultClientWebSocketSession.closeCode(): Short? = runBlocking {
        withTimeout(5000) {
            for (f in incoming) { /* drain until closed */ }
            closeReason.await()?.code
        }
    }

    private fun DefaultClientWebSocketSession.nextText(): String = runBlocking {
        withTimeout(5000) { (incoming.receive() as Frame.Text).readText() }
    }

    @Test
    fun servesControllerWithSecurityHeaders() {
        val res = get("/c")
        assertEquals(200, res.status.value)
        assertTrue(runBlocking { res.bodyAsText() }.contains("controller"))
        assertTrue(res.headers["Content-Security-Policy"]!!.contains("frame-ancestors 'none'"))
        assertEquals("nosniff", res.headers["X-Content-Type-Options"])
        assertTrue(res.headers["Content-Type"]!!.startsWith("text/html"))
        assertEquals(200, get("/c/controller.js").status.value)
        assertEquals(200, get("/legal/privacy.html").status.value)
        val logo = get("/brand/logo.svg")
        assertEquals(200, logo.status.value)
        assertTrue(logo.headers["Content-Type"]!!.startsWith("image/svg+xml"))
    }

    @Test
    fun rootRedirectsPhonesToController() {
        val res = get("/")
        assertEquals(302, res.status.value)
        assertEquals("/c", res.headers["Location"])
    }

    @Test
    fun tvScreenGamesAndTraversalAreNotReachable() {
        for (p in listOf("/tv/index.html", "/games/snake/index.html", "/c/../tv/index.html", "/c/%2e%2e/tv/index.html", "/c/.secret.js", "/nope.html")) {
            assertEquals("path $p", 404, get(p).status.value)
        }
    }

    @Test
    fun rejectsDnsRebindingHostHeaders() {
        assertEquals(421, rawStatus("/c", "evil.example"))
        assertEquals(421, rawStatus("/c", "127.0.0.1.nip.io:$port"))
        assertEquals(200, rawStatus("/c", "192.168.1.20:$port"))
    }

    @Test
    fun rejectsCrossOriginWebSockets() {
        assertTrue(runCatching { connect(origin = "http://evil.example") }.isFailure)
    }

    @Test
    fun relaysTextBothWaysAndCloses() {
        val ws = connect()
        val open = events.next()
        assertTrue(open, open.startsWith("open:"))
        val id = open.split(':')[1].toInt()
        runBlocking { ws.send(Frame.Text("""{"type":"ping","t":1}""")) }
        assertEquals("""text:$id:{"type":"ping","t":1}""", events.next())

        server.send(id, """{"type":"pong","t":1}""")
        assertEquals("""{"type":"pong","t":1}""", ws.nextText())

        runBlocking { ws.send(Frame.Binary(true, byteArrayOf(1, 2, 3))) }
        assertEquals("invalid:$id", events.next())

        server.close(id, 4003, "kicked")
        assertEquals(4003.toShort(), ws.closeCode())
        assertEquals("closed:$id", events.next())
    }

    @Test
    fun closesOversizedFrames() {
        val ws = connect()
        events.next()
        runBlocking { ws.send(Frame.Text("x".repeat(PhoneServer.MAX_FRAME_BYTES.toInt() + 10))) }
        assertEquals(CloseReason.Codes.TOO_BIG.code, ws.closeCode())
        assertTrue(events.next().startsWith("closed:"))
    }

    @Test
    fun limitsConnectionsPerIp() {
        connect(); connect()
        assertTrue(events.next().startsWith("open:"))
        assertTrue(events.next().startsWith("open:"))
        val third = connect()
        assertEquals(CloseReason.Codes.TRY_AGAIN_LATER.code, third.closeCode())
        assertEquals(null, events.events.poll(300, TimeUnit.MILLISECONDS))
    }
}
