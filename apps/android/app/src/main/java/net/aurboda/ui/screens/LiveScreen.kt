package net.aurboda.ui.screens

import android.Manifest
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import net.aurboda.ble.BleConnectionState
import net.aurboda.ble.BleScanState
import net.aurboda.ble.DiscoveredDevice
import net.aurboda.ble.SensorService
import net.aurboda.ble.SensorType
import net.aurboda.ble.hasBlePermissions
import net.aurboda.ble.isBleEnabled
import net.aurboda.ble.isBleSupported
import net.aurboda.ble.scanForSensors

@Composable
fun LiveScreen(
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var hasPermissions by remember { mutableStateOf(hasBlePermissions(context)) }
    var bleEnabled by remember { mutableStateOf(isBleEnabled(context)) }
    val bleSupported = remember { isBleSupported(context) }

    // Health Connect client and write permission state
    val healthConnectClient = remember { HealthConnectClient.getOrCreate(context) }
    var hasHrWritePermission by remember { mutableStateOf<Boolean?>(null) }
    var hasStepsWritePermission by remember { mutableStateOf<Boolean?>(null) }
    var pendingDeviceToConnect by remember { mutableStateOf<DiscoveredDevice?>(null) }

    val hrWritePermission = remember {
        HealthPermission.getWritePermission(HeartRateRecord::class)
    }
    val stepsWritePermission = remember {
        HealthPermission.getWritePermission(StepsRecord::class)
    }

    // Health Connect permission launcher
    val healthConnectPermissionLauncher = rememberLauncherForActivityResult(
        contract = PermissionController.createRequestPermissionResultContract()
    ) { granted: Set<String> ->
        val hasHrPermission = granted.contains(hrWritePermission)
        val hasStepsPermission = granted.contains(stepsWritePermission)
        hasHrWritePermission = hasHrPermission
        hasStepsWritePermission = hasStepsPermission
        Log.d("LiveScreen", "Health Connect permission result: hr=$hasHrPermission, steps=$hasStepsPermission")

        // Connect to device regardless of permission result - data still syncs to backend,
        // and SensorService gracefully handles missing Health Connect write permission
        pendingDeviceToConnect?.let { device ->
            SensorService.connect(context, device.address)
            pendingDeviceToConnect = null
        }
    }

    // Check Health Connect permission on launch
    // Only set to true if granted; leave as null if not granted (so we ask on first connect)
    LaunchedEffect(Unit) {
        val granted = healthConnectClient.permissionController.getGrantedPermissions()
        val hrGranted = granted.contains(hrWritePermission)
        val stepsGranted = granted.contains(stepsWritePermission)
        if (hrGranted) hasHrWritePermission = true
        if (stepsGranted) hasStepsWritePermission = true
        Log.d("LiveScreen", "Initial Health Connect permissions: hr=$hrGranted, steps=$stepsGranted")
    }

    // Observe service state
    val serviceState by SensorService.serviceState.collectAsState()
    val connectionState = serviceState.connectionState
    val connectedDevice = serviceState.connectedDevice
    val currentHeartRate = serviceState.currentHeartRate

    var isScanning by remember { mutableStateOf(false) }
    var scanError by remember { mutableStateOf<String?>(null) }
    val discoveredDevices = remember { mutableStateListOf<DiscoveredDevice>() }

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        hasPermissions = permissions.values.all { it }
    }

    // Scan for devices
    LaunchedEffect(isScanning) {
        if (isScanning && hasPermissions && bleEnabled) {
            scanError = null
            discoveredDevices.clear()
            scanForSensors(context).collect { state ->
                when (state) {
                    is BleScanState.Scanning -> { /* Already handled by isScanning flag */ }
                    is BleScanState.DeviceFound -> {
                        if (discoveredDevices.none { it.address == state.device.address }) {
                            discoveredDevices.add(state.device)
                        }
                    }
                    is BleScanState.Error -> {
                        scanError = state.message
                        isScanning = false
                    }
                    is BleScanState.ScanComplete -> {
                        isScanning = false
                    }
                    is BleScanState.Idle -> { /* Initial state */ }
                }
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Live Sensors",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        if (!bleSupported) {
            Text(
                text = "Bluetooth Low Energy is not supported on this device",
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center
            )
            return@Column
        }

        if (!hasPermissions) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Bluetooth permissions are required to connect to heart rate monitors and step sensors.",
                    textAlign = TextAlign.Center
                )
                Button(
                    onClick = {
                        permissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.BLUETOOTH_SCAN,
                                Manifest.permission.BLUETOOTH_CONNECT,
                                Manifest.permission.ACCESS_FINE_LOCATION
                            )
                        )
                    }
                ) {
                    Text("Grant Permissions")
                }
            }
            return@Column
        }

        if (!bleEnabled) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Bluetooth is disabled. Please enable it to connect to sensors.",
                    textAlign = TextAlign.Center
                )
                Button(
                    onClick = {
                        context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                    }
                ) {
                    Text("Open Bluetooth Settings")
                }
                Button(
                    onClick = { bleEnabled = isBleEnabled(context) }
                ) {
                    Text("Refresh")
                }
            }
            return@Column
        }

        // Connected Device Section
        when (val state = connectionState) {
            is BleConnectionState.Connected -> {
                val healthConnectEnabled = when (connectedDevice?.type) {
                    SensorType.HEART_RATE -> hasHrWritePermission == true
                    SensorType.RUNNING_SPEED_CADENCE -> hasStepsWritePermission == true
                    null -> false
                }
                val requiredPermissions = when (connectedDevice?.type) {
                    SensorType.HEART_RATE -> setOf(hrWritePermission)
                    SensorType.RUNNING_SPEED_CADENCE -> setOf(stepsWritePermission)
                    null -> emptySet()
                }
                ConnectedDeviceCard(
                    device = connectedDevice,
                    heartRate = currentHeartRate,
                    cadence = serviceState.currentCadence,
                    stepsSinceStart = serviceState.stepsSinceStart,
                    batteryLevel = serviceState.batteryLevel,
                    serviceRunning = serviceState.isRunning,
                    pendingSamples = serviceState.pendingSamples + serviceState.pendingCadenceSamples,
                    healthConnectEnabled = healthConnectEnabled,
                    onEnableHealthConnect = {
                        healthConnectPermissionLauncher.launch(requiredPermissions)
                    },
                    onDisconnect = { SensorService.stop(context) }
                )
                Spacer(modifier = Modifier.height(16.dp))
            }
            is BleConnectionState.Connecting -> {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Connecting...")
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
            is BleConnectionState.Error -> {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Connection Error",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            text = state.message,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
            is BleConnectionState.Disconnected -> {
                // Show nothing when disconnected, scan section will be visible
            }
        }

        // Scanner Section
        if (connectionState is BleConnectionState.Disconnected || connectionState is BleConnectionState.Error) {
            ScannerSection(
                isScanning = isScanning,
                discoveredDevices = discoveredDevices,
                scanError = scanError,
                onStartScan = {
                    isScanning = true
                },
                onStopScan = {
                    isScanning = false
                },
                onConnectDevice = { device ->
                    // Check Health Connect write permission based on device type
                    val hasPermission = when (device.sensorType) {
                        SensorType.HEART_RATE -> hasHrWritePermission
                        SensorType.RUNNING_SPEED_CADENCE -> hasStepsWritePermission
                    }
                    val requiredPermissions = when (device.sensorType) {
                        SensorType.HEART_RATE -> setOf(hrWritePermission)
                        SensorType.RUNNING_SPEED_CADENCE -> setOf(stepsWritePermission)
                    }

                    when (hasPermission) {
                        true -> {
                            // Permission already granted, connect directly
                            SensorService.connect(context, device.address)
                        }
                        false -> {
                            // Permission was denied previously, connect anyway
                            // (data still syncs to backend, just not to Health Connect)
                            SensorService.connect(context, device.address)
                        }
                        null -> {
                            // Haven't asked yet, request permission first
                            pendingDeviceToConnect = device
                            healthConnectPermissionLauncher.launch(requiredPermissions)
                        }
                    }
                }
            )
        }
    }
}

@Composable
private fun ConnectedDeviceCard(
    device: net.aurboda.ble.ConnectedDevice?,
    heartRate: Int?,
    cadence: Int?,
    stepsSinceStart: Int,
    batteryLevel: Int?,
    serviceRunning: Boolean,
    pendingSamples: Int,
    healthConnectEnabled: Boolean,
    onEnableHealthConnect: () -> Unit,
    onDisconnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = device?.name ?: "Unknown Device",
                    style = MaterialTheme.typography.titleMedium
                )
                // Battery indicator
                if (batteryLevel != null) {
                    Spacer(modifier = Modifier.width(8.dp))
                    BatteryIndicator(level = batteryLevel)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            when (device?.type) {
                SensorType.HEART_RATE -> {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Favorite,
                            contentDescription = "Heart Rate",
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(48.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = heartRate?.toString() ?: "--",
                            fontSize = 64.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "BPM",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                        )
                    }
                }
                SensorType.RUNNING_SPEED_CADENCE -> {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Cadence row
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.PlayArrow,
                                contentDescription = "Cadence",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(48.dp)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = cadence?.toString() ?: "--",
                                fontSize = 64.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "SPM",
                                style = MaterialTheme.typography.titleLarge,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        // Steps since start
                        Text(
                            text = "$stepsSinceStart steps since start",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
                        )
                    }
                }
                null -> { /* Unknown device type */ }
            }

            // Service status
            if (serviceRunning) {
                Spacer(modifier = Modifier.height(8.dp))
                val statusText = buildString {
                    append(if (pendingSamples > 0) "Syncing ($pendingSamples pending)" else "Syncing to cloud")
                    if (!healthConnectEnabled) {
                        append(" • Health Connect disabled")
                    }
                }
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (healthConnectEnabled)
                        MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                    else
                        MaterialTheme.colorScheme.error.copy(alpha = 0.8f)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(onClick = onDisconnect) {
                    Text("Stop")
                }
                if (!healthConnectEnabled) {
                    Button(onClick = onEnableHealthConnect) {
                        Text("Enable Health Connect")
                    }
                }
            }
        }
    }
}

@Composable
private fun ScannerSection(
    isScanning: Boolean,
    discoveredDevices: List<DiscoveredDevice>,
    scanError: String?,
    onStartScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnectDevice: (DiscoveredDevice) -> Unit
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Scan button
        if (isScanning) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Text("Scanning for devices...")
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(onClick = onStopScan) {
                Text("Stop Scan")
            }
        } else {
            Button(onClick = onStartScan) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Scan for Devices")
            }
        }

        if (scanError != null) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = scanError,
                color = MaterialTheme.colorScheme.error
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Discovered devices list
        if (discoveredDevices.isNotEmpty()) {
            Text(
                text = "Discovered Devices",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(discoveredDevices) { device ->
                    DiscoveredDeviceItem(
                        device = device,
                        onConnect = { onConnectDevice(device) }
                    )
                }
            }
        } else if (!isScanning) {
            Text(
                text = "No devices found. Make sure your heart rate monitor is turned on and in pairing mode.",
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DiscoveredDeviceItem(
    device: DiscoveredDevice,
    onConnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (device.sensorType) {
                    SensorType.HEART_RATE -> Icons.Default.Favorite
                    SensorType.RUNNING_SPEED_CADENCE -> Icons.Default.PlayArrow
                },
                contentDescription = null,
                tint = when (device.sensorType) {
                    SensorType.HEART_RATE -> MaterialTheme.colorScheme.error
                    SensorType.RUNNING_SPEED_CADENCE -> MaterialTheme.colorScheme.primary
                }
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.name ?: "Unknown Device",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = when (device.sensorType) {
                        SensorType.HEART_RATE -> "Heart Rate Monitor"
                        SensorType.RUNNING_SPEED_CADENCE -> "Step Sensor"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "Signal: ${device.rssi} dBm",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Button(onClick = onConnect) {
                Text("Connect")
            }
        }
    }
}

@Composable
private fun BatteryIndicator(level: Int) {
    val color = when {
        level <= 20 -> MaterialTheme.colorScheme.error
        level <= 50 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.primary
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(horizontal = 4.dp)
    ) {
        // Battery body
        Box(
            modifier = Modifier
                .size(width = 20.dp, height = 10.dp)
                .border(1.dp, color, shape = MaterialTheme.shapes.extraSmall)
                .padding(1.dp)
        ) {
            // Battery fill level
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(level / 100f)
                    .background(color, shape = MaterialTheme.shapes.extraSmall)
            )
        }
        // Battery tip
        Box(
            modifier = Modifier
                .size(width = 2.dp, height = 5.dp)
                .background(color, shape = MaterialTheme.shapes.extraSmall)
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = "$level%",
            style = MaterialTheme.typography.bodySmall,
            color = color
        )
    }
}
