package net.aurboda.ble

import java.time.Instant

/**
 * Parser for Bluetooth Heart Rate Measurement characteristic (0x2A37)
 * See: https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/
 */
fun parseHeartRateMeasurement(data: ByteArray): HeartRateSample? {
    if (data.isEmpty()) return null

    val flags = data[0].toInt() and 0xFF
    val isHrValueUint16 = (flags and 0x01) != 0
    val hasSensorContact = (flags and 0x02) != 0
    val sensorContactSupported = (flags and 0x04) != 0
    val hasEnergyExpended = (flags and 0x08) != 0
    val hasRrIntervals = (flags and 0x10) != 0

    var offset = 1

    // Parse heart rate value
    val heartRate: Int = if (isHrValueUint16) {
        if (data.size < offset + 2) return null
        val hr = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)
        offset += 2
        hr
    } else {
        if (data.size < offset + 1) return null
        val hr = data[offset].toInt() and 0xFF
        offset += 1
        hr
    }

    // Skip energy expended if present (2 bytes)
    if (hasEnergyExpended) {
        offset += 2
    }

    // Parse RR-Intervals if present
    val rrIntervals: List<Int>? = if (hasRrIntervals && offset < data.size) {
        val intervals = mutableListOf<Int>()
        while (offset + 1 < data.size) {
            // RR-Interval is in units of 1/1024 seconds
            val rrRaw = (data[offset].toInt() and 0xFF) or ((data[offset + 1].toInt() and 0xFF) shl 8)
            // Convert to milliseconds: (rrRaw / 1024) * 1000 = rrRaw * 1000 / 1024
            val rrMs = (rrRaw * 1000) / 1024
            intervals.add(rrMs)
            offset += 2
        }
        intervals.takeIf { it.isNotEmpty() }
    } else {
        null
    }

    return HeartRateSample(
        timestamp = Instant.now(),
        bpm = heartRate,
        rrIntervals = rrIntervals
    )
}
