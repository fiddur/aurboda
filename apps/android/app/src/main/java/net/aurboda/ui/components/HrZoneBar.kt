package net.aurboda.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import net.aurboda.formatZoneTime

@Composable
fun HrZoneBar(
    zoneIndex: Int,
    bpmRange: String,
    timeSeconds: Double,
    targetMinutes: Int,
    color: Color,
    modifier: Modifier = Modifier
) {
    val progress = if (targetMinutes > 0) {
        (timeSeconds / 60.0 / targetMinutes).coerceIn(0.0, 1.0).toFloat()
    } else {
        0f
    }
    val percentText = if (targetMinutes > 0) {
        "${(progress * 100).toInt()}%"
    } else {
        ""
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Zone $zoneIndex ($bpmRange)",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = formatZoneTime(timeSeconds),
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .weight(1f)
                    .height(8.dp),
                color = color,
                trackColor = color.copy(alpha = 0.2f),
                strokeCap = StrokeCap.Round
            )
            Text(
                text = percentText,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .width(36.dp)
                    .padding(start = 4.dp)
            )
        }
    }
}
