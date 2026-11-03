package com.smartshield.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.smartshield.app.plugins.DeviceInfoPlugin;
import com.smartshield.app.plugins.UsageStatsPlugin;
import com.smartshield.app.plugins.FocusModePlugin;
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {

        registerPlugin(DeviceInfoPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(FocusModePlugin.class);


        super.onCreate(savedInstanceState);
    }
}