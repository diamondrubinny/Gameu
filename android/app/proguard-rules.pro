# No reflection-based APIs of our own (no @JavascriptInterface; WebMessageListener only).

# Ktor server on Android: optional JVM-only integrations that are absent on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn javax.management.**
-dontwarn io.netty.**
-dontwarn org.fusesource.**
-dontwarn reactor.blockhound.**

# Ktor/kotlinx use atomic field updaters and ServiceLoader, which look classes and fields up by name.
# Keep them intact rather than risk a runtime-only crash on devices (costs a few hundred KB).
-keep class io.ktor.** { *; }
-keepclassmembers class kotlinx.** { volatile <fields>; }
-keepclassmembers class io.ktor.** { volatile <fields>; }
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
