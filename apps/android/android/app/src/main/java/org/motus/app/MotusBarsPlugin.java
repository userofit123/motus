package org.motus.app;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The status bar and the navigation bar take the page's background colour, with dark icons on a light colour and
 * light icons on a dark one (the page tells us whenever the look changes; see theme.ts). Same as Money Manager.
 */
@CapacitorPlugin(name = "MotusBars")
public class MotusBarsPlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        String bg = call.getString("bg");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        int parsed;
        try { parsed = Color.parseColor(bg); } catch (Exception e) { call.reject("Not a colour"); return; }
        final int c = parsed;
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
            WindowInsetsControllerCompat ctl = new WindowInsetsControllerCompat(w, w.getDecorView());
            ctl.setAppearanceLightStatusBars(!dark);
            ctl.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
