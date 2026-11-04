package org.motus.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MotusUpdaterPlugin.class);
        registerPlugin(MotusWorkoutPlugin.class);
        registerPlugin(MotusBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
