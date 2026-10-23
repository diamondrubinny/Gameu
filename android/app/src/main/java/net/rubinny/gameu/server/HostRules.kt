package net.rubinny.gameu.server

/**
 * Request-level guards, mirroring src/server/security.ts. Pure functions (no DNS lookups).
 */
object HostRules {
    private val IPV4 = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    private val IPV6_CHARS = Regex("^[0-9a-fA-F:.]+$")

    /** DNS-rebinding guard: Host must be localhost or an IP literal (optionally with a port). */
    fun isAllowedHost(hostHeader: String?): Boolean {
        val host = hostname(hostHeader) ?: return false
        if (host == "localhost") return true
        if (host.startsWith("[")) {
            val inner = host.removePrefix("[").removeSuffix("]")
            return host.endsWith("]") && inner.contains(':') && IPV6_CHARS.matches(inner)
        }
        return IPV4.matches(host)
    }

    /** Cross-site WebSocket hijacking guard: Origin must be exactly http://<Host>. */
    fun isSameOrigin(origin: String?, hostHeader: String?): Boolean =
        origin != null && hostHeader != null && origin == "http://$hostHeader"

    private fun hostname(hostHeader: String?): String? {
        val h = hostHeader?.trim()?.lowercase() ?: return null
        if (h.isEmpty() || h.length > 255 || h.any { it.isWhitespace() || it == '/' || it == '@' }) return null
        if (h.startsWith("[")) {
            val end = h.indexOf(']')
            if (end < 0) return null
            val rest = h.substring(end + 1)
            if (rest.isNotEmpty() && !Regex("^:\\d{1,5}$").matches(rest)) return null
            return h.substring(0, end + 1)
        }
        val parts = h.split(':')
        return when (parts.size) {
            1 -> parts[0]
            2 -> if (Regex("^\\d{1,5}$").matches(parts[1])) parts[0] else null
            else -> null
        }
    }
}
