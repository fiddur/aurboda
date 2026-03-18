package net.aurboda.ui.screens

import android.Manifest
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
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
import net.aurboda.ble.BleScanState
import net.aurboda.ble.ChartDataPoint
import net.aurboda.ble.DeviceState
import net.aurboda.ble.DiscoveredDevice
import net.aurboda.ble.SensorService
import net.aurboda.ble.SensorType
import net.aurboda.ble.hasBlePermissions
import net.aurboda.ble.isBleEnabled
import net.aurboda.ble.isBleSupported
import net.aurboda.ble.scanForSensors
import java.time.Duration
import java.time.Instant

@Composable
fun LiveScreen(modifier: Modifier = Modifier) {
  val context = LocalContext.current
  var hasPermissions by remember { mutableStateOf(hasBlePermissions(context)) }
  var bleEnabled by remember { mutableStateOf(isBleEnabled(context)) }
  val bleSupported = remember { isBleSupported(context) }

  // Activity recognition permission for phone step counter (Android 10+)
  var hasActivityRecognitionPermission by remember {
    mutableStateOf(
      androidx.core.content.ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACTIVITY_RECOGNITION,
      ) == android.content.pm.PackageManager.PERMISSION_GRANTED,
    )
  }
  val activityRecognitionPermissionLauncher =
    rememberLauncherForActivityResult(
      contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
      hasActivityRecognitionPermission = granted
      if (granted) {
        SensorService.startPhoneStepCounter(context)
      }
    }

  // Health Connect client and write permission state
  val healthConnectClient = remember { HealthConnectClient.getOrCreate(context) }
  var hasHrWritePermission by remember { mutableStateOf<Boolean?>(null) }
  var hasStepsWritePermission by remember { mutableStateOf<Boolean?>(null) }
  var pendingDeviceToConnect by remember { mutableStateOf<DiscoveredDevice?>(null) }

  val hrWritePermission =
    remember {
      HealthPermission.getWritePermission(HeartRateRecord::class)
    }
  val stepsWritePermission =
    remember {
      HealthPermission.getWritePermission(StepsRecord::class)
    }

  // Health Connect permission launcher
  val healthConnectPermissionLauncher =
    rememberLauncherForActivityResult(
      contract = PermissionController.createRequestPermissionResultContract(),
    ) { granted: Set<String> ->
      // Only update permission state if we actually asked for that permission
      // (don't set to false if we didn't ask for it)
      if (granted.contains(hrWritePermission)) {
        hasHrWritePermission = true
      }
      if (granted.contains(stepsWritePermission)) {
        hasStepsWritePermission = true
      }
      Log.d("LiveScreen", "Health Connect permission granted: $granted")

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
  val connectedDevices = serviceState.connectedDevices
  val connectingDevices = serviceState.connectingDevices

  var isScanning by remember { mutableStateOf(false) }
  var scanError by remember { mutableStateOf<String?>(null) }
  val discoveredDevices = remember { mutableStateListOf<DiscoveredDevice>() }

  // Filter out already connected devices from discovered list
  val availableDevices =
    discoveredDevices.filter { device ->
      !connectedDevices.containsKey(device.address) && !connectingDevices.contains(device.address)
    }

  // Permission launcher
  val permissionLauncher =
    rememberLauncherForActivityResult(
      contract = ActivityResultContracts.RequestMultiplePermissions(),
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
    modifier =
      modifier
        .fillMaxSize()
        .padding(16.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Live Sensors",
      style = MaterialTheme.typography.headlineMedium,
      modifier = Modifier.padding(bottom = 16.dp),
    )

    if (!bleSupported) {
      Text(
        text = "Bluetooth Low Energy is not supported on this device",
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
      )
      return@Column
    }

    if (!hasPermissions) {
      Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Text(
          text = "Bluetooth permissions are required to connect to heart rate monitors and step sensors.",
          textAlign = TextAlign.Center,
        )
        Button(
          onClick = {
            permissionLauncher.launch(
              arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION,
              ),
            )
          },
        ) {
          Text("Grant Permissions")
        }
      }
      return@Column
    }

    if (!bleEnabled) {
      Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Text(
          text = "Bluetooth is disabled. Please enable it to connect to sensors.",
          textAlign = TextAlign.Center,
        )
        Button(
          onClick = {
            context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
          },
        ) {
          Text("Open Bluetooth Settings")
        }
        Button(
          onClick = { bleEnabled = isBleEnabled(context) },
        ) {
          Text("Refresh")
        }
      }
      return@Column
    }

    // Connected Devices Section
    if (connectedDevices.isNotEmpty()) {
      connectedDevices.forEach { (address, deviceState) ->
        val healthConnectEnabled =
          when (deviceState.device.type) {
            SensorType.HEART_RATE -> hasHrWritePermission == true
            SensorType.RUNNING_SPEED_CADENCE -> hasStepsWritePermission == true
          }
        val requiredPermissions =
          when (deviceState.device.type) {
            SensorType.HEART_RATE -> setOf(hrWritePermission)
            SensorType.RUNNING_SPEED_CADENCE -> setOf(stepsWritePermission)
          }
        val autoReconnectEnabled = AutoReconnectPrefs.isAutoReconnectEnabled(context, address)
        ConnectedDeviceCard(
          deviceState = deviceState,
          serviceRunning = serviceState.isRunning,
          pendingSamples = serviceState.pendingSamples + serviceState.pendingCadenceSamples,
          healthConnectEnabled = healthConnectEnabled,
          autoReconnectEnabled = autoReconnectEnabled,
          currentHrv = serviceState.currentHrv,
          hrvReliable = serviceState.hrvReliable,
          rrIntervalCount = serviceState.rrIntervalCount,
          hrChartData = serviceState.hrChartHistory,
          hrvChartData = serviceState.hrvChartHistory,
          onEnableHealthConnect = {
            healthConnectPermissionLauncher.launch(requiredPermissions)
          },
          onToggleAutoReconnect = { enabled ->
            SensorService.toggleAutoReconnect(context, address, enabled)
          },
          onDisconnect = { SensorService.disconnect(context, address) },
        )
        Spacer(modifier = Modifier.height(12.dp))
      }
    }

    // Connecting indicator
    if (connectingDevices.isNotEmpty()) {
      Card(
        modifier = Modifier.fillMaxWidth(),
        colors =
          CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
          ),
      ) {
        Row(
          modifier =
            Modifier
              .fillMaxWidth()
              .padding(16.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.Center,
        ) {
          CircularProgressIndicator(modifier = Modifier.size(24.dp))
          Spacer(modifier = Modifier.width(12.dp))
          Text("Connecting to ${connectingDevices.size} device(s)...")
        }
      }
      Spacer(modifier = Modifier.height(12.dp))
    }

    // Stop All button when multiple devices connected
    if (connectedDevices.size > 1) {
      OutlinedButton(
        onClick = { SensorService.stop(context) },
        modifier = Modifier.fillMaxWidth(),
      ) {
        Text("Stop All Sensors")
      }
      Spacer(modifier = Modifier.height(16.dp))
    }

    // Phone Step Counter Section
    PhoneStepCounterCard(
      isActive = serviceState.phoneStepCounterActive,
      stepCount = serviceState.phoneStepsSinceStart,
      lastUpdateTime = serviceState.phoneStepLastUpdateTime,
      onStart = {
        if (hasActivityRecognitionPermission) {
          SensorService.startPhoneStepCounter(context)
        } else {
          activityRecognitionPermissionLauncher.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        }
      },
      onStop = { SensorService.stopPhoneStepCounter(context) },
    )
    Spacer(modifier = Modifier.height(16.dp))

    // Scanner Section - always visible to allow adding more devices
    ScannerSection(
      isScanning = isScanning,
      discoveredDevices = availableDevices,
      scanError = scanError,
      onStartScan = {
        isScanning = true
      },
      onStopScan = {
        isScanning = false
      },
      onConnectDevice = { device ->
        // Stop scanning once a device is being connected
        isScanning = false

        // Check Health Connect write permission based on device type
        val hasPermission =
          when (device.sensorType) {
            SensorType.HEART_RATE -> hasHrWritePermission
            SensorType.RUNNING_SPEED_CADENCE -> hasStepsWritePermission
          }
        val requiredPermissions =
          when (device.sensorType) {
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
      },
    )
  }
}

@Composable
private fun ConnectedDeviceCard(
  deviceState: DeviceState,
  serviceRunning: Boolean,
  pendingSamples: Int,
  healthConnectEnabled: Boolean,
  autoReconnectEnabled: Boolean,
  currentHrv: Double?,
  hrvReliable: Boolean,
  rrIntervalCount: Int,
  hrChartData: List<ChartDataPoint>,
  hrvChartData: List<ChartDataPoint>,
  onEnableHealthConnect: () -> Unit,
  onToggleAutoReconnect: (Boolean) -> Unit,
  onDisconnect: () -> Unit,
) {
  val device = deviceState.device
  val heartRate = deviceState.currentHeartRate
  val cadence = deviceState.currentCadence
  val stepsSinceStart = deviceState.stepsSinceStart
  val batteryLevel = deviceState.batteryLevel

  Card(
    modifier = Modifier.fillMaxWidth(),
    colors =
      CardDefaults.cardColors(
        containerColor = MaterialTheme.colorScheme.primaryContainer,
      ),
  ) {
    Box(modifier = Modifier.fillMaxWidth()) {
      // Chart background layer - only show for HR devices with data
      if (device.type == SensorType.HEART_RATE && (hrChartData.isNotEmpty() || hrvChartData.isNotEmpty())) {
        LiveDataChart(
          hrData = hrChartData,
          hrvData = hrvChartData,
          modifier =
            Modifier
              .matchParentSize()
              .padding(start = 8.dp, end = 8.dp, top = 32.dp, bottom = 48.dp),
        )
      }

      // Foreground content
      Column(
        modifier =
          Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.Center,
        ) {
          Icon(
            imageVector =
              when (device.type) {
                SensorType.HEART_RATE -> Icons.Default.Favorite
                SensorType.RUNNING_SPEED_CADENCE -> Icons.Default.PlayArrow
              },
            contentDescription = null,
            tint =
              when (device.type) {
                SensorType.HEART_RATE -> MaterialTheme.colorScheme.error
                SensorType.RUNNING_SPEED_CADENCE -> MaterialTheme.colorScheme.primary
              },
          )
          Spacer(modifier = Modifier.width(8.dp))
          Text(
            text = device.name ?: "Unknown Device",
            style = MaterialTheme.typography.titleMedium,
          )
          // Battery indicator
          if (batteryLevel != null) {
            Spacer(modifier = Modifier.width(8.dp))
            BatteryIndicator(level = batteryLevel)
          }
        }

        // Connection health indicator (RSSI + data freshness)
        ConnectionHealthIndicator(
          rssi = deviceState.rssi,
          lastDataReceivedTime = deviceState.lastDataReceivedTime,
        )

        Spacer(modifier = Modifier.height(12.dp))

        when (device.type) {
          SensorType.HEART_RATE -> {
            Row(
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.Center,
            ) {
              Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                  text = heartRate?.toString() ?: "--",
                  fontSize = 48.sp,
                  fontWeight = FontWeight.Bold,
                  color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                  text = "BPM",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                )
              }
              Spacer(modifier = Modifier.width(24.dp))
              Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                  text = currentHrv?.let { String.format("%.0f", it) } ?: "--",
                  fontSize = 32.sp,
                  fontWeight = FontWeight.Bold,
                  color =
                    if (hrvReliable) {
                      MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                      MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.5f)
                    },
                )
                Text(
                  text = if (rrIntervalCount < 30) "HRV ($rrIntervalCount/30)" else "HRV",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                )
              }
            }
          }
          SensorType.RUNNING_SPEED_CADENCE -> {
            Row(
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.Center,
            ) {
              Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                  text = cadence?.toString() ?: "--",
                  fontSize = 48.sp,
                  fontWeight = FontWeight.Bold,
                  color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                  text = "SPM",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                )
              }
              Spacer(modifier = Modifier.width(24.dp))
              Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                  text = stepsSinceStart.toString(),
                  fontSize = 32.sp,
                  fontWeight = FontWeight.Bold,
                  color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                  text = "steps",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                )
              }
            }
          }
        }

        // Service status
        if (serviceRunning) {
          Spacer(modifier = Modifier.height(8.dp))
          val statusText =
            buildString {
              append(if (pendingSamples > 0) "Syncing ($pendingSamples pending)" else "Syncing")
              if (!healthConnectEnabled) {
                append(" • HC off")
              }
            }
          Text(
            text = statusText,
            style = MaterialTheme.typography.bodySmall,
            color =
              if (healthConnectEnabled) {
                MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
              } else {
                MaterialTheme.colorScheme.error.copy(alpha = 0.8f)
              },
          )
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Auto-reconnect toggle
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.Center,
          modifier = Modifier.padding(vertical = 4.dp),
        ) {
          Text(
            text = "Auto-reconnect",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
          )
          Spacer(modifier = Modifier.width(8.dp))
          Switch(
            checked = autoReconnectEnabled,
            onCheckedChange = onToggleAutoReconnect,
          )
        }

        Row(
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          OutlinedButton(onClick = onDisconnect) {
            Text("Disconnect")
          }
          if (!healthConnectEnabled) {
            Button(onClick = onEnableHealthConnect) {
              Text("Enable HC")
            }
          }
        }
      } // Column
    } // Box
  }
}

@Composable
private fun PhoneStepCounterCard(
  isActive: Boolean,
  stepCount: Int,
  lastUpdateTime: Instant?,
  onStart: () -> Unit,
  onStop: () -> Unit,
) {
  Card(
    modifier = Modifier.fillMaxWidth(),
    colors =
      CardDefaults.cardColors(
        containerColor =
          if (isActive) {
            MaterialTheme.colorScheme.tertiaryContainer
          } else {
            MaterialTheme.colorScheme.surfaceVariant
          },
      ),
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .padding(16.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
      ) {
        Icon(
          imageVector = Icons.Default.PlayArrow,
          contentDescription = null,
          tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
          text = "Phone Step Counter",
          style = MaterialTheme.typography.titleMedium,
        )
      }

      if (isActive) {
        Spacer(modifier = Modifier.height(12.dp))

        Text(
          text = stepCount.toString(),
          fontSize = 48.sp,
          fontWeight = FontWeight.Bold,
          color = MaterialTheme.colorScheme.onTertiaryContainer,
        )
        Text(
          text = "steps",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f),
        )

        // Data freshness indicator
        if (lastUpdateTime != null) {
          Spacer(modifier = Modifier.height(4.dp))
          val now = remember { mutableStateOf(Instant.now()) }
          LaunchedEffect(Unit) {
            while (true) {
              now.value = Instant.now()
              kotlinx.coroutines.delay(1000)
            }
          }
          val staleness = Duration.between(lastUpdateTime, now.value).toMillis() / 1000.0
          val stalenessText =
            when {
              staleness < 1 -> "updating now"
              staleness < 60 -> "${staleness.toInt()}s ago"
              else -> "${(staleness / 60).toInt()}m ago"
            }
          Text(
            text = "Last update: $stalenessText",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.6f),
          )
        }

        Spacer(modifier = Modifier.height(8.dp))
        OutlinedButton(onClick = onStop) {
          Text("Stop Counting")
        }
      } else {
        Spacer(modifier = Modifier.height(8.dp))
        Text(
          text = "Use your phone's built-in step sensor",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Button(onClick = onStart) {
          Text("Start Counting")
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
  onConnectDevice: (DiscoveredDevice) -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // Scan button
    if (isScanning) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
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
          contentDescription = null,
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text("Scan for Devices")
      }
    }

    if (scanError != null) {
      Spacer(modifier = Modifier.height(8.dp))
      Text(
        text = scanError,
        color = MaterialTheme.colorScheme.error,
      )
    }

    Spacer(modifier = Modifier.height(16.dp))

    // Discovered devices list
    if (discoveredDevices.isNotEmpty()) {
      Text(
        text = "Discovered Devices",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(bottom = 8.dp),
      )

      LazyColumn(
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items(discoveredDevices) { device ->
          DiscoveredDeviceItem(
            device = device,
            onConnect = { onConnectDevice(device) },
          )
        }
      }
    } else if (!isScanning && discoveredDevices.isEmpty()) {
      Text(
        text = "Tap 'Scan for Devices' to find nearby Bluetooth sensors.",
        textAlign = TextAlign.Center,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(modifier = Modifier.height(12.dp))
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Card(
          modifier = Modifier.weight(1f),
          colors =
            CardDefaults.cardColors(
              containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
        ) {
          Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
          ) {
            Icon(
              imageVector = Icons.Default.Favorite,
              contentDescription = null,
              tint = MaterialTheme.colorScheme.error,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
              text = "Heart Rate Monitor",
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
              textAlign = TextAlign.Center,
            )
            Text(
              text = "Tracks heart rate and HRV in real time",
              style = MaterialTheme.typography.bodySmall,
              textAlign = TextAlign.Center,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        Card(
          modifier = Modifier.weight(1f),
          colors =
            CardDefaults.cardColors(
              containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
        ) {
          Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
          ) {
            Icon(
              imageVector = Icons.Default.PlayArrow,
              contentDescription = null,
              tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
              text = "Step Sensor",
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
              textAlign = TextAlign.Center,
            )
            Text(
              text = "Tracks cadence and steps from a footpod",
              style = MaterialTheme.typography.bodySmall,
              textAlign = TextAlign.Center,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun DiscoveredDeviceItem(
  device: DiscoveredDevice,
  onConnect: () -> Unit,
) {
  Card(
    modifier = Modifier.fillMaxWidth(),
  ) {
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .padding(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(
        imageVector =
          when (device.sensorType) {
            SensorType.HEART_RATE -> Icons.Default.Favorite
            SensorType.RUNNING_SPEED_CADENCE -> Icons.Default.PlayArrow
          },
        contentDescription = null,
        tint =
          when (device.sensorType) {
            SensorType.HEART_RATE -> MaterialTheme.colorScheme.error
            SensorType.RUNNING_SPEED_CADENCE -> MaterialTheme.colorScheme.primary
          },
      )

      Spacer(modifier = Modifier.width(12.dp))

      Column(modifier = Modifier.weight(1f)) {
        Text(
          text = device.name ?: "Unknown Device",
          style = MaterialTheme.typography.bodyLarge,
          fontWeight = FontWeight.Medium,
        )
        Text(
          text =
            when (device.sensorType) {
              SensorType.HEART_RATE -> "Heart Rate Monitor"
              SensorType.RUNNING_SPEED_CADENCE -> "Step Sensor"
            },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
          text = "Signal: ${device.rssi} dBm",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }

      Button(onClick = onConnect) {
        Text("Connect")
      }
    }
  }
}

private const val CHART_DURATION_MS = 5 * 60 * 1000L // 5 minutes

/**
 * Draws a line chart with HR (red) and HRV (green) data as a background.
 * The chart auto-scales vertically to fit the data with some padding.
 */
@Composable
private fun LiveDataChart(
  hrData: List<ChartDataPoint>,
  hrvData: List<ChartDataPoint>,
  modifier: Modifier = Modifier,
) {
  val hrColor = Color(0xFFE57373) // Light red
  val hrvColor = Color(0xFF81C784) // Light green

  Canvas(modifier = modifier) {
    val width = size.width
    val height = size.height
    val now = System.currentTimeMillis()
    val startTime = now - CHART_DURATION_MS

    // Helper function to draw a line for a dataset
    fun drawDataLine(
      data: List<ChartDataPoint>,
      color: Color,
      minValue: Float,
      maxValue: Float,
    ) {
      if (data.size < 2) return

      val valueRange = maxValue - minValue
      if (valueRange <= 0) return

      val path = Path()
      var started = false

      data.forEachIndexed { index, point ->
        val x = ((point.timestamp - startTime).toFloat() / CHART_DURATION_MS) * width
        val normalizedY = (point.value - minValue) / valueRange
        val y = height - (normalizedY * height) // Use full height, scale to exact min/max

        if (!started) {
          path.moveTo(x, y)
          started = true
        } else {
          path.lineTo(x, y)
        }
      }

      drawPath(
        path = path,
        color = color,
        style = Stroke(width = 2f),
      )
    }

    // Calculate ranges for HR data - use exact min/max from data
    if (hrData.isNotEmpty()) {
      val hrValues = hrData.map { it.value }
      val hrMin = hrValues.minOrNull() ?: 60f
      val hrMax = hrValues.maxOrNull() ?: 100f
      drawDataLine(hrData, hrColor, hrMin, hrMax)
    }

    // Calculate ranges for HRV data - use exact min/max from data
    if (hrvData.isNotEmpty()) {
      val hrvValues = hrvData.map { it.value }
      val hrvMin = hrvValues.minOrNull() ?: 20f
      val hrvMax = hrvValues.maxOrNull() ?: 80f
      drawDataLine(hrvData, hrvColor, hrvMin, hrvMax)
    }
  }
}

@Composable
private fun BatteryIndicator(level: Int) {
  val color =
    when {
      level <= 20 -> MaterialTheme.colorScheme.error
      level <= 50 -> MaterialTheme.colorScheme.tertiary
      else -> MaterialTheme.colorScheme.primary
    }

  Row(
    verticalAlignment = Alignment.CenterVertically,
    modifier = Modifier.padding(horizontal = 4.dp),
  ) {
    // Battery body
    Box(
      modifier =
        Modifier
          .size(width = 20.dp, height = 10.dp)
          .border(1.dp, color, shape = MaterialTheme.shapes.extraSmall)
          .padding(1.dp),
    ) {
      // Battery fill level
      Box(
        modifier =
          Modifier
            .fillMaxHeight()
            .fillMaxWidth(level / 100f)
            .background(color, shape = MaterialTheme.shapes.extraSmall),
      )
    }
    // Battery tip
    Box(
      modifier =
        Modifier
          .size(width = 2.dp, height = 5.dp)
          .background(color, shape = MaterialTheme.shapes.extraSmall),
    )
    Spacer(modifier = Modifier.width(4.dp))
    Text(
      text = "$level%",
      style = MaterialTheme.typography.bodySmall,
      color = color,
    )
  }
}

@Composable
private fun ConnectionHealthIndicator(
  rssi: Int?,
  lastDataReceivedTime: Instant?,
) {
  val now = remember { mutableStateOf(Instant.now()) }

  // Update "now" every second to keep staleness indicator current
  LaunchedEffect(Unit) {
    while (true) {
      now.value = Instant.now()
      kotlinx.coroutines.delay(1000)
    }
  }

  val staleness =
    lastDataReceivedTime?.let {
      Duration.between(it, now.value).toMillis() / 1000.0
    }

  // RSSI signal strength interpretation:
  // > -50 dBm: Excellent
  // -50 to -70 dBm: Good
  // -70 to -80 dBm: Fair
  // < -80 dBm: Weak
  val signalStrength =
    rssi?.let {
      when {
        it > -50 -> "excellent"
        it > -70 -> "good"
        it > -80 -> "fair"
        else -> "weak"
      }
    }

  val signalColor =
    when (signalStrength) {
      "excellent" -> Color(0xFF4CAF50) // Green
      "good" -> Color(0xFF8BC34A) // Light green
      "fair" -> Color(0xFFFF9800) // Orange
      "weak" -> Color(0xFFF44336) // Red
      else -> Color.Gray
    }

  // Staleness color: green if fresh, yellow if getting stale, red if very stale
  val stalenessColor =
    staleness?.let {
      when {
        it < 3 -> Color(0xFF4CAF50) // Green - fresh
        it < 10 -> Color(0xFFFF9800) // Orange - getting stale
        else -> Color(0xFFF44336) // Red - stale
      }
    } ?: Color.Gray

  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.Center,
    modifier = Modifier.padding(vertical = 4.dp),
  ) {
    // Signal strength indicator (4 bars)
    Row(
      horizontalArrangement = Arrangement.spacedBy(1.dp),
      verticalAlignment = Alignment.Bottom,
      modifier = Modifier.height(14.dp),
    ) {
      val bars =
        when (signalStrength) {
          "excellent" -> 4
          "good" -> 3
          "fair" -> 2
          "weak" -> 1
          else -> 0
        }
      for (i in 1..4) {
        Box(
          modifier =
            Modifier
              .width(3.dp)
              .height((4 + i * 2).dp)
              .background(
                if (i <= bars) signalColor else signalColor.copy(alpha = 0.3f),
                shape = MaterialTheme.shapes.extraSmall,
              ),
        )
      }
    }

    Spacer(modifier = Modifier.width(4.dp))

    // RSSI value
    Text(
      text = rssi?.let { "${it}dBm" } ?: "--",
      style = MaterialTheme.typography.labelSmall,
      color = signalColor,
    )

    Spacer(modifier = Modifier.width(8.dp))

    // Data freshness indicator
    val stalenessText =
      staleness?.let {
        when {
          it < 1 -> "now"
          it < 60 -> "${it.toInt()}s ago"
          else -> "${(it / 60).toInt()}m ago"
        }
      } ?: "no data"

    Text(
      text = stalenessText,
      style = MaterialTheme.typography.labelSmall,
      color = stalenessColor,
    )
  }
}
