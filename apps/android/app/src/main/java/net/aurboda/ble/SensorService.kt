package net.aurboda.ble

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import net.aurboda.CredentialsManager
import net.aurboda.MainActivity
import net.aurboda.R
import net.aurboda.appJson
import java.time.Instant
import java.time.ZoneOffset

private const val TAG = "SensorService"
private const val NOTIFICATION_ID = 1001
private const val CHANNEL_ID = "sensor_service_channel"
private const val SYNC_INTERVAL_MS = 5000L
private const val RR_BUFFER_MIN_SIZE = 30   // Minimum intervals for HRV calculation
private const val RR_BUFFER_MAX_SIZE = 300  // Maximum intervals (~5 minutes at 60bpm)
private const val CHART_HISTORY_DURATION_MS = 5 * 60 * 1000L  // 5 minutes of chart history

/**
 * Data point for chart display with timestamp.
 */
data class ChartDataPoint(
    val timestamp: Long,  // epoch millis
    val value: Float
)

/**
 * State for an individual connected device.
 */
data class DeviceState(
    val device: ConnectedDevice,
    val connectionState: BleConnectionState = BleConnectionState.Connected,
    val batteryLevel: Int? = null,
    // HR device specific
    val currentHeartRate: Int? = null,
    // RSC device specific
    val currentCadence: Int? = null,
    val currentSpeed: Float? = null,
    val stepsSinceStart: Int = 0
)

/**
 * State exposed by SensorService to the UI.
 * Supports multiple simultaneously connected devices.
 */
data class SensorServiceState(
    val isRunning: Boolean = false,
    val connectedDevices: Map<String, DeviceState> = emptyMap(),  // keyed by device address
    val connectingDevices: Set<String> = emptySet(),  // addresses of devices currently connecting
    val lastSyncTime: Instant? = null,
    val pendingSamples: Int = 0,
    val pendingCadenceSamples: Int = 0,
    val currentHrv: Double? = null,           // Latest RMSSD in ms
    val hrvReliable: Boolean = false,         // Whether HRV measurement is reliable
    val rrIntervalCount: Int = 0,             // Number of RR intervals in buffer
    val hrChartHistory: List<ChartDataPoint> = emptyList(),   // 5 min HR history for chart
    val hrvChartHistory: List<ChartDataPoint> = emptyList()   // 5 min HRV history for chart
) {
    // Convenience accessors for backward compatibility and easy access
    val hrDevice: DeviceState? get() = connectedDevices.values.find { it.device.type == SensorType.HEART_RATE }
    val rscDevice: DeviceState? get() = connectedDevices.values.find { it.device.type == SensorType.RUNNING_SPEED_CADENCE }
    val currentHeartRate: Int? get() = hrDevice?.currentHeartRate
    val currentCadence: Int? get() = rscDevice?.currentCadence
    val stepsSinceStart: Int get() = rscDevice?.stepsSinceStart ?: 0
    val hasConnectedDevices: Boolean get() = connectedDevices.isNotEmpty()
    val isConnecting: Boolean get() = connectingDevices.isNotEmpty()
}

/**
 * Heart rate sample in Health Connect format for backend sync.
 */
@Serializable
data class LiveHeartRateSample(
    val time: String,
    val beatsPerMinute: Long
)

/**
 * Heart rate record in Health Connect format for backend sync.
 * Uses simplified metadata suitable for live BLE data.
 */
@Serializable
data class LiveHeartRateRecord(
    val startTime: String,
    val endTime: String,
    val samples: List<LiveHeartRateSample>,
    val metadata: LiveRecordMetadata
)

/**
 * Simplified metadata for live sensor records.
 */
@Serializable
data class LiveRecordMetadata(
    val id: String,
    val dataOrigin: String = "net.aurboda",
    val device: LiveDeviceInfo? = null
)

@Serializable
data class LiveDeviceInfo(
    val type: Int = 2, // TYPE_CHEST_STRAP
    val model: String? = null
)

@Serializable
private data class HeartRateSyncBody(val data: List<LiveHeartRateRecord>)

/**
 * Steps record in Health Connect format for backend sync.
 */
@Serializable
data class LiveStepsRecord(
    val startTime: String,
    val endTime: String,
    val count: Long,
    val metadata: LiveRecordMetadata
)

@Serializable
private data class StepsSyncBody(val data: List<LiveStepsRecord>)

/**
 * HRV record in Health Connect format for backend sync.
 */
@Serializable
data class LiveHrvRecord(
    val time: String,
    val heartRateVariabilityMillis: Double,
    val metadata: LiveRecordMetadata
)

@Serializable
private data class HrvSyncBody(val data: List<LiveHrvRecord>)

/**
 * Foreground service that manages BLE sensor connections.
 * Keeps connections alive in the background, buffers HR samples,
 * syncs to backend every 5 seconds, and writes to Health Connect.
 */
class SensorService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val connectionManagers = mutableMapOf<String, BleConnectionManager>()
    private val deviceJobs = mutableMapOf<String, List<Job>>()  // Jobs per device address
    private var syncJob: Job? = null

    private val sampleBuffer = mutableListOf<HeartRateSample>()
    private val cadenceSampleBuffer = mutableListOf<CadenceSample>()
    private val rrIntervalBuffer = ArrayDeque<Int>(RR_BUFFER_MAX_SIZE)
    private val hrChartBuffer = mutableListOf<ChartDataPoint>()
    private val hrvChartBuffer = mutableListOf<ChartDataPoint>()
    private val bufferLock = Any()

    private val httpClient by lazy {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    private val healthConnectClient by lazy {
        HealthConnectClient.getOrCreate(applicationContext)
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val deviceAddress = intent.getStringExtra(EXTRA_DEVICE_ADDRESS)
                if (deviceAddress != null) {
                    // Start foreground if not already running
                    if (!_serviceState.value.isRunning) {
                        startForegroundWithNotification()
                    }
                    connectToDevice(deviceAddress)
                } else {
                    Log.w(TAG, "No device address provided")
                    if (!_serviceState.value.hasConnectedDevices) {
                        stopSelf()
                    }
                }
            }
            ACTION_DISCONNECT -> {
                val deviceAddress = intent.getStringExtra(EXTRA_DEVICE_ADDRESS)
                if (deviceAddress != null) {
                    disconnectDevice(deviceAddress)
                } else {
                    disconnectAll()
                }
            }
            ACTION_STOP -> {
                stopSensorService()
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        cleanup()
        serviceScope.cancel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Sensor Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps BLE sensor connections active"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    @SuppressLint("ForegroundServiceType")
    private fun startForegroundWithNotification() {
        val notification = buildNotification(_serviceState.value)
        startForeground(NOTIFICATION_ID, notification)
        updateState { it.copy(isRunning = true) }
    }

    private fun buildNotification(state: SensorServiceState): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, SensorService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val contentText = buildString {
            val hrText = state.currentHeartRate?.let { "HR: $it BPM" }
            val cadenceText = state.currentCadence?.let { "Cadence: $it spm • ${state.stepsSinceStart} steps" }

            when {
                hrText != null && cadenceText != null -> append("$hrText • $cadenceText")
                hrText != null -> append(hrText)
                cadenceText != null -> append(cadenceText)
                state.hasConnectedDevices -> append("${state.connectedDevices.size} sensor(s) connected")
                state.isConnecting -> append("Connecting...")
                else -> append("Ready")
            }
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Aurboda - Sensors Active")
            .setContentText(contentText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openPendingIntent)
            .addAction(0, "Stop", stopPendingIntent)
            .build()
    }

    private fun updateNotification() {
        val notification = buildNotification(_serviceState.value)
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun connectToDevice(deviceAddress: String) {
        // Don't connect if already connected or connecting to this device
        if (connectionManagers.containsKey(deviceAddress)) {
            Log.w(TAG, "Already connected to device: $deviceAddress")
            return
        }
        if (_serviceState.value.connectingDevices.contains(deviceAddress)) {
            Log.w(TAG, "Already connecting to device: $deviceAddress")
            return
        }

        Log.d(TAG, "Connecting to device: $deviceAddress")
        updateState { it.copy(connectingDevices = it.connectingDevices + deviceAddress) }

        val manager = BleConnectionManager(this)
        val jobs = mutableListOf<Job>()

        // Observe connection state
        jobs += serviceScope.launch {
            manager.connectionState.collect { state ->
                Log.d(TAG, "Connection state for $deviceAddress: $state")

                when (state) {
                    is BleConnectionState.Connected -> {
                        updateState { it.copy(connectingDevices = it.connectingDevices - deviceAddress) }
                        startDataCollection(manager, deviceAddress)
                        startSyncLoop()
                    }
                    is BleConnectionState.Disconnected -> {
                        handleDeviceDisconnected(deviceAddress)
                    }
                    is BleConnectionState.Error -> {
                        Log.e(TAG, "Connection error for $deviceAddress: ${state.message}")
                        updateState { it.copy(connectingDevices = it.connectingDevices - deviceAddress) }
                    }
                    else -> {}
                }
            }
        }

        // Observe connected device info
        jobs += serviceScope.launch {
            manager.connectedDeviceInfo.collect { device ->
                if (device != null) {
                    updateState { state ->
                        val deviceState = state.connectedDevices[deviceAddress]?.copy(device = device)
                            ?: DeviceState(device = device)
                        state.copy(connectedDevices = state.connectedDevices + (deviceAddress to deviceState))
                    }
                    updateNotification()
                }
            }
        }

        // Observe battery level
        jobs += serviceScope.launch {
            manager.batteryLevel.collect { level ->
                updateDeviceState(deviceAddress) { it.copy(batteryLevel = level) }
            }
        }

        // Observe current heart rate
        jobs += serviceScope.launch {
            manager.currentHeartRate.collect { hr ->
                updateDeviceState(deviceAddress) { it.copy(currentHeartRate = hr) }
                updateNotification()
            }
        }

        // Observe current cadence
        jobs += serviceScope.launch {
            manager.currentCadence.collect { cadence ->
                updateDeviceState(deviceAddress) { it.copy(currentCadence = cadence) }
                updateNotification()
            }
        }

        // Observe current speed
        jobs += serviceScope.launch {
            manager.currentSpeed.collect { speed ->
                updateDeviceState(deviceAddress) { it.copy(currentSpeed = speed) }
            }
        }

        // Observe cumulative steps
        jobs += serviceScope.launch {
            manager.stepsSinceStart.collect { steps ->
                updateDeviceState(deviceAddress) { it.copy(stepsSinceStart = steps) }
                updateNotification()
            }
        }

        connectionManagers[deviceAddress] = manager
        deviceJobs[deviceAddress] = jobs

        manager.connect(deviceAddress)
    }

    private fun updateDeviceState(deviceAddress: String, update: (DeviceState) -> DeviceState) {
        updateState { state ->
            val deviceState = state.connectedDevices[deviceAddress] ?: return@updateState state
            state.copy(connectedDevices = state.connectedDevices + (deviceAddress to update(deviceState)))
        }
    }

    private fun handleDeviceDisconnected(deviceAddress: String) {
        Log.d(TAG, "Device disconnected: $deviceAddress")

        // Check if this was an HR device and clear RR buffer + HRV state + chart history
        val wasHrDevice = _serviceState.value.connectedDevices[deviceAddress]?.device?.type == SensorType.HEART_RATE
        if (wasHrDevice) {
            synchronized(bufferLock) {
                rrIntervalBuffer.clear()
                hrChartBuffer.clear()
                hrvChartBuffer.clear()
                Log.d(TAG, "Cleared RR interval buffer and chart history due to HR device disconnect")
            }
            updateState { it.copy(
                currentHrv = null,
                hrvReliable = false,
                rrIntervalCount = 0,
                hrChartHistory = emptyList(),
                hrvChartHistory = emptyList()
            ) }
        }

        // Cancel jobs for this device
        deviceJobs[deviceAddress]?.forEach { it.cancel() }
        deviceJobs.remove(deviceAddress)

        // Close and remove connection manager
        connectionManagers[deviceAddress]?.close()
        connectionManagers.remove(deviceAddress)

        // Update state
        updateState { state ->
            state.copy(
                connectedDevices = state.connectedDevices - deviceAddress,
                connectingDevices = state.connectingDevices - deviceAddress
            )
        }
        updateNotification()

        // Stop service if no devices connected
        if (connectionManagers.isEmpty() && _serviceState.value.connectingDevices.isEmpty()) {
            Log.d(TAG, "No devices connected, stopping service")
            stopSensorService()
        }
    }

    private fun startDataCollection(manager: BleConnectionManager, deviceAddress: String) {
        // Add collection jobs to the device's job list
        val existingJobs = deviceJobs[deviceAddress]?.toMutableList() ?: mutableListOf()

        existingJobs += serviceScope.launch {
            manager.heartRateSamples.collect { sample ->
                synchronized(bufferLock) {
                    sampleBuffer.add(sample)

                    // Add to chart history and prune old data
                    val now = System.currentTimeMillis()
                    val cutoff = now - CHART_HISTORY_DURATION_MS
                    hrChartBuffer.add(ChartDataPoint(now, sample.bpm.toFloat()))
                    hrChartBuffer.removeAll { it.timestamp < cutoff }

                    updateState { it.copy(
                        pendingSamples = sampleBuffer.size,
                        hrChartHistory = hrChartBuffer.toList()
                    ) }

                    // Collect RR intervals for HRV calculation (rolling window)
                    sample.rrIntervals?.forEach { rr ->
                        if (rrIntervalBuffer.size >= RR_BUFFER_MAX_SIZE) {
                            rrIntervalBuffer.removeFirst()
                        }
                        rrIntervalBuffer.addLast(rr)
                    }
                }
            }
        }

        existingJobs += serviceScope.launch {
            manager.cadenceSamples.collect { sample ->
                synchronized(bufferLock) {
                    cadenceSampleBuffer.add(sample)
                    updateState { it.copy(pendingCadenceSamples = cadenceSampleBuffer.size) }
                }
            }
        }

        deviceJobs[deviceAddress] = existingJobs
    }

    private fun startSyncLoop() {
        syncJob?.cancel()
        syncJob = serviceScope.launch {
            while (true) {
                delay(SYNC_INTERVAL_MS)
                syncPendingSamples()
            }
        }
    }

    private suspend fun syncPendingSamples() {
        val hrSamplesToSync: List<HeartRateSample>
        val cadenceSamplesToSync: List<CadenceSample>
        val rrIntervalsForHrv: List<Int>

        synchronized(bufferLock) {
            hrSamplesToSync = sampleBuffer.toList()
            cadenceSamplesToSync = cadenceSampleBuffer.toList()
            // Copy RR intervals for HRV calculation (don't clear - rolling window)
            rrIntervalsForHrv = rrIntervalBuffer.toList()

            if (hrSamplesToSync.isEmpty() && cadenceSamplesToSync.isEmpty()) return
            sampleBuffer.clear()
            cadenceSampleBuffer.clear()
            updateState { it.copy(pendingSamples = 0, pendingCadenceSamples = 0) }
        }

        // Sync HR samples if any
        if (hrSamplesToSync.isNotEmpty()) {
            Log.d(TAG, "Syncing ${hrSamplesToSync.size} HR samples")
            val backendSuccess = syncHeartRateToBackend(hrSamplesToSync)
            if (!backendSuccess) {
                synchronized(bufferLock) {
                    sampleBuffer.addAll(0, hrSamplesToSync)
                    updateState { it.copy(pendingSamples = sampleBuffer.size) }
                }
            } else {
                writeHeartRateToHealthConnect(hrSamplesToSync)
            }
        }

        // Sync cadence/steps samples if any
        if (cadenceSamplesToSync.isNotEmpty()) {
            Log.d(TAG, "Syncing ${cadenceSamplesToSync.size} cadence samples")
            val backendSuccess = syncStepsToBackend(cadenceSamplesToSync)
            if (!backendSuccess) {
                synchronized(bufferLock) {
                    cadenceSampleBuffer.addAll(0, cadenceSamplesToSync)
                    updateState { it.copy(pendingCadenceSamples = cadenceSampleBuffer.size) }
                }
            } else {
                writeStepsToHealthConnect(cadenceSamplesToSync)
            }
        }

        // Calculate and sync HRV if we have enough RR intervals
        if (rrIntervalsForHrv.size >= RR_BUFFER_MIN_SIZE) {
            val hrvResult = calculateHrv(rrIntervalsForHrv)
            Log.d(TAG, "HRV calculation: rmssd=${hrvResult.rmssd}, valid=${hrvResult.validIntervals}, " +
                    "artifacts=${hrvResult.artifactCount} (${String.format("%.1f", hrvResult.artifactPercentage)}%), " +
                    "reliable=${hrvResult.isReliable}")

            // Add to HRV chart history if we have a valid value
            if (hrvResult.rmssd != null) {
                synchronized(bufferLock) {
                    val now = System.currentTimeMillis()
                    val cutoff = now - CHART_HISTORY_DURATION_MS
                    hrvChartBuffer.add(ChartDataPoint(now, hrvResult.rmssd.toFloat()))
                    hrvChartBuffer.removeAll { it.timestamp < cutoff }
                }
            }

            // Update state for UI display
            updateState { it.copy(
                currentHrv = hrvResult.rmssd,
                hrvReliable = hrvResult.isReliable,
                rrIntervalCount = rrIntervalsForHrv.size,
                hrvChartHistory = hrvChartBuffer.toList()
            ) }

            if (hrvResult.isReliable && hrvResult.rmssd != null) {
                val timestamp = Instant.now()
                syncHrvToBackend(hrvResult.rmssd, timestamp)
                writeHrvToHealthConnect(hrvResult.rmssd, timestamp)
            }
        } else {
            // Update state to show collecting progress
            updateState { it.copy(
                currentHrv = null,
                hrvReliable = false,
                rrIntervalCount = rrIntervalsForHrv.size
            ) }
            if (rrIntervalsForHrv.isNotEmpty()) {
                Log.d(TAG, "HRV: Collecting RR intervals (${rrIntervalsForHrv.size}/$RR_BUFFER_MIN_SIZE)")
            }
        }

        updateState { it.copy(lastSyncTime = Instant.now()) }
    }

    private suspend fun syncHeartRateToBackend(samples: List<HeartRateSample>): Boolean {
        val credentials = CredentialsManager.getCredentials(this) ?: run {
            Log.w(TAG, "No credentials, skipping backend sync")
            return true // Don't block on missing credentials
        }

        if (samples.isEmpty()) return true

        // Sort samples and create a single HeartRateRecord in Health Connect format
        val sortedSamples = samples.sortedBy { it.timestamp }
        val startTime = sortedSamples.first().timestamp
        val endTime = sortedSamples.last().timestamp.plusSeconds(1)

        // Generate unique ID for this batch based on start time
        val recordId = "live-hr-${startTime.epochSecond}-${startTime.nano}"

        // Get device info from HR device if available
        val hrManager = connectionManagers.values.find {
            it.connectedDeviceInfo.value?.type == SensorType.HEART_RATE
        }
        val deviceInfo = hrManager?.connectedDeviceInfo?.value?.let { device ->
            LiveDeviceInfo(
                type = 2, // TYPE_CHEST_STRAP
                model = device.name
            )
        }

        val record = LiveHeartRateRecord(
            startTime = startTime.toString(),
            endTime = endTime.toString(),
            samples = sortedSamples.map { sample ->
                LiveHeartRateSample(
                    time = sample.timestamp.toString(),
                    beatsPerMinute = sample.bpm.toLong()
                )
            },
            metadata = LiveRecordMetadata(
                id = recordId,
                device = deviceInfo
            )
        )

        return try {
            val response = httpClient.post("${credentials.apiUrl}/sync/HeartRateRecord") {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer ${credentials.authToken}") }
                setBody(HeartRateSyncBody(listOf(record)))
            }
            val success = response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
            Log.d(TAG, "Backend sync ${if (success) "succeeded" else "failed"}: ${response.status}")
            success
        } catch (e: Exception) {
            Log.e(TAG, "Backend sync error", e)
            false
        }
    }

    private suspend fun writeHeartRateToHealthConnect(samples: List<HeartRateSample>) {
        if (samples.isEmpty()) return

        try {
            // Check write permission
            val grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
            val writePermission = HealthPermission.getWritePermission(HeartRateRecord::class)
            if (writePermission !in grantedPermissions) {
                Log.w(TAG, "No Health Connect write permission for HeartRateRecord")
                return
            }

            // Group samples into 1-second intervals for Health Connect
            // Health Connect expects HeartRateRecord with a time range and samples
            val sortedSamples = samples.sortedBy { it.timestamp }
            val startTime = sortedSamples.first().timestamp
            val endTime = sortedSamples.last().timestamp.plusSeconds(1)

            val hrSamples = sortedSamples.map { sample ->
                HeartRateRecord.Sample(
                    time = sample.timestamp,
                    beatsPerMinute = sample.bpm.toLong()
                )
            }

            val record = HeartRateRecord(
                startTime = startTime,
                startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
                endTime = endTime,
                endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
                samples = hrSamples,
                metadata = Metadata.autoRecorded(
                    device = Device(type = Device.TYPE_CHEST_STRAP)
                )
            )

            healthConnectClient.insertRecords(listOf(record))
            Log.d(TAG, "Wrote ${samples.size} HR samples to Health Connect")
        } catch (e: Exception) {
            Log.e(TAG, "Health Connect write error", e)
        }
    }

    private suspend fun syncStepsToBackend(samples: List<CadenceSample>): Boolean {
        val credentials = CredentialsManager.getCredentials(this) ?: run {
            Log.w(TAG, "No credentials, skipping backend sync")
            return true // Don't block on missing credentials
        }

        if (samples.isEmpty()) return true

        // Calculate total steps from cadence samples by integrating over time intervals
        val sortedSamples = samples.sortedBy { it.timestamp }
        val startTime = sortedSamples.first().timestamp
        val endTime = sortedSamples.last().timestamp.plusSeconds(1)

        // Calculate total steps - integrate cadence over time
        var totalSteps = 0L
        for (i in 0 until sortedSamples.size - 1) {
            val current = sortedSamples[i]
            val next = sortedSamples[i + 1]
            val elapsedSeconds = java.time.Duration.between(current.timestamp, next.timestamp).toMillis() / 1000.0
            // cadence is steps/minute, convert to steps in elapsed time
            val stepsInInterval = current.cadence * elapsedSeconds / 60.0
            totalSteps += stepsInInterval.toLong()
        }
        // Add steps for last sample (assume 1 second interval)
        if (sortedSamples.isNotEmpty()) {
            totalSteps += (sortedSamples.last().cadence / 60.0).toLong()
        }

        if (totalSteps <= 0) {
            Log.d(TAG, "No steps to sync (cadence was 0)")
            return true
        }

        val recordId = "live-steps-${startTime.epochSecond}-${startTime.nano}"

        // Get device info from RSC device if available
        val rscManager = connectionManagers.values.find {
            it.connectedDeviceInfo.value?.type == SensorType.RUNNING_SPEED_CADENCE
        }
        val deviceInfo = rscManager?.connectedDeviceInfo?.value?.let { device ->
            LiveDeviceInfo(
                type = 4, // TYPE_WATCH or foot pod
                model = device.name
            )
        }

        val record = LiveStepsRecord(
            startTime = startTime.toString(),
            endTime = endTime.toString(),
            count = totalSteps,
            metadata = LiveRecordMetadata(
                id = recordId,
                device = deviceInfo
            )
        )

        return try {
            val response = httpClient.post("${credentials.apiUrl}/sync/StepsRecord") {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer ${credentials.authToken}") }
                setBody(StepsSyncBody(listOf(record)))
            }
            val success = response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
            Log.d(TAG, "Steps backend sync ${if (success) "succeeded" else "failed"}: ${response.status}")
            success
        } catch (e: Exception) {
            Log.e(TAG, "Steps backend sync error", e)
            false
        }
    }

    private suspend fun writeStepsToHealthConnect(samples: List<CadenceSample>) {
        if (samples.isEmpty()) return

        try {
            // Check write permission
            val grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
            val writePermission = HealthPermission.getWritePermission(StepsRecord::class)
            if (writePermission !in grantedPermissions) {
                Log.w(TAG, "No Health Connect write permission for StepsRecord")
                return
            }

            // Calculate total steps from cadence samples
            val sortedSamples = samples.sortedBy { it.timestamp }
            val startTime = sortedSamples.first().timestamp
            val endTime = sortedSamples.last().timestamp.plusSeconds(1)

            // Calculate total steps - integrate cadence over time
            var totalSteps = 0L
            for (i in 0 until sortedSamples.size - 1) {
                val current = sortedSamples[i]
                val next = sortedSamples[i + 1]
                val elapsedSeconds = java.time.Duration.between(current.timestamp, next.timestamp).toMillis() / 1000.0
                val stepsInInterval = current.cadence * elapsedSeconds / 60.0
                totalSteps += stepsInInterval.toLong()
            }
            if (sortedSamples.isNotEmpty()) {
                totalSteps += (sortedSamples.last().cadence / 60.0).toLong()
            }

            if (totalSteps <= 0) {
                Log.d(TAG, "No steps to write to Health Connect (cadence was 0)")
                return
            }

            val record = StepsRecord(
                startTime = startTime,
                startZoneOffset = ZoneOffset.systemDefault().rules.getOffset(startTime),
                endTime = endTime,
                endZoneOffset = ZoneOffset.systemDefault().rules.getOffset(endTime),
                count = totalSteps,
                metadata = Metadata.autoRecorded(
                    device = Device(type = Device.TYPE_WATCH)
                )
            )

            healthConnectClient.insertRecords(listOf(record))
            Log.d(TAG, "Wrote $totalSteps steps to Health Connect")
        } catch (e: Exception) {
            Log.e(TAG, "Health Connect steps write error", e)
        }
    }

    private suspend fun syncHrvToBackend(rmssd: Double, timestamp: Instant) {
        val credentials = CredentialsManager.getCredentials(this) ?: run {
            Log.w(TAG, "No credentials, skipping HRV backend sync")
            return
        }

        val recordId = "live-hrv-${timestamp.epochSecond}-${timestamp.nano}"

        // Get device info from HR device if available
        val hrManager = connectionManagers.values.find {
            it.connectedDeviceInfo.value?.type == SensorType.HEART_RATE
        }
        val deviceInfo = hrManager?.connectedDeviceInfo?.value?.let { device ->
            LiveDeviceInfo(
                type = 2, // TYPE_CHEST_STRAP
                model = device.name
            )
        }

        val record = LiveHrvRecord(
            time = timestamp.toString(),
            heartRateVariabilityMillis = rmssd,
            metadata = LiveRecordMetadata(
                id = recordId,
                device = deviceInfo
            )
        )

        try {
            val response = httpClient.post("${credentials.apiUrl}/sync/HeartRateVariabilityRmssdRecord") {
                contentType(ContentType.Application.Json)
                headers { append(HttpHeaders.Authorization, "Bearer ${credentials.authToken}") }
                setBody(HrvSyncBody(listOf(record)))
            }
            val success = response.status == HttpStatusCode.OK || response.status == HttpStatusCode.Created
            Log.d(TAG, "HRV backend sync ${if (success) "succeeded" else "failed"}: ${response.status}")
        } catch (e: Exception) {
            Log.e(TAG, "HRV backend sync error", e)
        }
    }

    private suspend fun writeHrvToHealthConnect(rmssd: Double, timestamp: Instant) {
        try {
            // Check write permission
            val grantedPermissions = healthConnectClient.permissionController.getGrantedPermissions()
            val writePermission = HealthPermission.getWritePermission(HeartRateVariabilityRmssdRecord::class)
            if (writePermission !in grantedPermissions) {
                Log.w(TAG, "No Health Connect write permission for HeartRateVariabilityRmssdRecord")
                return
            }

            val record = HeartRateVariabilityRmssdRecord(
                time = timestamp,
                zoneOffset = ZoneOffset.systemDefault().rules.getOffset(timestamp),
                heartRateVariabilityMillis = rmssd,
                metadata = Metadata.autoRecorded(
                    device = Device(type = Device.TYPE_CHEST_STRAP)
                )
            )

            healthConnectClient.insertRecords(listOf(record))
            Log.d(TAG, "Wrote HRV (RMSSD=${String.format("%.1f", rmssd)}ms) to Health Connect")
        } catch (e: Exception) {
            Log.e(TAG, "Health Connect HRV write error", e)
        }
    }

    private fun disconnectDevice(deviceAddress: String) {
        Log.d(TAG, "Disconnecting device: $deviceAddress")
        connectionManagers[deviceAddress]?.disconnect()
    }

    private fun disconnectAll() {
        Log.d(TAG, "Disconnecting all devices...")
        connectionManagers.keys.toList().forEach { address ->
            connectionManagers[address]?.disconnect()
        }
    }

    private fun stopSensorService() {
        Log.d(TAG, "Stopping service...")
        cleanup()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        updateState { SensorServiceState() }
    }

    private fun cleanup() {
        syncJob?.cancel()

        // Cancel all device jobs
        deviceJobs.values.forEach { jobs ->
            jobs.forEach { it.cancel() }
        }
        deviceJobs.clear()

        // Close all connection managers
        connectionManagers.values.forEach { it.close() }
        connectionManagers.clear()

        // Clear all buffers
        synchronized(bufferLock) {
            sampleBuffer.clear()
            cadenceSampleBuffer.clear()
            rrIntervalBuffer.clear()
            hrChartBuffer.clear()
            hrvChartBuffer.clear()
        }
    }

    private fun updateState(update: (SensorServiceState) -> SensorServiceState) {
        _serviceState.value = update(_serviceState.value)
    }

    companion object {
        const val ACTION_CONNECT = "net.aurboda.action.CONNECT_SENSOR"
        const val ACTION_DISCONNECT = "net.aurboda.action.DISCONNECT_SENSOR"
        const val ACTION_STOP = "net.aurboda.action.STOP_SENSOR_SERVICE"
        const val EXTRA_DEVICE_ADDRESS = "device_address"

        private val _serviceState = MutableStateFlow(SensorServiceState())
        val serviceState: StateFlow<SensorServiceState> = _serviceState.asStateFlow()

        fun connect(context: Context, deviceAddress: String) {
            val intent = Intent(context, SensorService::class.java).apply {
                action = ACTION_CONNECT
                putExtra(EXTRA_DEVICE_ADDRESS, deviceAddress)
            }
            context.startForegroundService(intent)
        }

        fun disconnect(context: Context, deviceAddress: String) {
            val intent = Intent(context, SensorService::class.java).apply {
                action = ACTION_DISCONNECT
                putExtra(EXTRA_DEVICE_ADDRESS, deviceAddress)
            }
            context.startService(intent)
        }

        fun disconnectAll(context: Context) {
            val intent = Intent(context, SensorService::class.java).apply {
                action = ACTION_DISCONNECT
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, SensorService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        internal fun updateServiceState(state: SensorServiceState) {
            _serviceState.value = state
        }
    }
}
