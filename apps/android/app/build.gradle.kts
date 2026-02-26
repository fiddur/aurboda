import java.util.Properties
import java.io.FileInputStream
import java.io.File // Assuming this was added to fix the previous 'Unresolved reference: io'

configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlin:kotlin-stdlib:1.9.0") // Example version
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0") // If you use jdk8 variant
        force("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.0") // If you use jdk7 variant
    }
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22"
}

// Function to load properties from local.properties
fun getLocalProperty(key: String, projectRootDir: File): String { // Assuming changed to File
    val properties = Properties()
    val localPropertiesFile = File(projectRootDir, "local.properties") // Assuming changed to File
    if (localPropertiesFile.exists()) {
        FileInputStream(localPropertiesFile).use { stream -> properties.load(stream) } // Changed lambda parameter
    }
    return properties.getProperty(key) ?: ""
}

// Read version code from environment variable (set by CI) or default to 1 for local builds
val versionCodeFromEnv = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1

android {
    namespace = "net.aurboda"
    compileSdk = 36

    sourceSets {
        getByName("main") {
            java.srcDir("../../../packages/api-spec/generated/kotlin/src/main/kotlin")
        }
    }

    defaultConfig {
        applicationId = "net.aurboda"
        minSdk = 34
        targetSdk = 36
        versionCode = versionCodeFromEnv
        versionName = "1.0.$versionCodeFromEnv"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Expose version info to runtime code
        buildConfigField("int", "VERSION_CODE_INT", "$versionCodeFromEnv")
    }

    signingConfigs {
        val keystoreFile = getLocalProperty("KEYSTORE_FILE", rootProject.projectDir)
        val keystorePassword = getLocalProperty("KEYSTORE_PASSWORD", rootProject.projectDir)
        val keyAlias = getLocalProperty("KEY_ALIAS", rootProject.projectDir)
        val keyPassword = getLocalProperty("KEY_PASSWORD", rootProject.projectDir)

        if (keystoreFile.isNotEmpty() && keystorePassword.isNotEmpty()) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfigs.findByName("release")?.let {
                signingConfig = it
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packagingOptions {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.9.0")) // Example version, use your project's Kotlin version
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation("androidx.health.connect:connect-client:1.2.0-alpha01")

    implementation("io.ktor:ktor-client-android:2.3.8")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.8")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.8")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Encrypted SharedPreferences for secure credential storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // WorkManager for background sync
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    testImplementation(libs.junit)
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("androidx.work:work-testing:2.9.0")
    testImplementation("org.robolectric:robolectric:4.11.1")
    testImplementation("androidx.test:core:1.5.0")
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("io.ktor:ktor-client-mock:2.3.8")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}