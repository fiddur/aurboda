package net.aurboda.ble

import java.time.Instant

/**
 * Parser for Bluetooth RSC (Running Speed and Cadence) Measurement characteristic (0x2A53)
 * See: https://www.bluetooth.com/specifications/specs/running-speed-and-cadence-service-1-0/
 *
 * Flags byte:
 *   Bit 0: Instantaneous Stride Length Present
 *   Bit 1: Total Distance Present
 *   Bit 2: Walking (0) or Running (1) Status
 *
 * Data fields:
 *   - Instantaneous Speed: 2 bytes, uint16, unit 1/256 m/s (mandatory)
 *   - Instantaneous Cadence: 1 byte, uint8, unit steps/minute (mandatory)
 *   - Instantaneous Stride Length: 2 bytes, uint16, unit cm (optional)
 *   - Total Distance: 4 bytes, uint32, unit 1/10 m (optional)
 */
fun parseRscMeasurement(data: ByteArray): CadenceSample? {
    if (data.size < 4) return null // Minimum: flags (1) + speed (2) + cadence (1)

    val flags = data[0].toInt() and 0xFF
    val hasStrideLength = (flags and 0x01) != 0
    val hasTotalDistance = (flags and 0x02) != 0
    val isRunning = (flags and 0x04) != 0

    var offset = 1

    // Parse instantaneous speed (1/256 m/s)
    val speedRaw = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)
    val speedMs = speedRaw / 256f
    offset += 2

    // Parse instantaneous cadence (steps/minute)
    val cadence = data[offset].toInt() and 0xFF
    offset += 1

    // Parse optional stride length (cm)
    val strideLengthCm: Int? = if (hasStrideLength && offset + 1 < data.size) {
        val stride = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)
        offset += 2
        stride
    } else {
        null
    }

    // Parse optional total distance (1/10 m)
    val totalDistanceMeters: Float? = if (hasTotalDistance && offset + 3 < data.size) {
        val distRaw = (data[offset].toInt() and 0xFF) or
                ((data[offset + 1].toInt() and 0xFF) shl 8) or
                ((data[offset + 2].toInt() and 0xFF) shl 16) or
                ((data[offset + 3].toInt() and 0xFF) shl 24)
        distRaw / 10f
    } else {
        null
    }

    return CadenceSample(
        timestamp = Instant.now(),
        cadence = cadence,
        speed = if (speedMs > 0) speedMs else null,
        strideLengthCm = strideLengthCm,
        totalDistanceMeters = totalDistanceMeters,
        isRunning = isRunning
    )
}
