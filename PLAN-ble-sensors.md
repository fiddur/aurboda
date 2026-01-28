# Plan: BLE Heart Rate & Step Sensor Support

## Overview

Add support for standard Bluetooth Low Energy (BLE) health sensors to the Aurboda Android app:
- **Heart Rate Monitors** (e.g., Polar H10) using the standard Heart Rate Profile (HRP)
- **Step/Cadence Sensors** (e.g., Zwift Runpod) using the Running Speed and Cadence (RSC) profile

Data will flow both to Health Connect (for ecosystem compatibility) and directly to the Aurboda backend (for real-time updates).

## BLE Protocol Details

### Heart Rate Profile (HRP)
- **Service UUID:** `0x180D` (Heart Rate)
- **Characteristic UUID:** `0x2A37` (Heart Rate Measurement)
- Notifications provide HR in BPM, plus optional RR-intervals
- Sample rate: typically 1Hz from sensor, we'll send every 5 seconds

### Running Speed and Cadence (RSC)
- **Service UUID:** `0x1814` (Running Speed and Cadence)
- **Characteristic UUID:** `0x2A53` (RSC Measurement)
- Provides: instantaneous speed, instantaneous cadence, stride length, total distance
- We'll accumulate steps from cadence and send every 30 seconds

---

## Implementation Tasks

### Phase 1: Core BLE Infrastructure

#### 1.1 Add BLE Permissions to Manifest
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
```

#### 1.2 Create BLE Scanner Module
**File:** `BleScanner.kt`
- Scan for devices advertising HRP (0x180D) or RSC (0x1814) services
- Return discovered devices with name, address, signal strength, and service type
- Handle scan timeout and permissions

#### 1.3 Create BLE Connection Manager
**File:** `BleConnectionManager.kt`
- Connect to a device by address
- Discover services and characteristics
- Subscribe to notifications (HR measurement, RSC measurement)
- Handle disconnection and reconnection
- Parse characteristic data into domain objects

#### 1.4 Create Data Models
**File:** `BleSensorData.kt`
```kotlin
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

data class ConnectedDevice(
    val address: String,
    val name: String,
    val type: SensorType  // HR or RSC
)
```

---

### Phase 2: Foreground Service

#### 2.1 Create Sensor Foreground Service
**File:** `SensorService.kt`
- Foreground service with persistent notification
- Manages BLE connections to HR and/or RSC devices
- Buffers incoming data
- Periodically sends data to backend (HR: 5s, Steps: 30s)
- Writes data to Health Connect
- Exposes state via StateFlow for UI observation

#### 2.2 Service Notification
- Show "Aurboda - Sensors Active" notification
- Display current HR if connected
- Action buttons: Stop, Open App

#### 2.3 Service Lifecycle
- Start when user connects to first device from Live screen
- Stop when user explicitly stops or disconnects all devices
- Survive app backgrounding
- Auto-reconnect on connection loss

---

### Phase 3: Backend Integration

#### 3.1 Extend Sync API
**File:** `SyncApi.kt` (new or extend existing)
- `POST /sync/heart-rate` - batch of HR samples
- `POST /sync/steps` - step count update with timestamp range

#### 3.2 Data Batching Logic
- HR: Collect samples, send batch every 5 seconds
- Steps: Accumulate from cadence, send delta every 30 seconds
- Handle offline: queue and retry when connectivity returns

---

### Phase 4: Health Connect Integration

#### 4.1 Add Health Connect Write Permissions
Update manifest and permission requests:
- `WRITE_HEART_RATE`
- `WRITE_STEPS`

#### 4.2 Health Connect Writer
**File:** `HealthConnectWriter.kt`
- Write HeartRateRecord with time series samples
- Write StepsRecord with accumulated counts
- Batch writes to avoid excessive API calls

---

### Phase 5: UI - Live Screen

#### 5.1 Create Live Screen
**File:** `LiveScreen.kt`
- New tab in bottom navigation (4th tab: "Live")
- Shows BLE scan results when no devices connected
- Shows connected device status and live readings

#### 5.2 UI Components

**Device Scanner Section:**
- "Scan for Devices" button
- List of discovered devices with:
  - Device name (or "Unknown Device")
  - Signal strength indicator
  - Device type icon (heart for HR, shoe for RSC)
  - "Connect" button

**Connected Devices Section:**
- Heart Rate Card:
  - Device name
  - Current BPM (large font)
  - Connection status indicator
  - Disconnect button

- Step Sensor Card:
  - Device name
  - Current cadence (steps/min)
  - Session step count
  - Connection status indicator
  - Disconnect button

**Service Controls:**
- Start/Stop service toggle
- Service status indicator

#### 5.3 State Management
**File:** `LiveScreenState.kt`
- Scanning state (idle, scanning, error)
- Discovered devices list
- Connected devices with live readings
- Service running state

---

### Phase 6: Navigation & Integration

#### 6.1 Update Bottom Navigation
- Add 4th tab: "Live" with appropriate icon (e.g., radio/bluetooth icon)
- Update `MainScreen.kt` navigation

#### 6.2 Update AppState
- Add Live screen to navigation enum
- Handle service state observation

---

## File Structure

```
app/src/main/java/net/aurboda/
├── ble/
│   ├── BleScanner.kt
│   ├── BleConnectionManager.kt
│   ├── BleSensorData.kt
│   ├── HeartRateParser.kt
│   ├── RscParser.kt
│   └── SensorService.kt
├── api/
│   ├── AuthApi.kt (existing)
│   ├── DataApi.kt (existing)
│   └── SyncApi.kt (new)
├── health/
│   └── HealthConnectWriter.kt
├── ui/
│   ├── LiveScreen.kt
│   └── LiveScreenState.kt
└── ... (existing files)
```

---

## Dependencies to Add

```kotlin
// No additional dependencies needed - Android BLE APIs are built-in
// Health Connect client already included
```

---

## Testing Strategy

### Unit Tests
- `HeartRateParser` - parse HR characteristic bytes
- `RscParser` - parse RSC characteristic bytes
- Data batching logic
- Step accumulation from cadence

### Integration Tests
- Mock BLE GATT for connection flow
- Health Connect write operations

### Manual Testing
- Real device testing with Polar H10 and Zwift Runpod
- Background service persistence
- Reconnection behavior

---

## Implementation Order

1. **BLE permissions and scanner** - get device discovery working
2. **Connection manager** - connect and read HR data
3. **Live screen UI** - display discovered devices and connect
4. **Foreground service** - keep connections alive in background
5. **Backend sync** - send HR data to server
6. **Health Connect writes** - persist to Health Connect
7. **RSC support** - add step/cadence sensor support
8. **Polish** - reconnection, error handling, UI refinements

---

## Open Questions / Future Enhancements

- **Device persistence:** Remember paired devices and auto-connect on service start?
- **Multiple HR monitors:** Support connecting multiple HR devices simultaneously?
- **Workout sessions:** Create exercise sessions in Health Connect with sensor data?
- **Battery optimization:** Request exemption for sensor service?

---

## Estimated Scope

This is a significant feature addition involving:
- New BLE infrastructure (scanner, connection manager, parsers)
- Foreground service with notification
- New API endpoints and sync logic
- Health Connect write integration
- New UI screen with device discovery

The implementation can be done incrementally, with HR monitor support as the first milestone, followed by step sensor support.
