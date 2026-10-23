package net.rubinny.gameu.server

/** Caps concurrent phone sockets overall and per IP (first line of defence before the page). */
class ConnectionLimiter(private val maxTotal: Int = 32, private val maxPerIp: Int = 6) {
    private val perIp = HashMap<String, Int>()
    private var total = 0

    @Synchronized
    fun tryAcquire(ip: String): Boolean {
        val n = perIp[ip] ?: 0
        if (total >= maxTotal || n >= maxPerIp) return false
        perIp[ip] = n + 1
        total += 1
        return true
    }

    @Synchronized
    fun release(ip: String) {
        val n = perIp[ip] ?: return
        if (n <= 1) perIp.remove(ip) else perIp[ip] = n - 1
        total -= 1
    }
}
