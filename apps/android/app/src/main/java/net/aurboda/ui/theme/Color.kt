package net.aurboda.ui.theme

import androidx.compose.ui.graphics.Color

// Fjord fallback scheme, mirroring the web's colour tokens (docs/web-theme.md)
val FjordTeal = Color(0xFF17707A)
val FjordNavy = Color(0xFF0F2A4F)
val FjordOrange = Color(0xFFF9AB33)

val FjordTealLight = Color(0xFF4CC3CC)
val FjordNavyLight = Color(0xFF8FB3D9)

// HR Zone Colors
val HrZone0Color = Color(0xFF9E9E9E) // Gray - Below threshold
val HrZone1Color = Color(0xFF64B5F6) // Light Blue - Warm-up
val HrZone2Color = Color(0xFF4CAF50) // Green - Aerobic
val HrZone3Color = Color(0xFFFFC107) // Amber - Tempo
val HrZone4Color = Color(0xFFFF9800) // Orange - Threshold
val HrZone5Color = Color(0xFFF44336) // Red - Max effort

val HrZoneColors = listOf(
    HrZone0Color,
    HrZone1Color,
    HrZone2Color,
    HrZone3Color,
    HrZone4Color,
    HrZone5Color
)