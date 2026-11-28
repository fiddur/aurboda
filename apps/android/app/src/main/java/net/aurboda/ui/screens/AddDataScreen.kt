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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
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
import net.aurboda.ActivityDataInput
import net.aurboda.ActivityTypeDefinition
import net.aurboda.ACTIVITY_PEOPLE_MAX
import net.aurboda.CatalogActivityType
import net.aurboda.CatalogMetric
import net.aurboda.CustomMetricDefinition
import net.aurboda.DataFieldDefinition
import net.aurboda.DataResult
import net.aurboda.PendingActivityOutcome
import net.aurboda.PendingActivityPayload
import net.aurboda.PendingEntry
import net.aurboda.PendingMetricPayload
import net.aurboda.PendingPayload
import net.aurboda.PersonOption
import net.aurboda.addPendingEntry
import net.aurboda.api.models.AddMetricBody
import net.aurboda.appJson
import net.aurboda.buildActivityData
import net.aurboda.cacheActivityTypeCatalog
import net.aurboda.cacheActivityTypes
import net.aurboda.cacheCustomMetrics
import net.aurboda.cacheMetricCatalog
import net.aurboda.cachePeople
import net.aurboda.catalogMetricsToOffer
import net.aurboda.catalogTypesToOffer
import net.aurboda.defaultMetricUnit
import net.aurboda.fetchActivityTypeCatalog
import net.aurboda.fetchActivityTypes
import net.aurboda.fetchCustomMetrics
import net.aurboda.fetchMetricCatalog
import net.aurboda.fetchPeople
import net.aurboda.getCachedActivityTypeCatalog
import net.aurboda.getCachedActivityTypes
import net.aurboda.getCachedCustomMetrics
import net.aurboda.getCachedMetricCatalog
import net.aurboda.getCachedPeople
import net.aurboda.getPendingEntries
import net.aurboda.isPermanentRefusal
import net.aurboda.markPendingEntryFailed
import net.aurboda.metricUnitOptions
import net.aurboda.metricUnitToSend
import net.aurboda.pendingEntryCount
import net.aurboda.postActivity
import net.aurboda.postEntityComment
import net.aurboda.postMetric
import net.aurboda.recordCreatedActivity
import net.aurboda.removePendingEntry
import net.aurboda.resolveActivityType
import net.aurboda.sendPendingActivity
import net.aurboda.updatePendingEntry
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
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

@Composable
fun AddDataScreen(
    apiUrl: String,
    authToken: String,
    modifier: Modifier = Modifier,
    onOpenWebPage: (String) -> Unit = {},
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
            0 -> AddActivityTab(apiUrl = apiUrl, authToken = authToken, onOpenWebPage = onOpenWebPage)
            1 -> AddMetricTab(apiUrl = apiUrl, authToken = authToken)
        }
    }
}

private val displayDateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
private val displayTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateTimePickerField(
    label: String,
    epochMillis: Long,
    onChanged: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val zone = ZoneId.systemDefault()
    val zdt = ZonedDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), zone)
    val displayText = "${zdt.format(displayDateFormatter)}  ${zdt.format(displayTimeFormatter)}"

    var showDatePicker by remember { mutableStateOf(false) }
    var showTimePicker by remember { mutableStateOf(false) }

    OutlinedTextField(
        value = displayText,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        modifier = modifier
            .fillMaxWidth()
            .clickable { showDatePicker = true },
        singleLine = true,
        enabled = false, // Prevents keyboard, click handled by modifier
    )

    if (showDatePicker) {
        val dateState = rememberDatePickerState(
            initialSelectedDateMillis = epochMillis,
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    showDatePicker = false
                    val selectedDate = dateState.selectedDateMillis
                    if (selectedDate != null) {
                        val pickedDate = Instant.ofEpochMilli(selectedDate)
                            .atZone(ZoneId.of("UTC"))
                            .toLocalDate()
                        val newZdt = ZonedDateTime.of(pickedDate, zdt.toLocalTime(), zone)
                        onChanged(newZdt.toInstant().toEpochMilli())
                    }
                    showTimePicker = true
                }) { Text("Next") }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text("Cancel") }
            },
        ) {
            DatePicker(state = dateState)
        }
    }

    if (showTimePicker) {
        val timeState = rememberTimePickerState(
            initialHour = zdt.hour,
            initialMinute = zdt.minute,
            is24Hour = true,
        )
        AlertDialog(
            onDismissRequest = { showTimePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    showTimePicker = false
                    // Re-read current epochMillis (may have been updated by date picker)
                    val currentZdt = ZonedDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), zone)
                    val newZdt = currentZdt
                        .withHour(timeState.hour)
                        .withMinute(timeState.minute)
                        .withSecond(0)
                        .withNano(0)
                    onChanged(newZdt.toInstant().toEpochMilli())
                }) { Text("OK") }
            },
            dismissButton = {
                TextButton(onClick = { showTimePicker = false }) { Text("Cancel") }
            },
            title = { Text(label) },
            text = { TimePicker(state = timeState) },
        )
    }
}

private fun epochMillisToIso(epochMillis: Long): String =
    Instant.ofEpochMilli(epochMillis).toString()

private fun nowEpochMillis(): Long = System.currentTimeMillis()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActivityTypePicker(
    activityTypes: List<ActivityTypeDefinition>,
    catalog: List<CatalogActivityType>,
    selectedType: String,
    onTypeSelected: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var isEditing by remember { mutableStateOf(false) }

    val displayValue = if (isEditing) {
        query
    } else {
        activityTypes.find { it.name == selectedType }?.displayName
            ?: catalog.find { it.name == selectedType }?.displayName
            ?: selectedType
    }

    val match = matchActivityTypes(activityTypes, query, { it.name }, { it.displayName })
    val filtered = match.filtered
    val catalogFiltered = matchCatalogTypes(
        catalogTypesToOffer(activityTypes, catalog),
        query,
        { it.name },
        { it.displayName },
        { it.aliases },
    )
    val snakeInput = match.snakeInput
    val isNewType = offersNewType(match, catalog.map { it.name })

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
            expanded = expanded && (filtered.isNotEmpty() || catalogFiltered.isNotEmpty() || isNewType),
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
            if (catalogFiltered.isNotEmpty()) {
                if (filtered.isNotEmpty()) {
                    HorizontalDivider()
                }
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
                catalogFiltered.forEach { entry ->
                    DropdownMenuItem(
                        text = { Text("${entry.icon ?: ""} ${entry.displayName}".trim()) },
                        onClick = {
                            onTypeSelected(entry.name)
                            query = ""
                            isEditing = false
                            expanded = false
                        },
                    )
                }
            }
            if (isNewType) {
                if (filtered.isNotEmpty() || catalogFiltered.isNotEmpty()) {
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

@Composable
private fun WithPickerField(
    people: List<PersonOption>,
    selected: List<String>,
    onSelectedChange: (List<String>) -> Unit,
) {
    if (people.isEmpty()) {
        Text(
            "Add people on the People page",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        return
    }

    var showDialog by remember { mutableStateOf(false) }
    val names = people.filter { it.id in selected }.joinToString(", ") { it.name }

    OutlinedTextField(
        value = names,
        onValueChange = {},
        readOnly = true,
        label = { Text("With") },
        modifier = Modifier
            .fillMaxWidth()
            .clickable { showDialog = true },
        singleLine = true,
        enabled = false, // Prevents keyboard, click handled by modifier
    )

    if (showDialog) {
        AlertDialog(
            onDismissRequest = { showDialog = false },
            confirmButton = {
                TextButton(onClick = { showDialog = false }) { Text("Done") }
            },
            title = { Text("With") },
            text = {
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    people.forEach { person ->
                        val checked = person.id in selected
                        val enabled = checked || selected.size < ACTIVITY_PEOPLE_MAX
                        val toggle = {
                            onSelectedChange(if (checked) selected - person.id else selected + person.id)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = { toggle() },
                                enabled = enabled,
                            )
                            Text(
                                person.relationship?.let { "${person.name} · $it" } ?: person.name,
                                modifier = Modifier.clickable(enabled = enabled) { toggle() },
                            )
                        }
                    }
                }
            },
        )
    }
}

private data class MetricEntry(
    val value: String,
    val label: String,
    val group: String,
    val keywords: List<String> = emptyList(),
)

private const val METRIC_CATALOGUE_GROUP = "More built-in metrics"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MetricPicker(
    customMetrics: List<CustomMetricDefinition>,
    metricCatalog: List<CatalogMetric>,
    selectedMetric: String,
    onMetricSelected: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var isEditing by remember { mutableStateOf(false) }

    val allEntries = remember(customMetrics, metricCatalog) {
        val builtin = builtinMetrics.map { (value, label) ->
            MetricEntry(value, label, "Built-in")
        }
        val custom = customMetrics.map {
            MetricEntry(it.name, it.description ?: it.name, "Custom")
        }
        val catalogue = catalogMetricsToOffer(
            metricCatalog,
            builtinMetrics.map { it.first }.toSet(),
            customMetrics.map { it.name }.toSet(),
        ).map { MetricEntry(it.name, it.displayName, METRIC_CATALOGUE_GROUP, it.aliases) }
        builtin + custom + catalogue
    }

    val displayValue = if (isEditing) {
        query
    } else {
        allEntries.find { it.value == selectedMetric }?.label ?: selectedMetric
    }

    val filtered = if (query.isBlank()) {
        allEntries
    } else {
        val q = query.trim().lowercase()
        allEntries.filter { entry ->
            entry.label.lowercase().contains(q) ||
                entry.value.contains(q) ||
                entry.keywords.any { it.lowercase().contains(q) }
        }
    }

    val builtinFiltered = filtered.filter { it.group == "Built-in" }
    val customFiltered = filtered.filter { it.group == "Custom" }
    val catalogueFiltered = filtered.filter { it.group == METRIC_CATALOGUE_GROUP }

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
            if (catalogueFiltered.isNotEmpty()) {
                if (builtinFiltered.isNotEmpty() || customFiltered.isNotEmpty()) {
                    HorizontalDivider()
                }
                DropdownMenuItem(
                    text = {
                        Text(
                            METRIC_CATALOGUE_GROUP,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
                catalogueFiltered.forEach { entry ->
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MetricUnitField(
    options: List<String>,
    selected: String,
    onSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val choosable = options.size > 1
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = choosable && it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            label = { Text("Unit") },
            trailingIcon = if (choosable) {
                { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) }
            } else {
                null
            },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth(),
            singleLine = true,
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SchemaDataFields(
    fields: List<DataFieldDefinition>,
    data: Map<String, String>,
    errors: Map<String, String>,
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
                val error = errors[field.name]
                OutlinedTextField(
                    value = data[field.name] ?: "",
                    onValueChange = { onDataChange(data + (field.name to it)) },
                    label = { Text("$fieldLabel$unitSuffix") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    isError = error != null,
                    supportingText = if (error != null) {
                        { Text(error) }
                    } else {
                        null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }

            else -> {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PendingEntriesSection(
    apiUrl: String,
    authToken: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf(getPendingEntries(context)) }
    var editingEntry by remember { mutableStateOf<PendingEntry?>(null) }
    var editingTimeMillis by remember { mutableLongStateOf(nowEpochMillis()) }

    LaunchedEffect(Unit) {
        entries = getPendingEntries(context)
    }

    if (entries.isEmpty()) return

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
    Text(
        "Pending entries (${entries.size})",
        style = MaterialTheme.typography.titleSmall,
    )

    entries.forEach { entry ->
        val description = when (val data = entry.data) {
            is PendingPayload.Activity ->
                if (data.payload.created_activity_id != null) {
                    "Comment for ${data.payload.activity_type}"
                } else {
                    "Activity: ${data.payload.activity_type}"
                }
            is PendingPayload.Metric ->
                "Metric: ${data.payload.metric} = ${data.payload.value} ${data.payload.unit ?: ""}".trimEnd()
        }
        val timeStr = when (val data = entry.data) {
            is PendingPayload.Activity -> data.payload.start_time
            is PendingPayload.Metric -> data.payload.time
        }
        val activityCreated = (entry.data as? PendingPayload.Activity)?.payload?.created_activity_id != null

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
        ) {
            Text(description, style = MaterialTheme.typography.bodyMedium)
            Text(
                "Time: $timeStr",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
            if (entry.refused) {
                Text(
                    "Refused: ${entry.last_error ?: "unknown error"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Text(
                    if (activityCreated) "Not sent again. Retry or delete it." else "Not sent again. Edit or delete it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            } else if (entry.fail_count > 0) {
                Text(
                    "Failed ${entry.fail_count}x: ${entry.last_error ?: "unknown error"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 4.dp),
            ) {
                if (!activityCreated) {
                    OutlinedButton(onClick = {
                        val millis = try {
                            ZonedDateTime.parse(timeStr, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                                .toInstant().toEpochMilli()
                        } catch (_: Exception) {
                            nowEpochMillis()
                        }
                        editingTimeMillis = millis
                        editingEntry = entry
                    }) { Text("Edit time") }
                }
                OutlinedButton(onClick = {
                    scope.launch {
                        val error: DataResult.Error? = when (val data = entry.data) {
                            is PendingPayload.Activity -> {
                                val outcome = sendPendingActivity(
                                    payload = data.payload,
                                    types = getCachedActivityTypes(context),
                                    sendActivity = { body -> postActivity(httpClient, apiUrl, authToken, body) },
                                    sendComment = { activityId, content ->
                                        postEntityComment(httpClient, apiUrl, authToken, "activity", activityId, content)
                                    },
                                    saveActivityId = { activityId ->
                                        recordCreatedActivity(context, entry.id, activityId)
                                    },
                                )
                                when (outcome) {
                                    PendingActivityOutcome.Sent -> null
                                    is PendingActivityOutcome.ActivityFailed -> outcome.error
                                    is PendingActivityOutcome.CommentFailed -> outcome.error
                                }
                            }
                            is PendingPayload.Metric -> {
                                val body = AddMetricBody(
                                    metric = data.payload.metric,
                                    value = data.payload.value,
                                    time = data.payload.time,
                                    unit = data.payload.unit,
                                )
                                when (val posted = postMetric(httpClient, apiUrl, authToken, body)) {
                                    is DataResult.Success -> null
                                    is DataResult.Error -> posted
                                }
                            }
                        }
                        if (error == null) {
                            removePendingEntry(context, entry.id)
                        } else {
                            markPendingEntryFailed(context, entry.id, error.message, error.statusCode)
                        }
                        entries = getPendingEntries(context)
                    }
                }) { Text("Retry") }
                OutlinedButton(onClick = {
                    removePendingEntry(context, entry.id)
                    entries = getPendingEntries(context)
                }) { Text("Delete") }
            }
        }
    }

    val currentEditing = editingEntry
    if (currentEditing != null) {
        DateTimePickerField(
            label = "New time",
            epochMillis = editingTimeMillis,
            onChanged = { editingTimeMillis = it },
        )

        AlertDialog(
            onDismissRequest = { editingEntry = null },
            confirmButton = {
                TextButton(onClick = {
                    val newIso = epochMillisToIso(editingTimeMillis)
                    val updated = when (val data = currentEditing.data) {
                        is PendingPayload.Activity -> currentEditing.copy(
                            data = PendingPayload.Activity(
                                data.payload.copy(start_time = newIso)
                            ),
                            fail_count = 0,
                            last_error = null,
                            refused = false,
                        )
                        is PendingPayload.Metric -> currentEditing.copy(
                            data = PendingPayload.Metric(
                                data.payload.copy(time = newIso)
                            ),
                            fail_count = 0,
                            last_error = null,
                            refused = false,
                        )
                    }
                    updatePendingEntry(context, updated)
                    entries = getPendingEntries(context)
                    editingEntry = null
                }) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { editingEntry = null }) { Text("Cancel") }
            },
            title = { Text("Edit time") },
            text = {
                DateTimePickerField(
                    label = "Time",
                    epochMillis = editingTimeMillis,
                    onChanged = { editingTimeMillis = it },
                )
            },
        )
    }
}

@Composable
private fun AddActivityTab(
    apiUrl: String,
    authToken: String,
    onOpenWebPage: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var activityTypes by remember { mutableStateOf(getCachedActivityTypes(context)) }
    var activityTypeCatalog by remember { mutableStateOf(getCachedActivityTypeCatalog(context)) }
    var selectedType by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var startTimeMillis by remember { mutableLongStateOf(nowEpochMillis()) }
    var endTimeMillis by remember { mutableLongStateOf(nowEpochMillis()) }
    var hasEndTime by remember { mutableStateOf(true) }
    var notes by remember { mutableStateOf("") }
    var comment by remember { mutableStateOf("") }
    var people by remember { mutableStateOf(getCachedPeople(context)) }
    var withPeople by remember { mutableStateOf<List<String>>(emptyList()) }
    var structuredData by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    val loadActivityTypes: suspend () -> Unit = {
        when (val result = fetchActivityTypes(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                activityTypes = result.data
                cacheActivityTypes(context, result.data)
            }
            is DataResult.Error -> { /* use cached/defaults */ }
        }
        when (val result = fetchActivityTypeCatalog(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                activityTypeCatalog = result.data
                cacheActivityTypeCatalog(context, result.data)
            }
            is DataResult.Error -> { /* use cached */ }
        }
        when (val result = fetchPeople(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                people = result.data
                cachePeople(context, result.data)
            }
            is DataResult.Error -> { /* use cached */ }
        }
    }

    LaunchedEffect(Unit) { loadActivityTypes() }

    val selectedTypeDef = resolveActivityType(selectedType, activityTypes, activityTypeCatalog)
    // A list field (a strength session's sets) has no native row editor: sets are logged on the
    // strength session web page, and a text box here would send a string the backend rejects.
    val dataFields = selectedTypeDef?.dataSchema?.fields?.filter { it.type != "list" } ?: emptyList()
    val dataInput = buildActivityData(dataFields, structuredData)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add Activity", style = MaterialTheme.typography.titleLarge)

        TextButton(onClick = { onOpenWebPage("/strength/workouts") }) {
            Text("Log a strength session")
        }

        if (message.isNotEmpty()) {
            Text(
                text = message,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }

        ActivityTypePicker(
            activityTypes = activityTypes,
            catalog = activityTypeCatalog,
            selectedType = selectedType,
            onTypeSelected = { newType ->
                selectedType = newType
                structuredData = emptyMap()
            },
        )

        if (dataFields.isNotEmpty()) {
            SchemaDataFields(
                fields = dataFields,
                data = structuredData,
                errors = (dataInput as? ActivityDataInput.Invalid)?.fieldErrors ?: emptyMap(),
                onDataChange = { structuredData = it },
            )
        }

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

        DateTimePickerField(
            label = "Start Time",
            epochMillis = startTimeMillis,
            onChanged = {
                startTimeMillis = it
                endTimeMillis = it + 5 * 60 * 1000
            },
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = hasEndTime, onCheckedChange = { hasEndTime = it })
            Text("Has end time", modifier = Modifier.clickable { hasEndTime = !hasEndTime })
        }

        if (hasEndTime) {
            DateTimePickerField(
                label = "End Time",
                epochMillis = endTimeMillis,
                onChanged = { endTimeMillis = it },
            )
        }

        WithPickerField(
            people = people,
            selected = withPeople,
            onSelectedChange = { withPeople = it },
        )

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

        OutlinedTextField(
            value = comment,
            onValueChange = { comment = it },
            label = { Text("Comment") },
            placeholder = { Text("Optional comment") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
            maxLines = 5,
        )

        val pendingCount = pendingEntryCount(context)
        if (pendingCount > 0) {
            Text(
                text = "$pendingCount pending entries waiting to sync",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        Button(
            onClick = {
                if (selectedType.isBlank()) {
                    message = "Please select an activity type"
                    isError = true
                    return@Button
                }
                val activityData = when (dataInput) {
                    is ActivityDataInput.Valid -> dataInput.data
                    is ActivityDataInput.Invalid -> {
                        message = "Please fix the highlighted fields"
                        isError = true
                        return@Button
                    }
                }
                submitting = true
                message = ""

                val startIso = epochMillisToIso(startTimeMillis)
                val endIso = if (hasEndTime) epochMillisToIso(endTimeMillis) else null

                val payload = PendingActivityPayload(
                    activity_type = selectedType,
                    start_time = startIso,
                    end_time = endIso,
                    title = title.trim().ifBlank { null },
                    notes = notes.trim().ifBlank { null },
                    data = activityData,
                    people = withPeople.ifEmpty { null },
                    comment = comment.trim().ifBlank { null },
                )

                val pendingEntry = PendingEntry(
                    data = PendingPayload.Activity(payload),
                    created_at = epochMillisToIso(nowEpochMillis()),
                )
                addPendingEntry(context, pendingEntry)
                val adoptsCatalogType = activityTypes.none { it.name == selectedType } &&
                    activityTypeCatalog.any { it.name == selectedType }

                scope.launch {
                    val outcome = sendPendingActivity(
                        payload = payload,
                        types = activityTypes,
                        sendActivity = { body -> postActivity(httpClient, apiUrl, authToken, body) },
                        sendComment = { activityId, content ->
                            postEntityComment(httpClient, apiUrl, authToken, "activity", activityId, content)
                        },
                        saveActivityId = { activityId -> recordCreatedActivity(context, pendingEntry.id, activityId) },
                    )
                    submitting = false
                    when (outcome) {
                        is PendingActivityOutcome.ActivityFailed -> {
                            markPendingEntryFailed(
                                context,
                                pendingEntry.id,
                                outcome.error.message,
                                outcome.error.statusCode,
                            )
                            message = "Error: ${outcome.error.message}"
                            isError = true
                        }
                        PendingActivityOutcome.Sent, is PendingActivityOutcome.CommentFailed -> {
                            if (outcome is PendingActivityOutcome.CommentFailed) {
                                val refused = isPermanentRefusal(outcome.error.statusCode)
                                markPendingEntryFailed(context, pendingEntry.id, outcome.error.message, outcome.error.statusCode)
                                message = if (refused) {
                                    "Activity added. The comment was refused: ${outcome.error.message}"
                                } else {
                                    "Activity added. The comment will be sent later."
                                }
                            } else {
                                removePendingEntry(context, pendingEntry.id)
                                message = "Activity added!"
                            }
                            if (adoptsCatalogType) loadActivityTypes()
                            isError = false
                            selectedType = ""
                            title = ""
                            startTimeMillis = nowEpochMillis()
                            endTimeMillis = nowEpochMillis()
                            hasEndTime = true
                            notes = ""
                            comment = ""
                            withPeople = emptyList()
                            structuredData = emptyMap()
                        }
                    }
                }
            },
            enabled = !submitting && selectedType.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (submitting) "Adding..." else "Add Activity")
        }

        PendingEntriesSection(apiUrl = apiUrl, authToken = authToken)
    }
}

@Composable
private fun AddMetricTab(
    apiUrl: String,
    authToken: String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var customMetrics by remember { mutableStateOf(getCachedCustomMetrics(context)) }
    var metricCatalog by remember { mutableStateOf(getCachedMetricCatalog(context)) }
    var selectedMetric by remember { mutableStateOf("") }
    var chosenUnit by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    var timeMillis by remember { mutableLongStateOf(nowEpochMillis()) }

    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }

    val httpClient = remember {
        HttpClient(Android) {
            install(ContentNegotiation) { json(appJson) }
        }
    }

    val loadMetrics: suspend () -> Unit = {
        when (val result = fetchCustomMetrics(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                customMetrics = result.data
                cacheCustomMetrics(context, result.data)
            }
            is DataResult.Error -> { /* use cached */ }
        }
        when (val result = fetchMetricCatalog(httpClient, apiUrl, authToken)) {
            is DataResult.Success -> {
                metricCatalog = result.data
                cacheMetricCatalog(context, result.data)
            }
            is DataResult.Error -> { /* use cached */ }
        }
    }

    LaunchedEffect(Unit) { loadMetrics() }

    val catalogEntry = metricCatalog.find { it.name == selectedMetric }
    val unitOptions = catalogEntry?.let { metricUnitOptions(it) } ?: emptyList()
    val selectedUnit = chosenUnit ?: catalogEntry?.let { defaultMetricUnit(it) }

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

        MetricPicker(
            customMetrics = customMetrics,
            metricCatalog = metricCatalog,
            selectedMetric = selectedMetric,
            onMetricSelected = {
                selectedMetric = it
                chosenUnit = null
            },
        )

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
            if (unitOptions.isNotEmpty() && selectedUnit != null) {
                MetricUnitField(
                    options = unitOptions,
                    selected = selectedUnit,
                    onSelected = { chosenUnit = it },
                    modifier = Modifier.weight(1f),
                )
            } else {
                DateTimePickerField(
                    label = "Time",
                    epochMillis = timeMillis,
                    onChanged = { timeMillis = it },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (unitOptions.isNotEmpty() && selectedUnit != null) {
            DateTimePickerField(
                label = "Time",
                epochMillis = timeMillis,
                onChanged = { timeMillis = it },
            )
        }

        val pendingCount = pendingEntryCount(context)
        if (pendingCount > 0) {
            Text(
                text = "$pendingCount pending entries waiting to sync",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

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

                val timeIso = epochMillisToIso(timeMillis)

                val body = AddMetricBody(
                    metric = selectedMetric,
                    value = parsedValue,
                    time = timeIso,
                    unit = metricUnitToSend(catalogEntry, selectedUnit),
                )

                val pendingEntry = PendingEntry(
                    data = PendingPayload.Metric(
                        PendingMetricPayload(
                            metric = body.metric,
                            value = body.value,
                            time = timeIso,
                            unit = body.unit,
                        )
                    ),
                    created_at = epochMillisToIso(nowEpochMillis()),
                )
                addPendingEntry(context, pendingEntry)
                val adoptsCatalogMetric = catalogEntry?.inUse == false

                scope.launch {
                    val result = postMetric(httpClient, apiUrl, authToken, body)
                    submitting = false
                    when (result) {
                        is DataResult.Success -> {
                            removePendingEntry(context, pendingEntry.id)
                            if (adoptsCatalogMetric) loadMetrics()
                            message = "Metric recorded!"
                            isError = false
                            value = ""
                            timeMillis = nowEpochMillis()
                        }
                        is DataResult.Error -> {
                            markPendingEntryFailed(context, pendingEntry.id, result.message, result.statusCode)
                            message = "Error: ${result.message}"
                            isError = true
                        }
                    }
                }
            },
            enabled = !submitting && selectedMetric.isNotBlank() && value.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (submitting) "Adding..." else "Add Metric")
        }

        PendingEntriesSection(apiUrl = apiUrl, authToken = authToken)
    }
}
