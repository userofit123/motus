package org.motus.app

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/**
 * Health Connect shows this when the person taps "privacy policy" on its permission screen; without such a screen it
 * refuses to ask for permissions at all. Plain text: what Motus reads and where it goes.
 */
class HealthRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setPadding(pad, pad, pad, pad)
            textSize = 16f
            text = "Motus reads steps, sleep, weight, heart rate and exercise sessions from Health Connect to show them " +
                "with your workouts. It only reads, never writes or shares them.\n\n" +
                "With an account on this phone the data stays on this phone. With a server account it is copied to " +
                "your own Motus server, and nowhere else.\n\n" +
                "You can take the permission back any time in Health Connect, or switch Health Connect off in Motus " +
                "under Settings, Features."
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
