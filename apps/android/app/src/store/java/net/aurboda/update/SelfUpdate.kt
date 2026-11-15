package net.aurboda.update

import androidx.compose.runtime.Composable
import io.ktor.client.HttpClient

/** Store builds (Google Play, F-Droid) are updated by their store, so they never update themselves. */
@Suppress("UNUSED_PARAMETER")
@Composable
fun SelfUpdate(httpClient: HttpClient) {
}
