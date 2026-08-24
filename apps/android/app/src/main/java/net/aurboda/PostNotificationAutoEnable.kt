package net.aurboda

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Launch-time reconciliation of the per-account notification bells with the
 * device (#1060): the bells on the Feed page set the server-side
 * `notify_on_post` flags, but they can only ever produce a notification when
 * the app's poller is on AND Android's permission is granted — without this,
 * bells silently lie to the user.
 *
 * If the user has never made an explicit on/off choice and any followed
 * account has its bell on, this enables the poller, requesting
 * `POST_NOTIFICATIONS` when needed. An explicit "off" on the Account screen is
 * never overridden (the recorded choice guards it), and a denied permission
 * request records "off" so the user isn't re-prompted every launch — the
 * Account screen's warning takes over from there.
 */
@Composable
fun AutoEnablePostNotifications() {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // Either way the choice is now recorded; only a grant starts the poller.
        setPostNotificationsEnabled(context, granted)
        if (granted) NotificationWorker.schedule(context)
    }
    LaunchedEffect(Unit) {
        if (isPostNotificationsChoiceMade(context)) return@LaunchedEffect
        val credentials = CredentialsManager.getCredentials(context) ?: return@LaunchedEffect
        val anyBellOn = withContext(Dispatchers.IO) {
            val client = syncHttpClient()
            try {
                fetchFollowingList(client, credentials.apiUrl, credentials.authToken)
                    ?.following?.any { it.notifyOnPost } == true
            } finally {
                client.close()
            }
        }
        if (!anyBellOn) return@LaunchedEffect
        val needsPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        if (needsPermission) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            setPostNotificationsEnabled(context, true)
            NotificationWorker.schedule(context)
        }
    }
}
