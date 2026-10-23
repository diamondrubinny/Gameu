# No reflection-based APIs of our own (no @JavascriptInterface; WebMessageListener only).

# Ktor server on Android: optional JVM-only integrations that are absent on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn javax.management.**
-dontwarn io.netty.**
-dontwarn org.fusesource.**
-dontwarn reactor.blockhound.**
