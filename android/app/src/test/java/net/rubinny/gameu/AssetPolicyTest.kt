package net.rubinny.gameu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssetPolicyTest {
    @Test
    fun resolvesNormalPaths() {
        assertEquals("www/tv/index.html", AssetPolicy.resolve("/tv/index.html"))
        assertEquals("www/games/snake/main.js", AssetPolicy.resolve("/games/snake/main.js"))
        assertEquals("www/games/index.json", AssetPolicy.resolve("/games/index.json"))
    }

    @Test
    fun rejectsTraversalDotfilesAndUnknownTypes() {
        listOf(null, "", "tv/index.html", "/", "/../secret.html", "/a/../../x.js", "/.env", "/x/.git/config.txt", "/a\\b.js", "/app.exe", "/noext")
            .forEach { assertNull("should reject $it", AssetPolicy.resolve(it)) }
    }

    @Test
    fun gamesAreSandboxedWithoutNetwork() {
        val csp = AssetPolicy.headersFor("/games/snake/index.html")["Content-Security-Policy"]!!
        assertTrue(csp.startsWith("sandbox allow-scripts;"))
        assertTrue(csp.contains("connect-src 'none'"))
    }

    @Test
    fun tvPageCannotBeFramed() {
        val csp = AssetPolicy.headersFor("/tv/index.html")["Content-Security-Policy"]!!
        assertTrue(csp.contains("frame-ancestors 'none'"))
        assertEquals("nosniff", AssetPolicy.headersFor("/tv/tv.js")["X-Content-Type-Options"])
    }

    @Test
    fun mimeAndEncoding() {
        assertEquals("text/javascript", AssetPolicy.mimeFor("a.JS"))
        assertEquals("utf-8", AssetPolicy.encodingFor("text/html"))
        assertNull(AssetPolicy.encodingFor("image/png"))
    }

    @Test
    fun lanAddressRanking() {
        assertEquals(listOf("192.168.1.4", "10.0.0.2", "172.20.1.1"), LanAddresses.sort(listOf("172.20.1.1", "10.0.0.2", "192.168.1.4", "10.0.0.2")))
    }
}
