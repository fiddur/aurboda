package net.aurboda.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import net.aurboda.DataResult
import net.aurboda.HrZoneThresholds
import net.aurboda.PeriodSummaryResponse
import net.aurboda.appJson
import net.aurboda.defaultHrZoneThresholds
import net.aurboda.fetchPeriodSummary
import net.aurboda.fetchUserSettings
import net.aurboda.findMetricTimeSeconds
import net.aurboda.formatBpmRange
import net.aurboda.hrZoneWeeklyTargetMinutes
import net.aurboda.ui.components.HrZoneBar
import net.aurboda.ui.theme.HrZoneColors
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private sealed class DataScreenState {
    data object Loading : DataScreenState()
    data class Loaded(
        val periodSummary: PeriodSummaryResponse,
        val hrZoneThresholds: HrZoneThresholds
    ) : DataScreenState()
    data class Error(val message: String) : DataScreenState()
}

@Composable
fun DataScreen(
    apiUrl: String,
    authToken: String,
    modifier: Modifier = Modifier
) {
    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) {
                json(appJson)
            }
        }
    }

    var state by remember { mutableStateOf<DataScreenState>(DataScreenState.Loading) }

    LaunchedEffect(Unit) {
        val today = LocalDate.now()
        val weekAgo = today.minusDays(6)
        val formatter = DateTimeFormatter.ISO_LOCAL_DATE
        val start = "${weekAgo.format(formatter)}T00:00:00Z"
        val end = "${today.format(formatter)}T23:59:59Z"

        val metrics = listOf(
            "hr_zone_0_sec",
            "hr_zone_1_sec",
            "hr_zone_2_sec",
            "hr_zone_3_sec",
            "hr_zone_4_sec",
            "hr_zone_5_sec"
        )

        // Fetch user settings for HR zone thresholds
        val thresholds = when (val settingsResult = fetchUserSettings(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> settingsResult.data.hrZoneStart ?: defaultHrZoneThresholds
            is DataResult.Error -> defaultHrZoneThresholds
        }

        // Fetch period summary
        when (val result = fetchPeriodSummary(httpClient, apiUrl, authToken, start, end, metrics)) {
            is DataResult.Success -> {
                state = DataScreenState.Loaded(result.data, thresholds)
            }
            is DataResult.Error -> {
                state = DataScreenState.Error(result.message)
            }
        }
    }

    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        when (val currentState = state) {
            is DataScreenState.Loading -> {
                CircularProgressIndicator()
            }
            is DataScreenState.Error -> {
                Text(
                    text = "Error: ${currentState.message}",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp)
                )
            }
            is DataScreenState.Loaded -> {
                DataContent(
                    periodSummary = currentState.periodSummary,
                    hrZoneThresholds = currentState.hrZoneThresholds,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}

@Composable
private fun DataContent(
    periodSummary: PeriodSummaryResponse,
    hrZoneThresholds: HrZoneThresholds,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "HR Zone Minutes (Last 7 Days)",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 8.dp)
        )

        for (zoneIndex in 0..5) {
            val metricName = "hr_zone_${zoneIndex}_sec"
            val timeSeconds = findMetricTimeSeconds(periodSummary.metrics, metricName)

            HrZoneBar(
                zoneIndex = zoneIndex,
                bpmRange = formatBpmRange(zoneIndex, hrZoneThresholds),
                timeSeconds = timeSeconds,
                targetMinutes = hrZoneWeeklyTargetMinutes[zoneIndex],
                color = HrZoneColors[zoneIndex],
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
