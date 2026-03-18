package net.aurboda.ble

import android.app.ForegroundServiceStartNotAllowedException
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

private const val TAG = "BleAutoConnectReceiver"

/**
 * Receives BOOT_COMPLETED and BLUETOOTH_STATE_CHANGED broadcasts to
 * automatically reconnect to saved BLE devices.
 */
class BleAutoConnectReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED -> {
        Log.d(TAG, "Boot completed, checking for saved devices")
        triggerAutoReconnect(context)
      }
      BluetoothAdapter.ACTION_STATE_CHANGED -> {
        val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
        if (state == BluetoothAdapter.STATE_ON) {
          Log.d(TAG, "Bluetooth turned on, checking for saved devices")
          triggerAutoReconnect(context)
        }
      }
    }
  }

  private fun triggerAutoReconnect(context: Context) {
    val savedDevices = AutoReconnectPrefs.getSavedDevices(context)
    if (savedDevices.isNotEmpty()) {
      Log.d(TAG, "Found ${savedDevices.size} saved device(s), starting auto-reconnect")
      try {
        SensorService.autoReconnect(context)
      } catch (e: Exception) {
        // On Android 12+ starting foreground services from background is restricted.
        // BOOT_COMPLETED has a short exemption window, but Bluetooth state changes do not.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && e is ForegroundServiceStartNotAllowedException) {
          Log.w(TAG, "Cannot start foreground service from background (Android 12+ restriction)", e)
        } else {
          Log.e(TAG, "Failed to start auto-reconnect service", e)
        }
      }
    } else {
      Log.d(TAG, "No saved devices, skipping auto-reconnect")
    }
  }
}
