package net.aurboda.ui.screens

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.launch
import net.aurboda.ActivityTypeDefinition
import net.aurboda.AddActivityBody
import net.aurboda.DataResult
import net.aurboda.PendingActivityPayload
import net.aurboda.PendingEntry
import net.aurboda.PendingMetricPayload
import net.aurboda.PendingPayload
import net.aurboda.addPendingEntry
import net.aurboda.api.models.AddMetricBody
import net.aurboda.appJson
import net.aurboda.cacheActivityTypes
import net.aurboda.fetchActivityTypes
import net.aurboda.getCachedActivityTypes
import net.aurboda.pendingEntryCount
import net.aurboda.postActivity
import net.aurboda.postMetric
import net.aurboda.removePendingEntry
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val builtinMetrics = listOf(
    "weight" to "Weight",
    "body_fat" to "Body Fat",
    "steps" to "Steps",
    "resting_heart_rate" to "Resting HR",
    "hrv_rmssd" to "HRV (RMSSD)",
    "spo2" to "SpO2",
    "sleep_score" to "Sleep Score",
    "readiness_score" to "Readiness Score",
    "vo2_max" to "VO2 Max",
    "calories_active" to "Active Calories",
    "distance" to "Distance",
    "stress_level" to "Stress Level",
    "body_battery" to "Body Battery",
)

@Composable
fun AddDataScreen(
    apiUrl: String,
    authToken: String,
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Activity", "Metric")

    Column(modifier = modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = selectedTab) {
            tabs.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    text = { Text(title) },
                )
            }
        }

        when (selectedTab) {
            0 -> AddActivityTab(apiUrl = apiUrl, authToken = authToken)
            1 -> AddMetricTab(apiUrl = apiUrl, authToken = authToken)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddActivityTab(
    apiUrl: String,
    authToken: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var activityTypes by remember { mutableStateOf(getCachedActivityTypes(context)) }
    var selectedType by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var startTime by remember { mutableStateOf(nowLocalString()) }
    var endTime by remember { mutableStateOf(nowLocalString()) }
    var hasEndTime by remember { mutableStateOf(true) }
    var notes by remember { mutableStateOf("") }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }
    var typeDropdownExpanded by remember { mutableStateOf(false) }

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    // Fetch activity types from API and cache
    LaunchedEffect(Unit) {
        when (val result = fetchActivityTypes(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                activityTypes = result.data
                cacheActivityTypes(context, result.data)
            }
            is DataResult.Error -> { /* use cached/defaults */ }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add Activity", style = MaterialTheme.typography.titleLarge)

        if (message.isNotEmpty()) {
            Text(
                text = message,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        // Activity Type dropdown
        ExposedDropdownMenuBox(
            expanded = typeDropdownExpanded,
            onExpandedChange = { typeDropdownExpanded = it },
        ) {
            OutlinedTextField(
                value = activityTypes.find { it.name == selectedType }?.displayName ?: selectedType,
                onValueChange = {},
                readOnly = true,
                label = { Text("Activity Type") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = typeDropdownExpanded) },
                modifier = Modifier
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    .fillMaxWidth(),
            )
            ExposedDropdownMenu(
                expanded = typeDropdownExpanded,
                onDismissRequest = { typeDropdownExpanded = false },
            ) {
                activityTypes.forEach { type ->
                    DropdownMenuItem(
                        text = { Text(type.displayName) },
                        onClick = {
                            selectedType = type.name
                            typeDropdownExpanded = false
                        },
                    )
                }
            }
        }

        // Title
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("Title (optional)") },
            placeholder = {
                Text(if (selectedType == "exercise") "e.g. Morning run" else "Optional title")
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        // Start time
        OutlinedTextField(
            value = startTime,
            onValueChange = { startTime = it },
            label = { Text("Start Time") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        // Has end time checkbox
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = hasEndTime, onCheckedChange = { hasEndTime = it })
            Text("Has end time", modifier = Modifier.clickable { hasEndTime = !hasEndTime })
        }

        // End time
        if (hasEndTime) {
            OutlinedTextField(
                value = endTime,
                onValueChange = { endTime = it },
                label = { Text("End Time") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }

        // Notes
        OutlinedTextField(
            value = notes,
            onValueChange = { notes = it },
            label = { Text("Notes (optional)") },
            placeholder = {
                Text(
                    if (selectedType == "exercise") "e.g. Bench press: 10x80, 8x85"
                    else "Optional notes"
                )
            },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
            maxLines = 5,
        )

        // Pending count indicator
        val pendingCount = pendingEntryCount(context)
        if (pendingCount > 0) {
            Text(
                text = "$pendingCount pending entries waiting to sync",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        // Submit button
        Button(
            onClick = {
                if (selectedType.isBlank()) {
                    message = "Please select an activity type"
                    isError = true
                    return@Button
                }
                submitting = true
                message = ""

                val startIso = parseLocalToIso(startTime)
                val endIso = if (hasEndTime) parseLocalToIso(endTime) else null

                val body = AddActivityBody(
                    activityType = selectedType,
                    startTime = startIso,
                    endTime = endIso,
                    title = title.ifBlank { null },
                    notes = notes.ifBlank { null },
                )

                val pendingEntry = PendingEntry(
                    data = PendingPayload.Activity(
                        PendingActivityPayload(
                            activity_type = body.activityType,
                            start_time = body.startTime,
                            end_time = body.endTime,
                            title = body.title,
                            notes = body.notes,
                        )
                    ),
                    created_at = nowIso(),
                )
                addPendingEntry(context, pendingEntry)

                scope.launch {
                    val result = postActivity(httpClient, apiUrl, authToken, body)
                    submitting = false
                    when (result) {
                        is DataResult.Success -> {
                            removePendingEntry(context, pendingEntry.id)
                            message = "Activity added!"
                            isError = false
                            resetActivityForm(
                                onReset = {
                                    selectedType = ""
                                    title = ""
                                    startTime = nowLocalString()
                                    endTime = nowLocalString()
                                    hasEndTime = true
                                    notes = ""
                                }
                            )
                        }
                        is DataResult.Error -> {
                            message = "Saved offline - will sync later"
                            isError = false
                        }
                    }
                }
            },
            enabled = !submitting && selectedType.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (submitting) "Adding..." else "Add Activity")
        }
    }
}

private fun resetActivityForm(onReset: () -> Unit) {
    onReset()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddMetricTab(
    apiUrl: String,
    authToken: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var selectedMetric by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var time by remember { mutableStateOf(nowLocalString()) }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }
    var metricDropdownExpanded by remember { mutableStateOf(false) }

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add Metric", style = MaterialTheme.typography.titleLarge)

        if (message.isNotEmpty()) {
            Text(
                text = message,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        // Metric dropdown
        ExposedDropdownMenuBox(
            expanded = metricDropdownExpanded,
            onExpandedChange = { metricDropdownExpanded = it },
        ) {
            OutlinedTextField(
                value = builtinMetrics.find { it.first == selectedMetric }?.second ?: selectedMetric,
                onValueChange = {},
                readOnly = true,
                label = { Text("Metric") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = metricDropdownExpanded) },
                modifier = Modifier
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    .fillMaxWidth(),
            )
            ExposedDropdownMenu(
                expanded = metricDropdownExpanded,
                onDismissRequest = { metricDropdownExpanded = false },
            ) {
                builtinMetrics.forEach { (metricKey, label) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        onClick = {
                            selectedMetric = metricKey
                            metricDropdownExpanded = false
                        },
                    )
                }
            }
        }

        // Value and Time in a row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                label = { Text("Value") },
                placeholder = { Text("e.g. 72.5") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            OutlinedTextField(
                value = time,
                onValueChange = { time = it },
                label = { Text("Time") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }

        // Pending count indicator
        val pendingCount = pendingEntryCount(context)
        if (pendingCount > 0) {
            Text(
                text = "$pendingCount pending entries waiting to sync",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        // Submit button
        Button(
            onClick = {
                val parsedValue = value.toDoubleOrNull()
                if (selectedMetric.isBlank()) {
                    message = "Please select a metric"
                    isError = true
                    return@Button
                }
                if (parsedValue == null) {
                    message = "Please enter a valid number"
                    isError = true
                    return@Button
                }
                submitting = true
                message = ""

                val timeIso = parseLocalToIso(time)

                val body = AddMetricBody(
                    metric = selectedMetric,
                    value = parsedValue,
                    time = timeIso,
                )

                val pendingEntry = PendingEntry(
                    data = PendingPayload.Metric(
                        PendingMetricPayload(
                            metric = body.metric,
                            value = body.value,
                            time = timeIso,
                        )
                    ),
                    created_at = nowIso(),
                )
                addPendingEntry(context, pendingEntry)

                scope.launch {
                    val result = postMetric(httpClient, apiUrl, authToken, body)
                    submitting = false
                    when (result) {
                        is DataResult.Success -> {
                            removePendingEntry(context, pendingEntry.id)
                            message = "Metric recorded!"
                            isError = false
                            value = ""
                            time = nowLocalString()
                        }
                        is DataResult.Error -> {
                            message = "Saved offline - will sync later"
                            isError = false
                        }
                    }
                }
            },
            enabled = !submitting && selectedMetric.isNotBlank() && value.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (submitting) "Adding..." else "Add Metric")
        }
    }
}

private val localFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

private fun nowLocalString(): String = LocalDateTime.now().format(localFormatter)

private fun nowIso(): String =
    java.time.ZonedDateTime.now(ZoneId.systemDefault())
        .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

private fun parseLocalToIso(localTimeString: String): String {
    return try {
        val ldt = LocalDateTime.parse(localTimeString, localFormatter)
        ldt.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    } catch (_: Exception) {
        localTimeString
    }
}
