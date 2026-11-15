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

/**
 * Catalogue types whose name, display name or an alias contains the query (the query also compared in
 * snake_case against the name), exact matches first. Empty query: all of them.
 */
internal fun <T> matchCatalogTypes(
    entries: List<T>,
    query: String,
    name: (T) -> String,
    displayName: (T) -> String,
    aliases: (T) -> List<String>,
): List<T> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return entries
    val snake = toSnakeCase(q)
    val texts = { entry: T -> (listOf(displayName(entry)) + aliases(entry)).map { it.lowercase() } }
    val isExact = { entry: T -> name(entry) == q || (snake.isNotEmpty() && name(entry) == snake) || q in texts(entry) }
    val matches = { entry: T ->
        name(entry).contains(q) || (snake.isNotEmpty() && name(entry).contains(snake)) ||
            texts(entry).any { it.contains(q) }
    }
    val found = entries.filter(matches)
    return found.filter(isExact) + found.filterNot(isExact)
}

/** Whether to offer creating the typed name: not when it is a catalogue type's name, which is used as it is. */
internal fun offersNewType(match: ActivityTypeMatch<*>, catalogNames: Collection<String>): Boolean =
    match.isNewType && match.snakeInput !in catalogNames
