package net.aurboda.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

private const val TAG = "BleConnectionManager"

class BleConnectionManager(private val context: Context) {
    private var bluetoothGatt: BluetoothGatt? = null
    private var connectedDevice: BluetoothDevice? = null

    private val _connectionState = MutableStateFlow<BleConnectionState>(BleConnectionState.Disconnected)
    val connectionState: StateFlow<BleConnectionState> = _connectionState.asStateFlow()

    private val _heartRateSamples = MutableSharedFlow<HeartRateSample>(extraBufferCapacity = 64)
    val heartRateSamples: SharedFlow<HeartRateSample> = _heartRateSamples.asSharedFlow()

    private val _connectedDeviceInfo = MutableStateFlow<ConnectedDevice?>(null)
    val connectedDeviceInfo: StateFlow<ConnectedDevice?> = _connectedDeviceInfo.asStateFlow()

    private val _currentHeartRate = MutableStateFlow<Int?>(null)
    val currentHeartRate: StateFlow<Int?> = _currentHeartRate.asStateFlow()

    private val _batteryLevel = MutableStateFlow<Int?>(null)
    val batteryLevel: StateFlow<Int?> = _batteryLevel.asStateFlow()

    // RSC (Running Speed and Cadence) data
    private val _cadenceSamples = MutableSharedFlow<CadenceSample>(extraBufferCapacity = 64)
    val cadenceSamples: SharedFlow<CadenceSample> = _cadenceSamples.asSharedFlow()

    private val _currentCadence = MutableStateFlow<Int?>(null)
    val currentCadence: StateFlow<Int?> = _currentCadence.asStateFlow()

    private val _currentSpeed = MutableStateFlow<Float?>(null)
    val currentSpeed: StateFlow<Float?> = _currentSpeed.asStateFlow()

    // Step tracking - cumulative steps since connection started
    private var stepTrackingStartTime: java.time.Instant? = null
    private var lastCadenceTime: java.time.Instant? = null
    private var accumulatedSteps: Double = 0.0

    private val _stepsSinceStart = MutableStateFlow<Int>(0)
    val stepsSinceStart: StateFlow<Int> = _stepsSinceStart.asStateFlow()

    // Queue for characteristics to read after notifications are set up
    private val pendingReads = mutableListOf<BluetoothGattCharacteristic>()

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.d(TAG, "Connected to GATT server, discovering services...")
                    _connectionState.value = BleConnectionState.Connecting
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "Disconnected from GATT server")
                    _connectionState.value = BleConnectionState.Disconnected
                    _connectedDeviceInfo.value = null
                    _currentHeartRate.value = null
                    _batteryLevel.value = null
                    _currentCadence.value = null
                    _currentSpeed.value = null
                    _stepsSinceStart.value = 0
                    stepTrackingStartTime = null
                    lastCadenceTime = null
                    accumulatedSteps = 0.0
                    bluetoothGatt?.close()
                    bluetoothGatt = null
                    connectedDevice = null
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Services discovered successfully")

                // Check for Battery Service (common across devices)
                val batteryService = gatt.getService(BATTERY_SERVICE_UUID)
                val batteryCharacteristic = batteryService?.getCharacteristic(BATTERY_LEVEL_UUID)
                if (batteryCharacteristic != null) {
                    pendingReads.add(batteryCharacteristic)
                    Log.d(TAG, "Battery service found, will read after setup")
                }

                // Look for Heart Rate Service
                val hrService = gatt.getService(HEART_RATE_SERVICE_UUID)
                if (hrService != null) {
                    val hrMeasurement = hrService.getCharacteristic(HEART_RATE_MEASUREMENT_UUID)
                    if (hrMeasurement != null) {
                        enableNotifications(gatt, hrMeasurement)
                        _connectionState.value = BleConnectionState.Connected
                        _connectedDeviceInfo.value = ConnectedDevice(
                            address = gatt.device.address,
                            name = gatt.device.name,
                            type = SensorType.HEART_RATE
                        )
                        Log.d(TAG, "Heart Rate service found and notifications enabled")
                        return
                    }
                }

                // Look for RSC Service if HR not found
                val rscService = gatt.getService(RUNNING_SPEED_CADENCE_SERVICE_UUID)
                if (rscService != null) {
                    val rscMeasurement = rscService.getCharacteristic(RSC_MEASUREMENT_UUID)
                    if (rscMeasurement != null) {
                        enableNotifications(gatt, rscMeasurement)
                        _connectionState.value = BleConnectionState.Connected
                        _connectedDeviceInfo.value = ConnectedDevice(
                            address = gatt.device.address,
                            name = gatt.device.name,
                            type = SensorType.RUNNING_SPEED_CADENCE
                        )
                        // Reset step tracking for new RSC connection
                        stepTrackingStartTime = java.time.Instant.now()
                        lastCadenceTime = null
                        accumulatedSteps = 0.0
                        _stepsSinceStart.value = 0
                        Log.d(TAG, "RSC service found and notifications enabled, step tracking started")
                        return
                    }
                }

                Log.w(TAG, "No supported services found on device")
                _connectionState.value = BleConnectionState.Error("No supported services found")
                disconnect()
            } else {
                Log.e(TAG, "Service discovery failed: $status")
                _connectionState.value = BleConnectionState.Error("Service discovery failed")
                disconnect()
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            when (characteristic.uuid) {
                HEART_RATE_MEASUREMENT_UUID -> {
                    val sample = parseHeartRateMeasurement(value)
                    if (sample != null) {
                        Log.d(TAG, "Heart rate: ${sample.bpm} bpm")
                        _currentHeartRate.value = sample.bpm
                        _heartRateSamples.tryEmit(sample)
                    }
                }
                RSC_MEASUREMENT_UUID -> {
                    val sample = parseRscMeasurement(value)
                    if (sample != null) {
                        Log.d(TAG, "RSC: cadence=${sample.cadence} spm, speed=${sample.speed} m/s")
                        _currentCadence.value = sample.cadence
                        _currentSpeed.value = sample.speed
                        _cadenceSamples.tryEmit(sample)

                        // Track cumulative steps by integrating cadence over time
                        val now = java.time.Instant.now()
                        val lastTime = lastCadenceTime
                        if (lastTime != null && sample.cadence > 0) {
                            val elapsedSeconds = java.time.Duration.between(lastTime, now).toMillis() / 1000.0
                            // cadence is steps per minute, convert to steps in elapsed time
                            val stepsInInterval = sample.cadence * elapsedSeconds / 60.0
                            accumulatedSteps += stepsInInterval
                            _stepsSinceStart.value = accumulatedSteps.toInt()
                        }
                        lastCadenceTime = now
                    }
                }
            }
        }

        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Descriptor write successful")
                // Process pending reads after notifications are set up
                processPendingReads(gatt)
            } else {
                Log.e(TAG, "Descriptor write failed: $status")
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                when (characteristic.uuid) {
                    BATTERY_LEVEL_UUID -> {
                        val batteryLevel = characteristic.value?.firstOrNull()?.toInt()?.and(0xFF)
                        if (batteryLevel != null) {
                            Log.d(TAG, "Battery level: $batteryLevel%")
                            _batteryLevel.value = batteryLevel
                        }
                    }
                }
            } else {
                Log.e(TAG, "Characteristic read failed: $status")
            }
            // Continue processing any remaining pending reads
            processPendingReads(gatt)
        }
    }

    @SuppressLint("MissingPermission")
    private fun processPendingReads(gatt: BluetoothGatt) {
        if (pendingReads.isNotEmpty()) {
            val characteristic = pendingReads.removeAt(0)
            Log.d(TAG, "Reading characteristic: ${characteristic.uuid}")
            @Suppress("DEPRECATION")
            gatt.readCharacteristic(characteristic)
        }
    }

    @SuppressLint("MissingPermission")
    private fun enableNotifications(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        gatt.setCharacteristicNotification(characteristic, true)

        val descriptor = characteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG_UUID)
        if (descriptor != null) {
            @Suppress("DEPRECATION")
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            @Suppress("DEPRECATION")
            gatt.writeDescriptor(descriptor)
            Log.d(TAG, "Enabling notifications for ${characteristic.uuid}")
        } else {
            Log.w(TAG, "No CCCD found for characteristic ${characteristic.uuid}")
        }
    }

    @SuppressLint("MissingPermission")
    fun connect(deviceAddress: String) {
        if (_connectionState.value is BleConnectionState.Connected ||
            _connectionState.value is BleConnectionState.Connecting) {
            Log.w(TAG, "Already connected or connecting")
            return
        }

        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = bluetoothManager?.adapter

        if (adapter == null) {
            _connectionState.value = BleConnectionState.Error("Bluetooth not available")
            return
        }

        try {
            val device = adapter.getRemoteDevice(deviceAddress)
            connectedDevice = device
            _connectionState.value = BleConnectionState.Connecting
            Log.d(TAG, "Connecting to device: $deviceAddress")
            bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Invalid device address: $deviceAddress", e)
            _connectionState.value = BleConnectionState.Error("Invalid device address")
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception connecting to device", e)
            _connectionState.value = BleConnectionState.Error("Permission denied")
        }
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        Log.d(TAG, "Disconnecting...")
        try {
            bluetoothGatt?.disconnect()
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception disconnecting", e)
        }
        _currentHeartRate.value = null
        _batteryLevel.value = null
        _currentCadence.value = null
        _currentSpeed.value = null
    }

    @SuppressLint("MissingPermission")
    fun close() {
        Log.d(TAG, "Closing connection manager...")
        try {
            bluetoothGatt?.close()
        } catch (e: SecurityException) {
            Log.e(TAG, "Security exception closing", e)
        }
        bluetoothGatt = null
        connectedDevice = null
        pendingReads.clear()
        _connectionState.value = BleConnectionState.Disconnected
        _connectedDeviceInfo.value = null
        _currentHeartRate.value = null
        _batteryLevel.value = null
        _currentCadence.value = null
        _currentSpeed.value = null
        _stepsSinceStart.value = 0
        stepTrackingStartTime = null
        lastCadenceTime = null
        accumulatedSteps = 0.0
    }
}
