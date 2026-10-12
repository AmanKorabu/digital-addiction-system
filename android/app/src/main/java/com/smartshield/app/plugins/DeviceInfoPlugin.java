package com.smartshield.app.plugins;

import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {

        try {
            String deviceId = Settings.Secure.getString(
                    getContext().getContentResolver(),
                    Settings.Secure.ANDROID_ID
            );

           String model = Build.MODEL;
            String manufacturer = Build.MANUFACTURER;
            String androidVersion = Build.VERSION.RELEASE;

            String deviceName = Settings.Global.getString(
                getContext().getContentResolver(),
                "device_name"
            );

            if (deviceName == null || deviceName.trim().isEmpty()) {
                deviceName = model;
            }
            JSObject result = new JSObject();

            result.put("deviceId", deviceId);
            result.put("deviceName", deviceName);
            result.put("platform", "Android");
            result.put("model", model);
            result.put("manufacturer", manufacturer);
            result.put("androidVersion", androidVersion);

            call.resolve(result);

        } catch (Exception error) {

            call.reject(
                    "Unable to retrieve device information.",
                    error
            );
        }
    }
}