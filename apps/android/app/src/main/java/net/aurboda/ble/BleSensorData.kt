package net.aurboda.ble

import android.content.Context
import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant

@Serializable
enum class SensorType {
  HEART_RATE,
  RUNNING_SPEED_CADENCE,
}

data class HeartRateSample(
  val timestamp: Instant,
  val bpm: Int,
  val rrIntervals: List<Int>? = null, // in ms
)

data class CadenceSample(
  val timestamp: Instant,
  val cadence: Int, // steps per minute
  val speed: Float?, // m/s
  val strideLengthCm: Int? = null,
  val totalDistanceMeters: Float? = null,
  val isRunning: Boolean = false,
)

data class DiscoveredDevice(
  val address: String,
  val name: String?,
  val rssi: Int,
  val sensorType: SensorType,
)

data class ConnectedDevice(
  val address: String,
  val name: String?,
  val type: SensorType,
)

sealed class BleConnectionState {
  data object Disconnected : BleConnectionState()

  data object Connecting : BleConnectionState()

  data object Connected : BleConnectionState()

  data class Error(
    val message: String,
  ) : BleConnectionState()
}

/**
 * Serializable representation of a device saved for auto-reconnect.
 */
@Serializable
data class SavedDevice(
  val address: String,
  val name: String?,
  val type: SensorType,
)

private const val PREFS_NAME = "ble_auto_reconnect"
private const val KEY_SAVED_DEVICES = "saved_devices"
private const val AUTO_RECONNECT_TAG = "AutoReconnectPrefs"

/**
 * Manages persisted auto-reconnect device list in SharedPreferences.
 */
object AutoReconnectPrefs {
  private val json = Json { ignoreUnknownKeys = true }

  fun getSavedDevices(context: Context): List<SavedDevice> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_SAVED_DEVICES, null) ?: return emptyList()
    return try {
      json.decodeFromString<List<SavedDevice>>(raw)
    } catch (e: Exception) {
      Log.e(AUTO_RECONNECT_TAG, "Failed to parse saved devices", e)
      emptyList()
    }
  }

  fun addDevice(
    context: Context,
    device: SavedDevice,
  ) {
    val current = getSavedDevices(context).toMutableList()
    // Replace if already present (address match), otherwise add
    current.removeAll { it.address == device.address }
    current.add(device)
    save(context, current)
    Log.d(AUTO_RECONNECT_TAG, "Added auto-reconnect device: ${device.name} (${device.address})")
  }

  fun removeDevice(
    context: Context,
    address: String,
  ) {
    val current = getSavedDevices(context).toMutableList()
    current.removeAll { it.address == address }
    save(context, current)
    Log.d(AUTO_RECONNECT_TAG, "Removed auto-reconnect device: $address")
  }

  fun isAutoReconnectEnabled(
    context: Context,
    address: String,
  ): Boolean = getSavedDevices(context).any { it.address == address }

  private fun save(
    context: Context,
    devices: List<SavedDevice>,
  ) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_SAVED_DEVICES, json.encodeToString(devices)).apply()
  }
}
