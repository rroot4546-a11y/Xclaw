import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.xclaw.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.xclaw.app"
        minSdk = 24
        // targetSdk 28 allows executing binaries from app data directory.
        // Android 10+ (targetSdk 29+) enforces W^X which blocks this via SELinux.
        // Termux (F-Droid) uses the same approach.
        targetSdk = 28
        versionCode = 3
        versionName = "1.0.0"
    }

    signingConfigs {
        val ksB64 = System.getenv("ANDROID_KEYSTORE_BASE64")
        if (!ksB64.isNullOrBlank()) {
            create("release") {
                val ksFile = rootProject.file("key.jks")
                ksFile.writeBytes(Base64.getDecoder().decode(ksB64))
                storeFile = ksFile
                storePassword = System.getenv("ANDROID_KEYSTORE_PASS")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASS")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    // Don't compress bootstrap zip or server bundle in assets
    androidResources {
        noCompress += listOf("zip", "tar.gz")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.google.android.material:material:1.12.0")
}
