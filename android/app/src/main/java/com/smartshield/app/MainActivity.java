package com.smartshield.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.smartshield.app.plugins.DeviceInfoPlugin;
import com.smartshield.app.plugins.UsageStatsPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {

        registerPlugin(DeviceInfoPlugin.class);
        registerPlugin(UsageStatsPlugin.class);

        super.onCreate(savedInstanceState);
    }
}