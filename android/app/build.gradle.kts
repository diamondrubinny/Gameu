import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Web assets (TV screen, phone controller, games) are produced by `npm run build:android`.
val webAssetsDir = layout.buildDirectory.dir("generated/gameu-assets")

android {
    namespace = "net.rubinny.gameu"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.rubinny.gameu"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0"
    }

    buildTypes {
        release {
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
        // Newer androidx releases require compileSdk 37, which AGP 8.13 does not support yet.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
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
