package net.aurboda

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogTest {
    private val headache = CatalogActivityType(
        name = "headache",
        displayName = "Headache",
        displayCategory = "health",
        color = "#aa3344",
        icon = "🤕",
        aliases = listOf("migraine"),
        dataSchema = DataSchemaDefinition(
            listOf(DataFieldDefinition(name = "severity", type = "number", min = 0.0, max = 10.0)),
        ),
    )
    private val coffee = CatalogActivityType(name = "coffee", displayName = "Coffee", inUse = true)
    private val alcohol = CatalogActivityType(name = "alcohol", displayName = "Alcohol")

    @Test
    fun `a catalogue entry is shaped as a type with its schema`() {
        val type = catalogEntryAsType(headache)
        assertEquals("headache", type.name)
        assertEquals("Headache", type.displayName)
        assertEquals("health", type.displayCategory)
        assertEquals("🤕", type.icon)
        assertEquals("#aa3344", type.color)
        assertFalse(type.isBuiltin)
        assertEquals(headache.dataSchema, type.dataSchema)
    }

    @Test
    fun `offered catalogue types leave out those in use and those the user has by name`() {
        val types = listOf(ActivityTypeDefinition(name = "alcohol", displayName = "Booze"))
        assertEquals(listOf("headache"), catalogTypesToOffer(types, listOf(headache, coffee, alcohol)).map { it.name })
    }

    @Test
    fun `a type resolves to the user's own before the catalogue entry`() {
        val own = ActivityTypeDefinition(name = "headache", displayName = "My headache")
        assertEquals(own, resolveActivityType("headache", listOf(own), listOf(headache)))
        assertEquals("Headache", resolveActivityType("headache", emptyList(), listOf(headache))?.displayName)
        assertNull(resolveActivityType("nope", listOf(own), listOf(headache)))
    }

    private fun metric(
        name: String,
        unit: String = "mmol/L",
        units: List<String> = emptyList(),
        inUse: Boolean = false,
        inUseUnit: String? = null,
    ) = CatalogMetric(
        name = name,
        displayName = name,
        unit = unit,
        units = units.map { CatalogMetricUnit(unit = it) },
        inUse = inUse,
        inUseUnit = inUseUnit,
    )

    @Test
    fun `offered catalogue metrics leave out those in use, built-in or custom`() {
        val catalog = listOf(metric("ldl"), metric("hdl", inUse = true), metric("weight"), metric("ferritin"))
        val offered = catalogMetricsToOffer(catalog, setOf("weight"), setOf("ferritin"))
        assertEquals(listOf("ldl"), offered.map { it.name })
    }

    @Test
    fun `unit options are the stored unit then the other accepted units`() {
        assertEquals(listOf("mmol/L", "mg/dL"), metricUnitOptions(metric("ldl", units = listOf("mg/dL"))))
    }

    @Test
    fun `unit options keep the catalogue order when the user's unit is one of them`() {
        val entry = metric("ldl", units = listOf("mg/dL"), inUse = true, inUseUnit = "mg/dL")
        assertEquals(listOf("mmol/L", "mg/dL"), metricUnitOptions(entry))
        assertEquals("mg/dL", defaultMetricUnit(entry))
    }

    @Test
    fun `the user's unit spelled otherwise comes first`() {
        val entry = CatalogMetric(
            name = "vitamin_b12",
            displayName = "Vitamin B12",
            unit = "pmol/L",
            units = listOf(CatalogMetricUnit(unit = "µg/L", aliases = listOf("mcg/L"))),
            inUse = true,
            inUseUnit = "ug/L",
        )
        assertEquals(listOf("ug/L", "pmol/L", "µg/L"), metricUnitOptions(entry))
    }

    @Test
    fun `a user's unit the catalogue does not accept is the only option`() {
        val entry = metric("ldl", units = listOf("mg/dL"), inUse = true, inUseUnit = "furlongs")
        assertEquals(listOf("furlongs"), metricUnitOptions(entry))
    }

    @Test
    fun `unit options have no duplicates`() {
        assertEquals(listOf("mmol/L"), metricUnitOptions(metric("ldl", units = listOf("mmol/L"))))
    }

    @Test
    fun `a unit is sent only when it differs from the default`() {
        val entry = metric("ldl", units = listOf("mg/dL"))
        assertNull(metricUnitToSend(entry, "mmol/L"))
        assertNull(metricUnitToSend(entry, null))
        assertNull(metricUnitToSend(null, "mg/dL"))
        assertEquals("mg/dL", metricUnitToSend(entry, "mg/dL"))
        val own = metric("ldl", units = listOf("mg/dL"), inUse = true, inUseUnit = "mg/dL")
        assertNull(metricUnitToSend(own, "mg/dL"))
        assertEquals("mmol/L", metricUnitToSend(own, "mmol/L"))
    }

    @Test
    fun `units compare as the api-spec does`() {
        assertEquals("µg/l", normalizeUnit(" mcg / L "))
        assertEquals("µmol/l", normalizeUnit("umol/L"))
        assertEquals("µg/l", normalizeUnit("μg/L"))
        assertTrue(catalogAcceptsUnit(metric("x", unit = "µmol/L"), "umol/l"))
        assertFalse(catalogAcceptsUnit(metric("x", unit = "µmol/L"), "mg/dL"))
    }

    @Test
    fun `the activity type catalogue decodes, variants and unknown groups included`() {
        val json = """
            {"success":true,"data":{"version":"1","groups":[{"key":"symptoms","name":"Symptoms"}],"entries":[
              {"name":"alcohol","display_name":"Alcohol","display_category":"intake","group":"brand_new_group",
               "icon":"🍷","color":"#123456","aliases":["booze"],"same_as":{},"in_use":false,"missing_fields":[],
               "data_schema":{"fields":[{"name":"kind","type":"string","enum_values":["beer","wine"]},
                                        {"name":"units","type":"number","min":0}]},
               "variants":[{"name":"beer","display_name":"Beer","aliases":[],"data":{"kind":"beer","units":1}}]}
            ]}}
        """.trimIndent()
        val entry = appJson.decodeFromString<ActivityTypeCatalogListResponse>(json).data!!.entries.single()
        assertEquals("alcohol", entry.name)
        assertEquals(listOf("booze"), entry.aliases)
        assertFalse(entry.inUse)
        assertEquals(0.0, entry.dataSchema!!.fields[1].min!!, 0.0)
    }

    @Test
    fun `the metric catalogue decodes`() {
        val json = """
            {"success":true,"data":{"version":"1","groups":[],"entries":[
              {"name":"ldl","display_name":"LDL","group":"lipids","aliases":["ldl_c"],"unit":"mmol/L",
               "units":[{"unit":"mg/dL","factor":0.02586}],"in_use":true,"in_use_unit":"mg/dL"}
            ]}}
        """.trimIndent()
        val entry = appJson.decodeFromString<MetricCatalogListResponse>(json).data!!.entries.single()
        assertEquals(listOf("mmol/L", "mg/dL"), metricUnitOptions(entry))
        assertEquals("mg/dL", entry.inUseUnit)
        assertTrue(entry.inUse)
    }
}
