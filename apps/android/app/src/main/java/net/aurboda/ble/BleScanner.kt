package net.aurboda.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.util.UUID

private const val TAG = "BleScanner"

// Standard Bluetooth GATT Service UUIDs
val HEART_RATE_SERVICE_UUID: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
val RUNNING_SPEED_CADENCE_SERVICE_UUID: UUID = UUID.fromString("00001814-0000-1000-8000-00805f9b34fb")

// Standard Bluetooth GATT Characteristic UUIDs
val HEART_RATE_MEASUREMENT_UUID: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
val RSC_MEASUREMENT_UUID: UUID = UUID.fromString("00002a53-0000-1000-8000-00805f9b34fb")

// Client Characteristic Configuration Descriptor UUID (for enabling notifications)
val CLIENT_CHARACTERISTIC_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

sealed class BleScanState {
    data object Idle : BleScanState()
    data object Scanning : BleScanState()
    data class DeviceFound(val device: DiscoveredDevice) : BleScanState()
    data class Error(val message: String) : BleScanState()
    data object ScanComplete : BleScanState()
}

fun hasBlePermissions(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
           ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
}

fun isBleSupported(context: Context): Boolean {
    val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return bluetoothManager?.adapter != null
}

fun isBleEnabled(context: Context): Boolean {
    val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return bluetoothManager?.adapter?.isEnabled == true
}

@SuppressLint("MissingPermission")
fun scanForSensors(context: Context, scanDurationMs: Long = 10000): Flow<BleScanState> = callbackFlow {
    val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val bluetoothAdapter = bluetoothManager?.adapter
    val scanner: BluetoothLeScanner? = bluetoothAdapter?.bluetoothLeScanner

    if (scanner == null) {
        trySend(BleScanState.Error("Bluetooth not available"))
        close()
        return@callbackFlow
    }

    if (!hasBlePermissions(context)) {
        trySend(BleScanState.Error("Bluetooth permissions not granted"))
        close()
        return@callbackFlow
    }

    if (!isBleEnabled(context)) {
        trySend(BleScanState.Error("Bluetooth is not enabled"))
        close()
        return@callbackFlow
    }

    val discoveredAddresses = mutableSetOf<String>()

    val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val address = device.address

            if (address in discoveredAddresses) return
            discoveredAddresses.add(address)

            val serviceUuids = result.scanRecord?.serviceUuids?.map { it.uuid } ?: emptyList()
            val sensorType = when {
                HEART_RATE_SERVICE_UUID in serviceUuids -> SensorType.HEART_RATE
                RUNNING_SPEED_CADENCE_SERVICE_UUID in serviceUuids -> SensorType.RUNNING_SPEED_CADENCE
                else -> null
            }

            if (sensorType != null) {
                val discovered = DiscoveredDevice(
                    address = address,
                    name = device.name,
                    rssi = result.rssi,
                    sensorType = sensorType
                )
                Log.d(TAG, "Discovered $sensorType device: ${device.name} (${device.address})")
                trySend(BleScanState.DeviceFound(discovered))
            }
        }

        override fun onScanFailed(errorCode: Int) {
            val errorMessage = when (errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "Scan already started"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "App registration failed"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "BLE scan not supported"
                SCAN_FAILED_INTERNAL_ERROR -> "Internal error"
                else -> "Unknown error: $errorCode"
            }
            Log.e(TAG, "Scan failed: $errorMessage")
            trySend(BleScanState.Error(errorMessage))
        }
    }

    // Build scan filters for HR and RSC services
    val filters = listOf(
        ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(HEART_RATE_SERVICE_UUID))
            .build(),
        ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(RUNNING_SPEED_CADENCE_SERVICE_UUID))
            .build()
    )

    val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .build()

    Log.d(TAG, "Starting BLE scan for HR and RSC services")
    trySend(BleScanState.Scanning)

    try {
        scanner.startScan(filters, settings, scanCallback)
    } catch (e: SecurityException) {
        Log.e(TAG, "Security exception starting scan", e)
        trySend(BleScanState.Error("Permission denied"))
        close()
        return@callbackFlow
    }

    // Set up scan timeout
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    val stopRunnable = Runnable {
        try {
            scanner.stopScan(scanCallback)
            Log.d(TAG, "Scan stopped after timeout")
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception stopping scan", e)
        }
        trySend(BleScanState.ScanComplete)
        close()
    }
    handler.postDelayed(stopRunnable, scanDurationMs)

    awaitClose {
        handler.removeCallbacks(stopRunnable)
        try {
            scanner.stopScan(scanCallback)
            Log.d(TAG, "Scan stopped (flow closed)")
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception stopping scan on close", e)
        }
    }
}
