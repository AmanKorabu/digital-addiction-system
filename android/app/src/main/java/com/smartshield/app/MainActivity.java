package com.smartshield.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.smartshield.app.plugins.BackgroundSyncPlugin;
import com.smartshield.app.plugins.DeviceInfoPlugin;
import com.smartshield.app.plugins.FocusModePlugin;
import com.smartshield.app.plugins.UsageStatsPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before super.onCreate().
        registerPlugin(DeviceInfoPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(FocusModePlugin.class);
        registerPlugin(BackgroundSyncPlugin.class);

        super.onCreate(savedInstanceState);
    }
}