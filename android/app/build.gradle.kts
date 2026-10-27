import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Release signing: environment variables (CI) or android/keystore.properties (local, git-ignored).
 * Never commit the keystore or its passwords. Without them, release builds are unsigned.
 */
val signingProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? = System.getenv(env)?.takeIf { it.isNotBlank() } ?: signingProps.getProperty(prop)
val releaseStoreFile = signingValue("GAMEU_KEYSTORE_FILE", "storeFile")
val hasReleaseSigning = releaseStoreFile != null && file(releaseStoreFile).exists()

// Web assets (TV screen, phone controller, games) are produced by `npm run build:android`.
val webAssetsDir = layout.buildDirectory.dir("generated/gameu-assets")

android {
    namespace = "net.rubinny.gameu"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.rubinny.gameu"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "0.4.0"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = signingValue("GAMEU_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("GAMEU_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("GAMEU_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets {
        getByName("main").assets.srcDir(webAssetsDir)
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        // Newer androidx releases and targetSdk 37 need compileSdk 37, which AGP 8.13 does not support.
        // Tracked as a separate AGP 9 migration; OldTargetApi otherwise fails CI runners that ship SDK 37.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Fail early with a clear message instead of shipping an empty app.
val checkWebAssets by tasks.registering {
    val marker = webAssetsDir.map { it.file("www/tv/index.html").asFile }
    doLast {
        if (!marker.get().exists()) {
            throw GradleException("Web assets missing. Run `npm run build:android` from the repository root first.")
        }
    }
}
tasks.named("preBuild") { dependsOn(checkWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-ktx:1.12.4")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("io.ktor:ktor-server-cio:3.6.0")
    implementation("io.ktor:ktor-server-websockets:3.6.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("io.ktor:ktor-client-cio:3.6.0")
    testImplementation("io.ktor:ktor-client-websockets:3.6.0")
}
