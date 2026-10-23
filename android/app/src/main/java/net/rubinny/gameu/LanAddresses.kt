package net.rubinny.gameu

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address

/** Private IPv4 addresses of the active Wi-Fi/Ethernet network, best candidates first. */
object LanAddresses {
    fun current(cm: ConnectivityManager): List<String> {
        val result = mutableListOf<String>()
        for (network in listOfNotNull(cm.activeNetwork)) {
            val caps = cm.getNetworkCapabilities(network) ?: continue
            val local = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            if (!local) continue
            cm.getLinkProperties(network)?.linkAddresses?.forEach { la ->
                val addr = la.address
                if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress) {
                    result.add(addr.hostAddress ?: return@forEach)
                }
            }
        }
        return sort(result)
    }

    /** Same ranking as the Node server (src/server/network.ts). */
    fun sort(ips: List<String>): List<String> {
        fun rank(ip: String) = when {
            ip.startsWith("192.168.") -> 0
            ip.startsWith("10.") -> 1
            Regex("^172\\.(1[6-9]|2\\d|3[01])\\.").containsMatchIn(ip) -> 2
            else -> 3
        }
        return ips.distinct().sortedBy(::rank)
    }
}
