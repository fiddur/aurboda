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

/**
 * State exposed by SensorService to the UI.
 */
data class SensorServiceState(
    val isRunning: Boolean = false,
    val connectionState: BleConnectionState = BleConnectionState.Disconnected,
    val connectedDevice: ConnectedDevice? = null,
    val currentHeartRate: Int? = null,
    val batteryLevel: Int? = null,
    val lastSyncTime: Instant? = null,
    val pendingSamples: Int = 0
)

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
 * Foreground service that manages BLE sensor connections.
 * Keeps connections alive in the background, buffers HR samples,
 * syncs to backend every 5 seconds, and writes to Health Connect.
 */
class SensorService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var connectionManager: BleConnectionManager? = null
    private var syncJob: Job? = null
    private var hrCollectionJob: Job? = null

    private val sampleBuffer = mutableListOf<HeartRateSample>()
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
                    startForegroundWithNotification()
                    connectToDevice(deviceAddress)
                } else {
                    Log.w(TAG, "No device address provided")
                    stopSelf()
                }
            }
            ACTION_DISCONNECT -> {
                disconnect()
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
        val notification = buildNotification(null)
        startForeground(NOTIFICATION_ID, notification)
        updateState { it.copy(isRunning = true) }
    }

    private fun buildNotification(heartRate: Int?): Notification {
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

        val contentText = if (heartRate != null) {
            "Heart rate: $heartRate BPM"
        } else {
            "Connecting to sensor..."
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

    private fun updateNotification(heartRate: Int?) {
        val notification = buildNotification(heartRate)
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun connectToDevice(deviceAddress: String) {
        Log.d(TAG, "Connecting to device: $deviceAddress")

        connectionManager = BleConnectionManager(this).also { manager ->
            // Observe connection state
            serviceScope.launch {
                manager.connectionState.collect { state ->
                    Log.d(TAG, "Connection state: $state")
                    updateState { it.copy(connectionState = state) }

                    when (state) {
                        is BleConnectionState.Connected -> {
                            startDataCollection(manager)
                            startSyncLoop()
                        }
                        is BleConnectionState.Disconnected -> {
                            stopDataCollection()
                            // Auto-reconnect could be added here
                        }
                        is BleConnectionState.Error -> {
                            Log.e(TAG, "Connection error: ${state.message}")
                        }
                        else -> {}
                    }
                }
            }

            // Observe connected device info
            serviceScope.launch {
                manager.connectedDeviceInfo.collect { device ->
                    updateState { it.copy(connectedDevice = device) }
                }
            }

            // Observe current heart rate for notification
            serviceScope.launch {
                manager.currentHeartRate.collect { hr ->
                    updateState { it.copy(currentHeartRate = hr) }
                    updateNotification(hr)
                }
            }

            // Observe battery level
            serviceScope.launch {
                manager.batteryLevel.collect { level ->
                    updateState { it.copy(batteryLevel = level) }
                }
            }

            manager.connect(deviceAddress)
        }
    }

    private fun startDataCollection(manager: BleConnectionManager) {
        hrCollectionJob?.cancel()
        hrCollectionJob = serviceScope.launch {
            manager.heartRateSamples.collect { sample ->
                synchronized(bufferLock) {
                    sampleBuffer.add(sample)
                    updateState { it.copy(pendingSamples = sampleBuffer.size) }
                }
            }
        }
    }

    private fun stopDataCollection() {
        hrCollectionJob?.cancel()
        hrCollectionJob = null
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
        val samplesToSync: List<HeartRateSample>
        synchronized(bufferLock) {
            if (sampleBuffer.isEmpty()) return
            samplesToSync = sampleBuffer.toList()
            sampleBuffer.clear()
            updateState { it.copy(pendingSamples = 0) }
        }

        Log.d(TAG, "Syncing ${samplesToSync.size} HR samples")

        // Sync to backend
        val backendSuccess = syncToBackend(samplesToSync)
        if (!backendSuccess) {
            // Re-add samples to buffer on failure
            synchronized(bufferLock) {
                sampleBuffer.addAll(0, samplesToSync)
                updateState { it.copy(pendingSamples = sampleBuffer.size) }
            }
            return
        }

        // Write to Health Connect
        writeToHealthConnect(samplesToSync)

        updateState { it.copy(lastSyncTime = Instant.now()) }
    }

    private suspend fun syncToBackend(samples: List<HeartRateSample>): Boolean {
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

        // Get device info if available
        val deviceInfo = connectionManager?.connectedDeviceInfo?.value?.let { device ->
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

    private suspend fun writeToHealthConnect(samples: List<HeartRateSample>) {
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

    private fun disconnect() {
        Log.d(TAG, "Disconnecting...")
        connectionManager?.disconnect()
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
        hrCollectionJob?.cancel()
        connectionManager?.close()
        connectionManager = null
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

        fun disconnect(context: Context) {
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
