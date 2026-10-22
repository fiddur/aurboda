package net.aurboda.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

/** Longest bitmap edge we hand to RemoteViews — keeps the parcel well under the binder limit. */
private const val MAX_CHART_PX = 800

/**
 * Draw the race chart — one cumulative line per member with a translucent area
 * under it, over the whole challenge window so how far the race has run is
 * visible — into a bitmap RemoteViews can show. The x-axis spans
 * [startMillis, endMillis) and y from zero to just above the leading total.
 * Nothing is drawn but a baseline when there are no series.
 */
fun drawRaceChart(
    widthPx: Int,
    heightPx: Int,
    density: Float,
    series: List<RaceSeries>,
    startMillis: Long,
    endMillis: Long,
): Bitmap {
    val w = widthPx.coerceIn(1, MAX_CHART_PX)
    val h = heightPx.coerceIn(1, MAX_CHART_PX)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    val stroke = 2f * density
    val inset = stroke // keep round line caps inside the bitmap
    val plotW = (w - 2 * inset).coerceAtLeast(1f)
    val plotH = (h - 2 * inset).coerceAtLeast(1f)

    val span = (endMillis - startMillis).coerceAtLeast(1L).toDouble()
    val maxValue = series.maxOfOrNull { s -> s.points.maxOfOrNull { it.value } ?: 0.0 } ?: 0.0
    val yMax = if (maxValue > 0) maxValue * 1.05 else 1.0

    fun x(t: Long): Float = (inset + plotW * ((t - startMillis) / span)).toFloat().coerceIn(inset, inset + plotW)
    fun y(v: Double): Float = (inset + plotH - plotH * (v / yMax)).toFloat()

    val baseline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(0x40, 0xFF, 0xFF, 0xFF)
        strokeWidth = 1f * density
    }
    canvas.drawLine(inset, inset + plotH, inset + plotW, inset + plotH, baseline)

    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = stroke
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    // Areas first so no fill covers another member's line.
    for (s in series) {
        if (s.points.size < 2) continue
        val area = Path()
        area.moveTo(x(s.points.first().timeMillis), inset + plotH)
        for (p in s.points) area.lineTo(x(p.timeMillis), y(p.value))
        area.lineTo(x(s.points.last().timeMillis), inset + plotH)
        area.close()
        fill.color = (s.color and 0x00FFFFFF) or (0x22 shl 24)
        canvas.drawPath(area, fill)
    }
    for (s in series) {
        if (s.points.size < 2) continue
        val path = Path()
        path.moveTo(x(s.points.first().timeMillis), y(s.points.first().value))
        for (p in s.points.drop(1)) path.lineTo(x(p.timeMillis), y(p.value))
        line.color = s.color
        canvas.drawPath(path, line)
    }
    return bitmap
}
