import java.io.File // Assuming this was added to fix the previous 'Unresolved reference: io'
import java.io.FileInputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Properties
import java.util.TimeZone

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  id("org.jetbrains.kotlin.plugin.serialization") version libs.versions.kotlin.get()
}

// Function to load properties from local.properties
fun getLocalProperty(
  key: String,
  projectRootDir: File,
): String { // Assuming changed to File
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
    val buildTimestamp =
      SimpleDateFormat("yyyyMMddHHmm", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date())
    buildConfigField("String", "BUILD_TIMESTAMP", "\"$buildTimestamp\"")
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
        "proguard-rules.pro",
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
  // kotlinOptions moved to top-level kotlin {} block (required by Kotlin 2.3+)
  buildFeatures {
    compose = true
    buildConfig = true
  }
  packaging {
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

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    freeCompilerArgs.addAll("-Wextra", "-Werror")
  }
}

dependencies {
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

  implementation("io.ktor:ktor-client-android:2.3.13")
  implementation("io.ktor:ktor-client-content-negotiation:2.3.13")
  implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.13")

  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.10.0")

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
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
  testImplementation("io.ktor:ktor-client-mock:2.3.13")
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.espresso.core)
  androidTestImplementation(platform(libs.androidx.compose.bom))
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.tooling)
  debugImplementation(libs.androidx.compose.ui.test.manifest)
}
