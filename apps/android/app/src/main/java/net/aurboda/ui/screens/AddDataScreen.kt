@file:Suppress("ASSIGNED_VALUE_IS_NEVER_READ") // Compose state vars trigger false positives

package net.aurboda.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
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
import net.aurboda.CustomMetricDefinition
import net.aurboda.DataFieldDefinition
import net.aurboda.DataResult
import net.aurboda.PendingActivityPayload
import net.aurboda.PendingEntry
import net.aurboda.PendingMetricPayload
import net.aurboda.PendingPayload
import net.aurboda.addPendingEntry
import net.aurboda.api.models.AddMetricBody
import net.aurboda.appJson
import net.aurboda.cacheActivityTypes
import net.aurboda.cacheCustomMetrics
import net.aurboda.fetchActivityTypes
import net.aurboda.fetchCustomMetrics
import net.aurboda.getCachedActivityTypes
import net.aurboda.getCachedCustomMetrics
import net.aurboda.pendingEntryCount
import net.aurboda.postActivity
import net.aurboda.postMetric
import net.aurboda.removePendingEntry
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Built-in metrics matching web's builtinDashboardMetrics
private val builtinMetrics = listOf(
    "weight" to "Weight",
    "body_fat" to "Body Fat",
    "steps" to "Steps",
    "heart_rate" to "Heart Rate",
    "resting_heart_rate" to "Resting HR",
    "hrv_rmssd" to "HRV (RMSSD)",
    "hrv_7day" to "HRV (7-day)",
    "hrv_30day" to "HRV (30-day)",
    "sleep_score" to "Sleep Score",
    "readiness_score" to "Readiness Score",
    "resilience_score" to "Resilience Score",
    "spo2" to "SpO2",
    "vo2_max" to "VO2 Max",
    "calories_active" to "Active Calories",
    "calories_total" to "Total Calories",
    "distance" to "Distance",
    "floors_climbed" to "Floors Climbed",
    "cardiovascular_age" to "Cardiovascular Age",
    "stress_level" to "Stress Level",
    "body_battery" to "Body Battery",
    "training_readiness" to "Training Readiness",
    "intensity_minutes" to "Intensity Minutes",
    "respiratory_rate" to "Respiratory Rate",
)

private fun toSnakeCase(s: String): String =
    s.trim().lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')

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

// --- Autocomplete picker for activity types ---

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActivityTypePicker(
    activityTypes: List<ActivityTypeDefinition>,
    selectedType: String,
    onTypeSelected: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var isEditing by remember { mutableStateOf(false) }

    val displayValue = if (isEditing) {
        query
    } else {
        activityTypes.find { it.name == selectedType }?.displayName ?: selectedType
    }

    val filtered = if (query.isBlank()) {
        activityTypes
    } else {
        val q = query.lowercase()
        activityTypes.filter { it.displayName.lowercase().contains(q) || it.name.contains(q) }
    }

    val snakeInput = toSnakeCase(query)
    val isNewType = query.isNotBlank()
            && snakeInput.isNotEmpty()
            && activityTypes.none { it.name == snakeInput }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = displayValue,
            onValueChange = { newValue ->
                query = newValue
                isEditing = true
                expanded = true
            },
            label = { Text("Activity Type") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryEditable)
                .fillMaxWidth(),
            singleLine = true,
        )
        ExposedDropdownMenu(
            expanded = expanded && (filtered.isNotEmpty() || isNewType),
            onDismissRequest = {
                expanded = false
                isEditing = false
            },
        ) {
            filtered.forEach { type ->
                DropdownMenuItem(
                    text = {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                text = "${type.icon ?: ""} ${type.displayName}".trim(),
                            )
                            val cat = type.displayCategory
                            if (cat != null && cat != "other") {
                                Text(
                                    text = cat,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline,
                                )
                            }
                        }
                    },
                    onClick = {
                        onTypeSelected(type.name)
                        query = ""
                        isEditing = false
                        expanded = false
                    },
                )
            }
            if (isNewType) {
                if (filtered.isNotEmpty()) {
                    HorizontalDivider()
                }
                DropdownMenuItem(
                    text = {
                        Column {
                            Text("Create '${query.trim()}'")
                            Text(
                                text = snakeInput,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                    },
                    onClick = {
                        onTypeSelected(snakeInput)
                        query = ""
                        isEditing = false
                        expanded = false
                    },
                )
            }
        }
    }
}

// --- Autocomplete picker for metrics ---

private data class MetricEntry(
    val value: String,
    val label: String,
    val group: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MetricPicker(
    customMetrics: List<CustomMetricDefinition>,
    selectedMetric: String,
    onMetricSelected: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var isEditing by remember { mutableStateOf(false) }

    val allEntries = remember(customMetrics) {
        val builtin = builtinMetrics.map { (value, label) ->
            MetricEntry(value, label, "Built-in")
        }
        val custom = customMetrics.map {
            MetricEntry(it.name, it.description ?: it.name, "Custom")
        }
        builtin + custom
    }

    val displayValue = if (isEditing) {
        query
    } else {
        allEntries.find { it.value == selectedMetric }?.label ?: selectedMetric
    }

    val filtered = if (query.isBlank()) {
        allEntries
    } else {
        val q = query.lowercase()
        allEntries.filter { it.label.lowercase().contains(q) || it.value.contains(q) }
    }

    val builtinFiltered = filtered.filter { it.group == "Built-in" }
    val customFiltered = filtered.filter { it.group == "Custom" }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = displayValue,
            onValueChange = { newValue ->
                query = newValue
                isEditing = true
                expanded = true
            },
            label = { Text("Metric") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryEditable)
                .fillMaxWidth(),
            singleLine = true,
        )
        ExposedDropdownMenu(
            expanded = expanded && filtered.isNotEmpty(),
            onDismissRequest = {
                expanded = false
                isEditing = false
            },
        ) {
            if (builtinFiltered.isNotEmpty()) {
                DropdownMenuItem(
                    text = {
                        Text(
                            "Built-in",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
                builtinFiltered.forEach { entry ->
                    DropdownMenuItem(
                        text = { Text(entry.label) },
                        onClick = {
                            onMetricSelected(entry.value)
                            query = ""
                            isEditing = false
                            expanded = false
                        },
                    )
                }
            }
            if (customFiltered.isNotEmpty()) {
                if (builtinFiltered.isNotEmpty()) {
                    HorizontalDivider()
                }
                DropdownMenuItem(
                    text = {
                        Text(
                            "Custom",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
                customFiltered.forEach { entry ->
                    DropdownMenuItem(
                        text = { Text(entry.label) },
                        onClick = {
                            onMetricSelected(entry.value)
                            query = ""
                            isEditing = false
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

// --- Structured data fields for activity types ---

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SchemaDataFields(
    fields: List<DataFieldDefinition>,
    data: Map<String, String>,
    onDataChange: (Map<String, String>) -> Unit,
) {
    fields.forEach { field ->
        val fieldLabel = field.label ?: field.name.replaceFirstChar { it.uppercase() }
        val unitSuffix = if (field.unit != null) " (${field.unit})" else ""

        when {
            field.type == "boolean" -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = data[field.name] == "true",
                        onCheckedChange = { checked ->
                            onDataChange(data + (field.name to checked.toString()))
                        },
                    )
                    Text(
                        fieldLabel,
                        modifier = Modifier.clickable {
                            val current = data[field.name] == "true"
                            onDataChange(data + (field.name to (!current).toString()))
                        },
                    )
                }
            }

            field.type == "string" && !field.enumValues.isNullOrEmpty() -> {
                // Dropdown for enum values
                var enumExpanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = enumExpanded,
                    onExpandedChange = { enumExpanded = it },
                ) {
                    OutlinedTextField(
                        value = data[field.name] ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(fieldLabel) },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = enumExpanded) },
                        modifier = Modifier
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                            .fillMaxWidth(),
                    )
                    ExposedDropdownMenu(
                        expanded = enumExpanded,
                        onDismissRequest = { enumExpanded = false },
                    ) {
                        field.enumValues.forEach { value ->
                            DropdownMenuItem(
                                text = { Text(value) },
                                onClick = {
                                    onDataChange(data + (field.name to value))
                                    enumExpanded = false
                                },
                            )
                        }
                    }
                }
            }

            field.type == "number" -> {
                OutlinedTextField(
                    value = data[field.name] ?: "",
                    onValueChange = { onDataChange(data + (field.name to it)) },
                    label = { Text("$fieldLabel$unitSuffix") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }

            else -> {
                // Default: string text input
                OutlinedTextField(
                    value = data[field.name] ?: "",
                    onValueChange = { onDataChange(data + (field.name to it)) },
                    label = { Text("$fieldLabel$unitSuffix") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }
        }
    }
}

// --- Activity tab ---

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
    var structuredData by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }

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

    // Get data schema for selected type
    val selectedTypeDef = activityTypes.find { it.name == selectedType }
    val dataFields = selectedTypeDef?.dataSchema?.fields ?: emptyList()

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

        // Activity type autocomplete picker
        ActivityTypePicker(
            activityTypes = activityTypes,
            selectedType = selectedType,
            onTypeSelected = { newType ->
                selectedType = newType
                structuredData = emptyMap()
            },
        )

        // Structured data fields (e.g. Partner for sex)
        if (dataFields.isNotEmpty()) {
            SchemaDataFields(
                fields = dataFields,
                data = structuredData,
                onDataChange = { structuredData = it },
            )
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
                val dataMap = structuredData.filterValues { it.isNotBlank() }.ifEmpty { null }

                val body = AddActivityBody(
                    activityType = selectedType,
                    startTime = startIso,
                    endTime = endIso,
                    title = title.ifBlank { null },
                    notes = notes.ifBlank { null },
                    data = dataMap,
                )

                val pendingEntry = PendingEntry(
                    data = PendingPayload.Activity(
                        PendingActivityPayload(
                            activity_type = body.activityType,
                            start_time = body.startTime,
                            end_time = body.endTime,
                            title = body.title,
                            notes = body.notes,
                            data = body.data,
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
                            selectedType = ""
                            title = ""
                            startTime = nowLocalString()
                            endTime = nowLocalString()
                            hasEndTime = true
                            notes = ""
                            structuredData = emptyMap()
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

// --- Metric tab ---

@Composable
private fun AddMetricTab(
    apiUrl: String,
    authToken: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var customMetrics by remember { mutableStateOf(getCachedCustomMetrics(context)) }
    var selectedMetric by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var time by remember { mutableStateOf(nowLocalString()) }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    // Fetch custom metrics from API and cache
    LaunchedEffect(Unit) {
        when (val result = fetchCustomMetrics(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                customMetrics = result.data
                cacheCustomMetrics(context, result.data)
            }
            is DataResult.Error -> { /* use cached */ }
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

        // Metric autocomplete picker
        MetricPicker(
            customMetrics = customMetrics,
            selectedMetric = selectedMetric,
            onMetricSelected = { selectedMetric = it },
        )

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

// --- Utility functions ---

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
