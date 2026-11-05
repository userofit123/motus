package org.motus.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page runs behind clear status and navigation bars, so its background (with the look's glow at the top)
 * continues under the clock, the same as Money Manager. A flat bar colour can't do that: it would always be the
 * page's plain base colour, darker than the glowing top. The page pads itself by the bars' heights, which we hand
 * it as --nst / --nsb (see tokens.css), because older WebViews report no safe-area insets.
 * The clock and icons switch between dark and light with the look (the page tells us; see theme.ts).
 * Phones before Android 6 can't show dark status-bar icons, so they keep the bars coloured and the page below them.
 */
@CapacitorPlugin(name = "MotusBars")
public class MotusBarsPlugin extends Plugin {
    private static final boolean EDGE = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
    private int top, bottom;

    @Override
    public void load() {
        if (!EDGE) return;
        Window w = getActivity().getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.setStatusBarColor(Color.TRANSPARENT);
        // dark navigation buttons need Android 8; before that the bar keeps a colour (set() below)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { w.setStatusBarContrastEnforced(false); w.setNavigationBarContrastEnforced(false); }
        View web = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean typing = insets.isVisible(WindowInsetsCompat.Type.ime());
            // the keyboard and side bars (landscape) shrink the page itself; the top and bottom bars are the page's to pad
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            int b = typing ? ime.bottom : 0;
            if (lp.leftMargin != bars.left || lp.rightMargin != bars.right || lp.bottomMargin != b) {
                lp.setMargins(bars.left, 0, bars.right, b);
                v.setLayoutParams(lp);
            }
            float d = v.getResources().getDisplayMetrics().density;
            int t = Math.round(bars.top / d), bo = typing ? 0 : Math.round(bars.bottom / d);
            if (t != top || bo != bottom) { top = t; bottom = bo; notifyListeners("insets", sizes()); }
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        ViewCompat.requestApplyInsets(web);
    }

    private JSObject sizes() {
        JSObject o = new JSObject();
        o.put("top", top);
        o.put("bottom", bottom);
        return o;
    }

    /** The bars' heights in CSS pixels, for a page that has just loaded. */
    @PluginMethod
    public void insets(PluginCall call) { call.resolve(sizes()); }

    @PluginMethod
    public void set(PluginCall call) {
        String bg = call.getString("bg");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        int parsed;
        try { parsed = Color.parseColor(bg); } catch (Exception e) { call.reject("Not a colour"); return; }
        final int c = parsed;
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (!EDGE) w.setStatusBarColor(c);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) w.setNavigationBarColor(c);
            WindowInsetsControllerCompat ctl = new WindowInsetsControllerCompat(w, w.getDecorView());
            ctl.setAppearanceLightStatusBars(!dark);
            ctl.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
