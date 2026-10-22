package net.aurboda.ui.screens

internal data class ActivityTypeMatch<T>(
    val filtered: List<T>,
    val isNewType: Boolean,
    val snakeInput: String,
)

private fun toSnakeCase(s: String): String =
    s.trim().lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')

internal fun <T> matchActivityTypes(
    types: List<T>,
    query: String,
    name: (T) -> String,
    displayName: (T) -> String,
): ActivityTypeMatch<T> {
    val q = query.trim().lowercase()
    val snakeInput = toSnakeCase(q)
    if (q.isEmpty()) return ActivityTypeMatch(types, isNewType = false, snakeInput = snakeInput)

    val isExact = { type: T ->
        displayName(type).lowercase() == q || name(type) == q || name(type) == snakeInput
    }
    val exact = types.filter(isExact)
    val partial = types.filter {
        !isExact(it) && (displayName(it).lowercase().contains(q) || name(it).contains(q))
    }
    return ActivityTypeMatch(
        filtered = exact + partial,
        isNewType = snakeInput.isNotEmpty() && exact.isEmpty(),
        snakeInput = snakeInput,
    )
}
