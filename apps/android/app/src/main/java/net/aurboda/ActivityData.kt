package net.aurboda

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs

private val decimalPattern = Regex("""[+-]?(\d+([.,]\d*)?|[.,]\d+)""")

fun parseDecimal(raw: String): Double? =
    raw.trim()
        .takeIf { decimalPattern.matches(it) }
        ?.replace(',', '.')
        ?.toDoubleOrNull()
        ?.takeIf { it.isFinite() }

private fun numberPrimitive(value: Double): JsonPrimitive =
    if (value % 1.0 == 0.0 && abs(value) < 1e15) JsonPrimitive(value.toLong()) else JsonPrimitive(value)

fun fieldValue(type: String, raw: String): JsonPrimitive? =
    when (type) {
        "number" -> parseDecimal(raw)?.let { numberPrimitive(it) }
        "boolean" -> raw.trim().toBooleanStrictOrNull()?.let { JsonPrimitive(it) }
        else -> JsonPrimitive(raw.trim())
    }

sealed interface ActivityDataInput {
    data class Valid(val data: JsonObject?) : ActivityDataInput
    data class Invalid(val fieldErrors: Map<String, String>) : ActivityDataInput
}

private fun invalidMessage(type: String): String = if (type == "number") "Not a number" else "Invalid value"

private fun formatBound(bound: Double): String =
    if (bound % 1.0 == 0.0 && abs(bound) < 1e15) bound.toLong().toString() else bound.toString()

fun numberBoundsError(min: Double?, max: Double?, value: Double): String? {
    if ((min == null || value >= min) && (max == null || value <= max)) return null
    val lower = min?.let(::formatBound)
    val upper = max?.let(::formatBound)
    return when {
        lower != null && upper != null -> "Must be between $lower and $upper"
        lower != null -> "Must be at least $lower"
        else -> "Must be at most $upper"
    }
}

private fun boundsError(field: DataFieldDefinition, value: JsonPrimitive): String? {
    if (field.type != "number") return null
    return value.content.toDoubleOrNull()?.let { numberBoundsError(field.min, field.max, it) }
}

fun buildActivityData(fields: List<DataFieldDefinition>, values: Map<String, String>): ActivityDataInput {
    val filled = fields
        .filter { it.type != "list" }
        .mapNotNull { field ->
            values[field.name]?.trim()?.takeIf { it.isNotEmpty() }?.let { raw -> field to fieldValue(field.type, raw) }
        }
    val errors = filled
        .mapNotNull { (field, value) ->
            val error = if (value == null) invalidMessage(field.type) else boundsError(field, value)
            error?.let { field.name to it }
        }
        .toMap()
    if (errors.isNotEmpty()) return ActivityDataInput.Invalid(errors)
    val data = filled.mapNotNull { (field, value) -> value?.let { field.name to it } }.toMap()
    return ActivityDataInput.Valid(if (data.isEmpty()) null else JsonObject(data))
}

/**
 * Entries queued before data was typed hold every value as a string. Converts those the schema
 * declares as number or boolean; a value that does not convert is sent as it is, for the server to refuse.
 */
fun typedActivityData(data: JsonObject?, fields: List<DataFieldDefinition>?): JsonObject? {
    if (data == null || fields == null) return data
    val types = fields.associate { it.name to it.type }
    return JsonObject(
        data.mapValues { (name, value) ->
            val type = types[name]
            if (type == null || type == "list" || value !is JsonPrimitive || !value.isString) {
                value
            } else {
                fieldValue(type, value.content) ?: value
            }
        },
    )
}

fun PendingActivityPayload.toAddActivityBody(types: List<ActivityTypeDefinition>): AddActivityBody =
    AddActivityBody(
        activityType = activity_type,
        startTime = start_time,
        endTime = end_time,
        title = title,
        notes = notes,
        data = typedActivityData(data, types.find { it.name == activity_type }?.dataSchema?.fields),
        people = people?.ifEmpty { null },
    )

sealed interface PendingActivityOutcome {
    data object Sent : PendingActivityOutcome
    data class ActivityFailed(val error: DataResult.Error) : PendingActivityOutcome
    data class CommentFailed(val error: DataResult.Error) : PendingActivityOutcome
}

/**
 * Posts a queued activity, then its comment. The created activity's id is handed to
 * [saveActivityId] before the comment is posted, so an entry that carries one posts only the
 * comment and never a second activity.
 */
suspend fun sendPendingActivity(
    payload: PendingActivityPayload,
    types: List<ActivityTypeDefinition>,
    sendActivity: suspend (AddActivityBody) -> DataResult<AddActivityResponse>,
    sendComment: suspend (activityId: String, content: String) -> DataResult<Unit>,
    saveActivityId: (String) -> Unit,
): PendingActivityOutcome {
    val comment = payload.comment?.trim()?.ifEmpty { null }
    val activityId = payload.created_activity_id ?: when (val result = sendActivity(payload.toAddActivityBody(types))) {
        is DataResult.Error -> return PendingActivityOutcome.ActivityFailed(result)
        is DataResult.Success -> result.data.data?.id
    }
    if (comment == null || activityId == null) return PendingActivityOutcome.Sent
    if (payload.created_activity_id == null) saveActivityId(activityId)
    return when (val result = sendComment(activityId, comment)) {
        is DataResult.Error -> PendingActivityOutcome.CommentFailed(result)
        is DataResult.Success -> PendingActivityOutcome.Sent
    }
}
