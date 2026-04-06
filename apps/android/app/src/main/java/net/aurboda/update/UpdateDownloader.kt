package net.aurboda.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

private const val TAG = "UpdateDownloader"
private const val UPDATE_PREFS = "AurbodaUpdatePrefs"
private const val KEY_DOWNLOAD_ID = "pendingDownloadId"
private const val KEY_DOWNLOAD_VERSION = "pendingDownloadVersion"

sealed class DownloadState {
    data class Downloaded(val apkFile: File) : DownloadState()
    data object InProgress : DownloadState()
    data object None : DownloadState()
}

fun getExistingDownloadState(context: Context, versionName: String): DownloadState {
    val prefs = context.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
    val savedVersion = prefs.getString(KEY_DOWNLOAD_VERSION, null)
    val savedDownloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1)

    // Check if we have a saved download for this version
    if (savedVersion == versionName && savedDownloadId != -1L) {
        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val query = DownloadManager.Query().setFilterById(savedDownloadId)
        val cursor = downloadManager.query(query)
        if (cursor.moveToFirst()) {
            val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val status = cursor.getInt(statusIndex)
            cursor.close()
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    val apkFile = findDownloadedApk(context, versionName)
                    if (apkFile != null) DownloadState.Downloaded(apkFile)
                    else {
                        clearSavedDownload(context)
                        DownloadState.None
                    }
                }
                DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PENDING -> {
                    DownloadState.InProgress
                }
                else -> {
                    // Failed or paused — clear and let user retry
                    clearSavedDownload(context)
                    DownloadState.None
                }
            }
        }
        cursor.close()
        // Download ID not found in DownloadManager (e.g., cleared by system)
        clearSavedDownload(context)
    } else if (savedVersion != versionName) {
        // Different version — clear stale download state
        clearSavedDownload(context)
    }

    // No saved download — check if APK file happens to exist
    val apkFile = findDownloadedApk(context, versionName)
    if (apkFile != null) return DownloadState.Downloaded(apkFile)

    return DownloadState.None
}

private fun findDownloadedApk(context: Context, versionName: String): File? {
    val downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
    val apkFile = File(downloadDir, "aurboda-$versionName.apk")
    return if (apkFile.exists() && apkFile.length() > 0) apkFile else null
}

private fun saveDownload(context: Context, downloadId: Long, versionName: String) {
    context.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE).edit()
        .putLong(KEY_DOWNLOAD_ID, downloadId)
        .putString(KEY_DOWNLOAD_VERSION, versionName)
        .apply()
}

private fun clearSavedDownload(context: Context) {
    context.getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE).edit()
        .remove(KEY_DOWNLOAD_ID)
        .remove(KEY_DOWNLOAD_VERSION)
        .apply()
}

fun downloadUpdate(
    context: Context,
    downloadUrl: String,
    versionName: String,
    onDownloadComplete: (File) -> Unit,
    onDownloadFailed: (String) -> Unit
): Long {
    val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val fileName = "aurboda-$versionName.apk"

    // Clean up old APK files before downloading new one
    val downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
    downloadDir?.listFiles()?.filter { it.name.endsWith(".apk") }?.forEach { file ->
        Log.d(TAG, "Deleting old APK: ${file.name}")
        file.delete()
    }

    val request = DownloadManager.Request(Uri.parse(downloadUrl))
        .setTitle("Aurboda Update")
        .setDescription("Downloading version $versionName")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)

    val downloadId = downloadManager.enqueue(request)
    Log.d(TAG, "Started download with ID: $downloadId")
    saveDownload(context, downloadId, versionName)

    val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            if (id == downloadId) {
                context.unregisterReceiver(this)
                val query = DownloadManager.Query().setFilterById(downloadId)
                val cursor = downloadManager.query(query)
                if (cursor.moveToFirst()) {
                    val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                    val status = cursor.getInt(statusIndex)
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        val file = File(downloadDir, fileName)
                        Log.d(TAG, "Download successful: ${file.absolutePath}")
                        onDownloadComplete(file)
                    } else {
                        val reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                        val reason = cursor.getInt(reasonIndex)
                        Log.e(TAG, "Download failed with status $status, reason $reason")
                        clearSavedDownload(context)
                        onDownloadFailed("Download failed (reason: $reason)")
                    }
                }
                cursor.close()
            }
        }
    }

    val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(receiver, filter)
    }

    return downloadId
}

fun installApk(context: Context, apkFile: File) {
    val uri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        apkFile
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    Log.d(TAG, "Starting APK install for: ${apkFile.absolutePath}")
    context.startActivity(intent)
}
