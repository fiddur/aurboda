package net.aurboda

fun catalogEntryAsType(entry: CatalogActivityType): ActivityTypeDefinition =
    ActivityTypeDefinition(
        name = entry.name,
        displayName = entry.displayName,
        displayCategory = entry.displayCategory,
        color = entry.color,
        icon = entry.icon,
        isBuiltin = false,
        dataSchema = entry.dataSchema,
        parentType = entry.parentType,
    )

/** The catalogue types not in use and not already among the user's types by name, in catalogue order. */
fun catalogTypesToOffer(
    types: List<ActivityTypeDefinition>,
    catalog: List<CatalogActivityType>,
): List<CatalogActivityType> {
    val names = types.map { it.name }.toSet()
    return catalog.filter { !it.inUse && it.name !in names }
}

/** The user's type of that name, else the catalogue entry of that name shaped as a type. */
fun resolveActivityType(
    name: String,
    types: List<ActivityTypeDefinition>,
    catalog: List<CatalogActivityType>,
): ActivityTypeDefinition? =
    types.find { it.name == name } ?: catalog.find { it.name == name }?.let(::catalogEntryAsType)

/** The catalogue metrics not in use whose name is neither a built-in metric nor a custom metric. */
fun catalogMetricsToOffer(
    catalog: List<CatalogMetric>,
    builtinNames: Set<String>,
    customNames: Set<String>,
): List<CatalogMetric> =
    catalog.filter { !it.inUse && it.name !in builtinNames && it.name !in customNames }

/**
 * For comparing units only, as `normalizeUnit` in `@aurboda/api-spec` does. NFKC is not used: it turns the
 * micro sign into Greek mu.
 */
fun normalizeUnit(unit: String): String =
    unit
        .trim()
        .replace('μ', 'µ')
        .lowercase()
        .replace(Regex("""\s+"""), "")
        .replace("mcg", "µg")
        .replace(Regex("""(^|[^a-z])u(?=g|mol|iu|kat|l)"""), "$1µ")
        .replace("percent", "%")
        .replace("celsius", "°c")

fun catalogAcceptsUnit(entry: CatalogMetric, unit: String): Boolean {
    val spellings = listOf(entry.unit) + entry.unitAliases.orEmpty() +
        entry.units.flatMap { listOf(it.unit) + it.aliases.orEmpty() }
    val normalized = normalizeUnit(unit)
    return spellings.any { normalizeUnit(it) == normalized }
}

/**
 * The units to offer for a catalogue metric, as the web Add form does: the stored unit and the other accepted
 * units, after the user's own unit when it is spelled as none of them. A unit of the user's that the catalogue
 * does not accept is the only one offered, since a value in any other unit cannot be converted to it.
 */
fun metricUnitOptions(entry: CatalogMetric): List<String> {
    val accepted = (listOf(entry.unit) + entry.units.map { it.unit }).distinct()
    val own = entry.inUseUnit
    return when {
        own == null || own in accepted -> accepted
        catalogAcceptsUnit(entry, own) -> listOf(own) + accepted
        else -> listOf(own)
    }
}

/** The unit the user's metric is stored in, else the catalogue's stored unit. */
fun defaultMetricUnit(entry: CatalogMetric): String = entry.inUseUnit ?: entry.unit

/** A unit only when it differs from the default: left out, the server takes the value to be in the metric's unit. */
fun metricUnitToSend(entry: CatalogMetric?, chosen: String?): String? =
    if (entry == null || chosen == null || chosen == defaultMetricUnit(entry)) null else chosen
