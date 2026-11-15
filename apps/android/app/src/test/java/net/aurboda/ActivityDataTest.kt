package net.aurboda

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityDataTest {
  private val fields = listOf(
    DataFieldDefinition(name = "distance", type = "number"),
    DataFieldDefinition(name = "indoor", type = "boolean"),
    DataFieldDefinition(name = "route", type = "string"),
    DataFieldDefinition(name = "sets", type = "list"),
  )

  @Test
  fun `parseDecimal accepts a decimal point or a decimal comma`() {
    assertEquals(12.0, parseDecimal("12")!!, 0.0)
    assertEquals(72.5, parseDecimal("72.5")!!, 0.0)
    assertEquals(72.5, parseDecimal("72,5")!!, 0.0)
    assertEquals(0.5, parseDecimal(",5")!!, 0.0)
    assertEquals(-3.25, parseDecimal(" -3.25 ")!!, 0.0)
  }

  @Test
  fun `parseDecimal refuses what is not a plain decimal number`() {
    listOf("", "abc", "12a", "1.2.3", "1,2,3", "12d", "1e5", "NaN", "Infinity", "-", "1 000").forEach {
      assertNull(it, parseDecimal(it))
    }
  }

  @Test
  fun `fieldValue types each value as the schema declares`() {
    assertEquals(JsonPrimitive(12), fieldValue("number", "12"))
    assertEquals(JsonPrimitive(7.5), fieldValue("number", "7,5"))
    assertEquals(JsonPrimitive(true), fieldValue("boolean", "true"))
    assertEquals(JsonPrimitive(false), fieldValue("boolean", "false"))
    assertEquals(JsonPrimitive("Hill loop"), fieldValue("string", " Hill loop "))
    assertNull(fieldValue("number", "twelve"))
    assertNull(fieldValue("boolean", "yes"))
  }

  @Test
  fun `buildActivityData sends numbers as numbers and booleans as booleans`() {
    val result = buildActivityData(fields, mapOf("distance" to "12,5", "indoor" to "true", "route" to " Hill loop "))
    val expected = buildJsonObject {
      put("distance", 12.5)
      put("indoor", true)
      put("route", "Hill loop")
    }
    assertEquals(ActivityDataInput.Valid(expected), result)
    assertEquals(
      """{"distance":12.5,"indoor":true,"route":"Hill loop"}""",
      (result as ActivityDataInput.Valid).data.toString(),
    )
  }

  @Test
  fun `buildActivityData sends a whole number without a fraction`() {
    val result = buildActivityData(fields, mapOf("distance" to "12"))
    assertEquals("""{"distance":12}""", (result as ActivityDataInput.Valid).data.toString())
  }

  @Test
  fun `buildActivityData leaves out blank fields, list fields and keys the schema does not declare`() {
    assertEquals(ActivityDataInput.Valid(null), buildActivityData(fields, emptyMap()))
    assertEquals(
      ActivityDataInput.Valid(null),
      buildActivityData(fields, mapOf("distance" to "  ", "route" to "", "sets" to "3", "other" to "x")),
    )
  }

  @Test
  fun `buildActivityData marks a number field that does not parse`() {
    val result = buildActivityData(fields, mapOf("distance" to "12 km", "route" to "Hill loop"))
    assertEquals(ActivityDataInput.Invalid(mapOf("distance" to "Not a number")), result)
  }

  @Test
  fun `typedActivityData converts a queued string-map entry using the type's schema`() {
    val queued = buildJsonObject {
      put("distance", "12,5")
      put("indoor", "false")
      put("route", "Hill loop")
      put("extra", "7")
    }
    val expected = buildJsonObject {
      put("distance", 12.5)
      put("indoor", false)
      put("route", "Hill loop")
      put("extra", "7")
    }
    assertEquals(expected, typedActivityData(queued, fields))
  }

  @Test
  fun `typedActivityData leaves typed values and unconvertible strings as they are`() {
    val data = buildJsonObject {
      put("distance", 3)
      put("indoor", "maybe")
    }
    assertEquals(data, typedActivityData(data, fields))
  }

  @Test
  fun `typedActivityData sends the data as it is without a schema`() {
    val queued = buildJsonObject { put("distance", "12") }
    assertEquals(queued, typedActivityData(queued, null))
    assertNull(typedActivityData(null, fields))
  }

  @Test
  fun `a pending entry queued with string data still decodes and is sent typed`() {
    val stored = """
      [{
        "id": "e1",
        "data": {
          "type": "activity",
          "payload": {
            "activity_type": "run",
            "start_time": "2026-11-01T08:00:00Z",
            "data": { "distance": "5,2", "indoor": "true" }
          }
        },
        "created_at": "2026-11-01T08:30:00Z"
      }]
    """.trimIndent()
    val entry = appJson.decodeFromString<List<PendingEntry>>(stored).single()
    val payload = (entry.data as PendingPayload.Activity).payload
    val types = listOf(
      ActivityTypeDefinition(name = "run", displayName = "Run", dataSchema = DataSchemaDefinition(fields)),
    )

    val body = payload.toAddActivityBody(types)

    val json = appJson.encodeToString(AddActivityBody.serializer(), body)
    assertTrue(json, Regex(""""distance":\s*5\.2""").containsMatchIn(json))
    assertTrue(json, Regex(""""indoor":\s*true""").containsMatchIn(json))
    assertEquals("run", body.activityType)
    assertEquals("2026-11-01T08:00:00Z", body.startTime)
  }

  @Test
  fun `a pending entry for a type with no cached schema is sent as queued`() {
    val queued = buildJsonObject { put("distance", "5") }
    val payload = PendingActivityPayload(activity_type = "run", start_time = "2026-11-01T08:00:00Z", data = queued)
    assertEquals(queued, payload.toAddActivityBody(emptyList()).data)
  }

  @Test
  fun `a number outside both bounds is refused with the range`() {
    val severity = listOf(DataFieldDefinition(name = "severity", type = "number", min = 0.0, max = 10.0))
    val result = buildActivityData(severity, mapOf("severity" to "11"))
    assertEquals(mapOf("severity" to "Must be between 0 and 10"), (result as ActivityDataInput.Invalid).fieldErrors)
    assertTrue(buildActivityData(severity, mapOf("severity" to "-1")) is ActivityDataInput.Invalid)
  }

  @Test
  fun `a number on a bound or inside the range is accepted`() {
    val severity = listOf(DataFieldDefinition(name = "severity", type = "number", min = 0.0, max = 10.0))
    listOf("0", "10", "4,5").forEach {
      assertTrue(it, buildActivityData(severity, mapOf("severity" to it)) is ActivityDataInput.Valid)
    }
  }

  @Test
  fun `a one-sided bound gets one-sided wording`() {
    assertEquals("Must be at least 0", numberBoundsError(0.0, null, -0.5))
    assertEquals("Must be at most 2.5", numberBoundsError(null, 2.5, 3.0))
    assertNull(numberBoundsError(null, null, 1e9))
    assertNull(numberBoundsError(0.0, null, 0.0))
  }

  @Test
  fun `bounds apply to number fields only`() {
    val text = listOf(DataFieldDefinition(name = "note", type = "string", min = 0.0, max = 1.0))
    assertTrue(buildActivityData(text, mapOf("note" to "5")) is ActivityDataInput.Valid)
  }
}
