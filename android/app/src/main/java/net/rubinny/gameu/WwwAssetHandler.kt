package net.rubinny.gameu

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException

/** Serves `assets/www` at https://appassets.androidplatform.net/ with the console's security headers. */
class WwwAssetHandler(private val assets: AssetManager) {

    fun handle(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "https" || uri.host != HOST) return null
        val path = uri.path ?: return notFound()
        val assetPath = AssetPolicy.resolve(path) ?: return notFound()
        val mime = AssetPolicy.mimeFor(assetPath) ?: return notFound()
        return try {
            val stream = assets.open(assetPath, AssetManager.ACCESS_STREAMING)
            WebResourceResponse(mime, AssetPolicy.encodingFor(mime), 200, "OK", AssetPolicy.headersFor(path), stream)
        } catch (_: IOException) {
            notFound()
        }
    }

    private fun notFound() = WebResourceResponse(
        "text/plain", "utf-8", 404, "Not Found",
        mapOf("X-Content-Type-Options" to "nosniff"),
        ByteArrayInputStream("Not found".toByteArray()),
    )

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/tv/index.html"
    }
}
