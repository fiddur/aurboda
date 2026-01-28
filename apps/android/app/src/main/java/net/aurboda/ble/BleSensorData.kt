package net.aurboda.ble

import java.time.Instant

enum class SensorType {
    HEART_RATE,
    RUNNING_SPEED_CADENCE
}

data class HeartRateSample(
    val timestamp: Instant,
    val bpm: Int,
    val rrIntervals: List<Int>? = null  // in ms
)

data class CadenceSample(
    val timestamp: Instant,
    val cadence: Int,  // steps per minute
    val speed: Float?  // m/s
)

data class DiscoveredDevice(
    val address: String,
    val name: String?,
    val rssi: Int,
    val sensorType: SensorType
)

data class ConnectedDevice(
    val address: String,
    val name: String?,
    val type: SensorType
)

sealed class BleConnectionState {
    data object Disconnected : BleConnectionState()
    data object Connecting : BleConnectionState()
    data object Connected : BleConnectionState()
    data class Error(val message: String) : BleConnectionState()
}
