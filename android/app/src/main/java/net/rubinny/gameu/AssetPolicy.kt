package net.rubinny.gameu

/**
 * Pure (Android-free) rules for serving the bundled web app: path validation,
 * MIME types and security headers. Mirrors src/server/static.ts + security.ts.
 */
object AssetPolicy {
    const val ROOT = "www"

    private val MIME = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "webmanifest" to "application/manifest+json",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "webp" to "image/webp",
        "ico" to "image/x-icon",
        "woff2" to "font/woff2",
        "mp3" to "audio/mpeg",
        "ogg" to "audio/ogg",
        "wav" to "audio/wav",
        "txt" to "text/plain",
    )

    private const val COMMON_CSP =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
            "base-uri 'none'; form-action 'none'; object-src 'none'"

    /** Maps a URL path to an asset path under [ROOT], or null if it must not be served. */
    fun resolve(urlPath: String?): String? {
        if (urlPath.isNullOrEmpty() || !urlPath.startsWith("/")) return null
        if (urlPath.contains('\\') || urlPath.contains('\u0000')) return null
        val segments = urlPath.split('/').filter { it.isNotEmpty() }
        if (segments.isEmpty()) return null
        if (segments.any { it == ".." || it.startsWith(".") }) return null
        if (mimeFor(segments.last()) == null) return null
        return "$ROOT/" + segments.joinToString("/")
    }

    fun mimeFor(fileName: String): String? {
        val dot = fileName.lastIndexOf('.')
        if (dot < 0) return null
        return MIME[fileName.substring(dot + 1).lowercase()]
    }

    /** Text types are served as UTF-8. */
    fun encodingFor(mime: String): String? =
        if (mime.startsWith("text/") || mime.endsWith("json") || mime == "image/svg+xml") "utf-8" else null

    /** Paths phones may fetch over the LAN: the controller, legal pages and the 404 page only. */
    fun isNetworkPath(urlPath: String): Boolean =
        urlPath.startsWith("/c/") || urlPath.startsWith("/legal/") || urlPath == "/404.html"

    /** Headers for responses to phones (src/server/security.ts: 'controller' and 'static'). */
    fun networkHeadersFor(urlPath: String): Map<String, String> {
        val headers = mutableMapOf(
            "X-Content-Type-Options" to "nosniff",
            "Referrer-Policy" to "no-referrer",
            "Cache-Control" to "no-cache",
            "Permissions-Policy" to "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        if (urlPath.startsWith("/c/")) {
            headers["Content-Security-Policy"] = "$COMMON_CSP; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'"
            headers["X-Frame-Options"] = "DENY"
            headers["Cross-Origin-Resource-Policy"] = "same-origin"
        } else {
            headers["Content-Security-Policy"] = "$COMMON_CSP; connect-src 'none'; frame-ancestors 'self'"
        }
        return headers
    }

    fun headersFor(urlPath: String): Map<String, String> {
        val headers = mutableMapOf(
            "X-Content-Type-Options" to "nosniff",
            "Referrer-Policy" to "no-referrer",
            "Cache-Control" to "no-cache",
        )
        when {
            // Games: sandboxed (opaque origin) even if opened directly, no network access.
            urlPath.startsWith("/games/") && urlPath.endsWith(".html") ->
                headers["Content-Security-Policy"] =
                    "sandbox allow-scripts; $COMMON_CSP; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'"
            urlPath.startsWith("/tv/") ->
                headers["Content-Security-Policy"] = "$COMMON_CSP; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'"
            urlPath.endsWith(".html") ->
                headers["Content-Security-Policy"] = "$COMMON_CSP; connect-src 'none'; frame-ancestors 'self'"
        }
        return headers
    }
}
