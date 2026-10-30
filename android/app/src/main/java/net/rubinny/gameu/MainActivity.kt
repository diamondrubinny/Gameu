package net.rubinny.gameu

import android.annotation.SuppressLint
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import net.rubinny.gameu.server.PhoneEvents
import net.rubinny.gameu.server.PhoneServer
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Full-screen TV console. The web UI (TV screen + room logic) runs in a WebView;
 * this activity serves the bundled assets and bridges native events to the page.
 */
class MainActivity : ComponentActivity() {

    private var webView: WebView? = null
    private var replyProxy: JavaScriptReplyProxy? = null
    private lateinit var connectivity: ConnectivityManager

    private val main = Handler(Looper.getMainLooper())
    private val serverExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var phoneServer: PhoneServer? = null
    private var serverStarting = false
    private var serverError: String? = null
    private var pageReady = false

    /** Socket events arrive on server threads; the page is only touched on the main thread (FIFO keeps order). */
    private val phoneEvents = object : PhoneEvents {
        override fun onOpen(id: Int, ip: String) = toPage(JSONObject().put("t", "open").put("id", id).put("ip", ip))
        override fun onText(id: Int, text: String) = toPage(JSONObject().put("t", "msg").put("id", id).put("data", text))
        override fun onInvalidFrame(id: Int) = toPage(JSONObject().put("t", "bad").put("id", id))
        override fun onClosed(id: Int) = toPage(JSONObject().put("t", "closed").put("id", id))
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = sendInfoOnUiThread()
        override fun onLost(network: Network) = sendInfoOnUiThread()
        override fun onLinkPropertiesChanged(network: Network, lp: android.net.LinkProperties) = sendInfoOnUiThread()
    }

    // RequiresFeature: WEB_MESSAGE_LISTENER is checked at the start of onCreate (fatal screen otherwise),
    // and the reply proxy only exists when the listener was registered.
    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        connectivity = getSystemService(ConnectivityManager::class.java)

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showFatal(getString(R.string.webview_too_old))
            return
        }

        val assets = WwwAssetHandler(this.assets)
        val view = WebView(this)
        with(view.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
        }
        view.setBackgroundColor(0xFF0D1021.toInt())

        // Bridge only for the console's own origin and main frame — sandboxed games never see it.
        WebViewCompat.addWebMessageListener(view, "gameuNative", setOf(WwwAssetHandler.ORIGIN)) { _, message, _, isMainFrame, proxy ->
            if (!isMainFrame) return@addWebMessageListener
            onPageMessage(message.data ?: return@addWebMessageListener, proxy)
        }

        view.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.handle(request.url)

            // Never navigate away from the bundled app.
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean =
                request.url.host != WwwAssetHandler.HOST

            // Renderer crashed or was killed for memory (weak TVs): rebuild instead of crashing the app.
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (v === webView) {
                    replyProxy = null
                    (v.parent as? android.view.ViewGroup)?.removeView(v)
                    v.destroy()
                    webView = null
                    recreate()
                }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this) {
            val proxy = replyProxy
            if (proxy != null) proxy.postMessage(JSONObject().put("t", "back").toString()) else finish()
        }

        setContentView(view)
        webView = view
        // Without window focus the page never paints its focus ring and D-pad keys go nowhere.
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.requestFocus()
        view.loadUrl(WwwAssetHandler.START_URL)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) webView?.requestFocus()
    }

    override fun onStart() {
        super.onStart()
        connectivity.registerDefaultNetworkCallback(networkCallback)
        if (pageReady) ensureServer()
    }

    /** Leaving the app (Home button) stops the phone server; phones reconnect when it returns. */
    override fun onStop() {
        super.onStop()
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        stopServer()
    }

    override fun onDestroy() {
        stopServer()
        serverExecutor.shutdown()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    private fun ensureServer() {
        if (phoneServer != null || serverStarting) return
        serverStarting = true
        val assetManager = assets
        serverExecutor.execute {
            val server = PhoneServer(
                assets = { path -> runCatching { assetManager.open(path) }.getOrNull() },
                events = phoneEvents,
            )
            val error = runCatching { server.start() }.exceptionOrNull()
            main.post {
                serverStarting = false
                if (error == null && !isFinishing && !isDestroyed) {
                    phoneServer = server
                    serverError = null
                } else {
                    if (error == null) serverExecutor.execute { server.stop() }
                    serverError = "phone_server_unavailable"
                }
                sendInfo()
            }
        }
    }

    private fun stopServer() {
        val server = phoneServer ?: return
        phoneServer = null
        serverExecutor.execute { server.stop() }
    }

    private fun toPage(obj: JSONObject) {
        val text = obj.toString()
        main.post { postToPage(text) }
    }

    @SuppressLint("RequiresFeature")
    private fun postToPage(text: String) {
        replyProxy?.postMessage(text)
    }

    @SuppressLint("RequiresFeature")
    private fun onPageMessage(data: String, proxy: JavaScriptReplyProxy) {
        val msg = runCatching { JSONObject(data) }.getOrNull() ?: return
        when (msg.optString("t")) {
            "hello" -> {
                replyProxy = proxy
                pageReady = true
                // A (re)loaded page has an empty room: make phones reconnect and re-join.
                phoneServer?.closeAll(CLOSE_SERVICE_RESTART, "console restarted")
                ensureServer()
                sendInfo()
            }
            "send" -> phoneServer?.send(msg.optInt("id"), msg.optString("data"))
            "close" -> phoneServer?.close(msg.optInt("id"), msg.optInt("code", 1000).coerceIn(1000, 4999).toShort(), msg.optString("reason"))
            "exit" -> finish()
        }
    }

    private fun sendInfoOnUiThread() = runOnUiThread { sendInfo() }

    @SuppressLint("RequiresFeature")
    private fun sendInfo() {
        val proxy = replyProxy ?: return
        val info = JSONObject()
            .put("t", "info")
            .put("lanIps", JSONArray(LanAddresses.current(connectivity)))
            .put("port", phoneServer?.port ?: DEFAULT_PORT)
            .put("version", BuildConfig.VERSION_NAME)
        serverError?.let { info.put("serverError", it) }
        proxy.postMessage(info.toString())
    }

    private fun showFatal(text: String) {
        setContentView(TextView(this).apply {
            this.text = text
            textSize = 28f
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
        })
    }

    companion object {
        const val DEFAULT_PORT = 8080
        const val CLOSE_SERVICE_RESTART: Short = 1012
    }
}
