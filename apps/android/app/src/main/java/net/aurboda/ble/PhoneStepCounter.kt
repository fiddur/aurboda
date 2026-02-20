package net.aurboda.ble

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant

private const val TAG = "PhoneStepCounter"

/**
 * Uses the phone's built-in step counter sensor to track steps.
 *
 * Android provides TYPE_STEP_COUNTER which gives cumulative steps since last reboot.
 * We track the starting value when monitoring begins to calculate steps during the session.
 */
class PhoneStepCounter(context: Context) : SensorEventListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val stepCounterSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)

    private var isMonitoring = false
    private var initialStepCount: Float? = null

    private val _stepsSinceStart = MutableStateFlow(0)
    val stepsSinceStart: StateFlow<Int> = _stepsSinceStart.asStateFlow()

    private val _isAvailable = MutableStateFlow(stepCounterSensor != null)
    val isAvailable: StateFlow<Boolean> = _isAvailable.asStateFlow()

    private val _lastUpdateTime = MutableStateFlow<Instant?>(null)
    val lastUpdateTime: StateFlow<Instant?> = _lastUpdateTime.asStateFlow()

    /**
     * Start monitoring steps from the phone sensor.
     * Returns true if monitoring started successfully, false if sensor not available.
     */
    fun startMonitoring(): Boolean {
        if (stepCounterSensor == null) {
            Log.w(TAG, "Step counter sensor not available on this device")
            return false
        }

        if (isMonitoring) {
            Log.d(TAG, "Already monitoring")
            return true
        }

        // Reset state
        initialStepCount = null
        _stepsSinceStart.value = 0
        _lastUpdateTime.value = null

        val registered = sensorManager.registerListener(
            this,
            stepCounterSensor,
            SensorManager.SENSOR_DELAY_NORMAL
        )

        if (registered) {
            isMonitoring = true
            Log.d(TAG, "Started monitoring phone step counter")
        } else {
            Log.e(TAG, "Failed to register step counter listener")
        }

        return registered
    }

    /**
     * Stop monitoring steps.
     */
    fun stopMonitoring() {
        if (!isMonitoring) return

        sensorManager.unregisterListener(this)
        isMonitoring = false
        Log.d(TAG, "Stopped monitoring phone step counter, total steps: ${_stepsSinceStart.value}")
    }

    /**
     * Reset the step counter to zero (for starting a new session).
     */
    fun resetSteps() {
        initialStepCount = null
        _stepsSinceStart.value = 0
        _lastUpdateTime.value = null
        Log.d(TAG, "Reset step counter")
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_STEP_COUNTER) return

        val totalSteps = event.values[0]

        if (initialStepCount == null) {
            // First reading - store as baseline
            initialStepCount = totalSteps
            Log.d(TAG, "Initial step count baseline: $totalSteps")
        }

        val stepsSinceStart = (totalSteps - (initialStepCount ?: totalSteps)).toInt()
        _stepsSinceStart.value = stepsSinceStart
        _lastUpdateTime.value = Instant.now()

        Log.d(TAG, "Phone steps: $stepsSinceStart (total: $totalSteps, baseline: $initialStepCount)")
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        Log.d(TAG, "Step counter accuracy changed: $accuracy")
    }

    fun isMonitoring(): Boolean = isMonitoring
}
