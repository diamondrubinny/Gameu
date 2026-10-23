package net.rubinny.gameu.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostRulesTest {
    @Test
    fun allowsLocalhostAndIpLiterals() {
        listOf("localhost", "localhost:8080", "127.0.0.1", "192.168.1.20:8080", "10.0.0.5", "[::1]:8080", "[fe80::1]")
            .forEach { assertTrue(it, HostRules.isAllowedHost(it)) }
    }

    @Test
    fun rejectsNamesAndMalformedHosts() {
        listOf(null, "", "evil.com", "attacker.example:8080", "127.0.0.1.nip.io", "256.1.1.1", "1.2.3", "1.2.3.4:abc", "a b", "user@1.2.3.4", "[::1", "[::1]x")
            .forEach { assertFalse(it.toString(), HostRules.isAllowedHost(it)) }
    }

    @Test
    fun sameOrigin() {
        assertTrue(HostRules.isSameOrigin("http://192.168.1.2:8080", "192.168.1.2:8080"))
        assertFalse(HostRules.isSameOrigin("http://evil.com", "192.168.1.2:8080"))
        assertFalse(HostRules.isSameOrigin(null, "192.168.1.2:8080"))
    }

    @Test
    fun limiter() {
        val l = ConnectionLimiter(maxTotal = 3, maxPerIp = 2)
        assertTrue(l.tryAcquire("a")); assertTrue(l.tryAcquire("a")); assertFalse(l.tryAcquire("a"))
        assertTrue(l.tryAcquire("b")); assertFalse(l.tryAcquire("c"))
        l.release("a")
        assertTrue(l.tryAcquire("c"))
        assertEquals(Unit, l.release("unknown"))
    }
}
