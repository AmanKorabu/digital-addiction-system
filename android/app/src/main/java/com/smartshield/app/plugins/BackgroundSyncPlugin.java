package com.smartshield.app.plugins;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundSync")
public class BackgroundSyncPlugin extends Plugin {

    // =========================================================
    // START / STOP
    // =========================================================

    @PluginMethod
    public void start(PluginCall call) {
        String deviceId = call.getString("deviceId", "");
        String projectId = call.getString("projectId", "");
        String apiKey = call.getString("apiKey", "");
        String refreshToken = call.getString("refreshToken", "");

        if (deviceId.isEmpty()
                || projectId.isEmpty()
                || apiKey.isEmpty()
                || refreshToken.isEmpty()) {
            call.reject("deviceId, projectId, apiKey and refreshToken are required.");
            return;
        }

        try {
            Context context = getContext();

            SyncService.prefs(context)
                    .edit()
                    .putBoolean(SyncService.KEY_ENABLED, true)
                    .putString(SyncService.KEY_DEVICE_ID, deviceId)
                    .putString(SyncService.KEY_PROJECT_ID, projectId)
                    .putString(SyncService.KEY_API_KEY, apiKey)
                    .putString(SyncService.KEY_REFRESH_TOKEN, refreshToken)
                    .apply();

            SyncService.start(context);

            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);

        } catch (Exception error) {
            call.reject("Unable to start background sync: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Context context = getContext();

            SyncService.prefs(context)
                    .edit()
                    .putBoolean(SyncService.KEY_ENABLED, false)
                    .remove(SyncService.KEY_REFRESH_TOKEN)
                    .remove(SyncService.KEY_DEVICE_ID)
                    .apply();

            SyncService.stop(context);

            JSObject result = new JSObject();
            result.put("stopped", true);
            call.resolve(result);

        } catch (Exception error) {
            call.reject("Unable to stop background sync: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = SyncService.prefs(getContext());

        JSObject result = new JSObject();
        result.put("enabled", prefs.getBoolean(SyncService.KEY_ENABLED, false));
        result.put("running", SyncService.running);
        result.put("lastAttemptAt", prefs.getLong(SyncService.KEY_LAST_ATTEMPT, 0));
        result.put("lastSuccessAt", prefs.getLong(SyncService.KEY_LAST_SUCCESS, 0));
        result.put("lastError", prefs.getString(SyncService.KEY_LAST_ERROR, ""));
        result.put("lastUsageAt", prefs.getLong(SyncService.KEY_LAST_USAGE, 0));
        result.put("lastCommand", prefs.getString(SyncService.KEY_LAST_COMMAND, ""));
        result.put("unrestricted", isUnrestricted());

        call.resolve(result);
    }

    // =========================================================
    // BATTERY OPTIMIZATION
    // =========================================================

    private boolean isUnrestricted() {
        PowerManager pm =
                (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);

        return pm != null
                && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void isBatteryUnrestricted(PluginCall call) {
        JSObject result = new JSObject();
        result.put("unrestricted", isUnrestricted());
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getContext().getPackageName())
            );

            getActivity().startActivity(intent);

        } catch (Exception first) {
            try {
                getActivity().startActivity(
                        new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                );
            } catch (Exception second) {
                call.reject("Unable to open battery settings.", second);
                return;
            }
        }

        call.resolve();
    }

    // =========================================================
    // AUTO-START (vivo / OPPO / Xiaomi / Huawei / others)
    // =========================================================

    private static final String[][] AUTOSTART_SCREENS = {
            // vivo / iQOO
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.vivo.abe", "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity"},
            // OPPO / Realme / OnePlus (ColorOS)
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            // Xiaomi
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            // Huawei
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
    };

    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        for (String[] screen : AUTOSTART_SCREENS) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(screen[0], screen[1]));
                getActivity().startActivity(intent);

                JSObject result = new JSObject();
                result.put("opened", true);
                result.put("fallback", false);
                call.resolve(result);
                return;

            } catch (Exception ignored) {
                // Try the next known screen.
            }
        }

        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);

            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("fallback", true);
            call.resolve(result);

        } catch (Exception error) {
            call.reject("Unable to open settings.", error);
        }
    }
}