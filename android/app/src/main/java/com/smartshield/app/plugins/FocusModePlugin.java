package com.smartshield.app.plugins;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "FocusMode")
public class FocusModePlugin extends Plugin {

    private static final String TAG = "FocusModePlugin";
    private static final int ICON_SIZE = 72;
    private static final long MIN_SESSION_MS = 60L * 1000L;

    // =========================================================
    // PERMISSIONS
    // =========================================================

    @PluginMethod
    public void hasOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", canDrawOverlays());
        call.resolve(result);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
            );

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {
            Log.e(TAG, "Unable to open overlay settings", error);
            call.reject("Unable to open overlay permission settings.", error);
        }
    }

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(getContext());
    }

    @SuppressWarnings("deprecation")
    private boolean isUsageAccessGranted() {
        Context context = getContext();

        AppOpsManager appOps =
                (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);

        if (appOps == null) {
            return false;
        }

        int mode;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.getPackageName()
            );
        } else {
            mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.getPackageName()
            );
        }

        if (mode == AppOpsManager.MODE_DEFAULT) {
            return context.checkCallingOrSelfPermission(
                    Manifest.permission.PACKAGE_USAGE_STATS
            ) == PackageManager.PERMISSION_GRANTED;
        }

        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33 || getActivity() == null) {
            return;
        }

        if (ContextCompat.checkSelfPermission(
                getContext(), "android.permission.POST_NOTIFICATIONS"
        ) != PackageManager.PERMISSION_GRANTED) {

            ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{"android.permission.POST_NOTIFICATIONS"},
                    4101
            );
        }
    }

    // =========================================================
    // APP LIST FOR THE PICKER
    // =========================================================

    @PluginMethod
    public void getLaunchableApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String ownPackage = getContext().getPackageName();

            Set<String> homePackages = new HashSet<>();

            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);

            List<ResolveInfo> homes = pm.queryIntentActivities(homeIntent, 0);

            if (homes != null) {
                for (ResolveInfo info : homes) {
                    if (info.activityInfo != null) {
                        homePackages.add(info.activityInfo.packageName);
                    }
                }
            }

            Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
            launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);

            List<ResolveInfo> resolved = pm.queryIntentActivities(launcherIntent, 0);

            Set<String> seen = new HashSet<>();
            List<JSONObject> appList = new ArrayList<>();

            if (resolved != null) {
                for (ResolveInfo info : resolved) {
                    if (info.activityInfo == null) {
                        continue;
                    }

                    String packageName = info.activityInfo.packageName;

                    if (packageName == null
                            || packageName.equals(ownPackage)
                            || homePackages.contains(packageName)
                            || !seen.add(packageName)) {
                        continue;
                    }

                    CharSequence label = info.loadLabel(pm);

                    JSONObject app = new JSONObject();
                    app.put("appName", label != null ? label.toString() : packageName);
                    app.put("packageName", packageName);
                    app.put("appIcon", getApplicationIconBase64(packageName));

                    appList.add(app);
                }
            }

            Collections.sort(appList, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject first, JSONObject second) {
                    return first.optString("appName", "")
                            .compareToIgnoreCase(second.optString("appName", ""));
                }
            });

            JSONArray apps = new JSONArray();

            for (JSONObject app : appList) {
                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("apps", apps);
            result.put("count", apps.length());

            call.resolve(result);

        } catch (Exception error) {
            Log.e(TAG, "Unable to list apps", error);
            call.reject("Unable to load installed apps.", error);
        }
    }

    // =========================================================
    // START / STOP / STATUS
    // =========================================================

    @PluginMethod
    public void startFocusSession(PluginCall call) {
        try {
            JSObject data = call.getData();

            long durationMs = data.optLong("durationMs", 0L);
            JSONArray packageArray = data.optJSONArray("packages");

            Set<String> packages = new HashSet<>();

            if (packageArray != null) {
                for (int i = 0; i < packageArray.length(); i++) {
                    String packageName = packageArray.optString(i, "");

                    if (!packageName.isEmpty()
                            && !packageName.equals(getContext().getPackageName())) {
                        packages.add(packageName);
                    }
                }
            }

            if (packages.isEmpty()) {
                call.reject("Pick at least one app to block.");
                return;
            }

            if (durationMs < MIN_SESSION_MS) {
                call.reject("Choose a session of at least 1 minute.");
                return;
            }

            if (!canDrawOverlays()) {
                call.reject("Allow \"Display over other apps\" for Smart Shield first.");
                return;
            }

            if (!isUsageAccessGranted()) {
                call.reject("Allow Usage Access for Smart Shield first.");
                return;
            }

            requestNotificationPermissionIfNeeded();

            long now = System.currentTimeMillis();

            getContext()
                    .getSharedPreferences(FocusService.PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(FocusService.KEY_ACTIVE, true)
                    .putLong(FocusService.KEY_START, now)
                    .putLong(FocusService.KEY_END, now + durationMs)
                    .putStringSet(FocusService.KEY_PACKAGES, new HashSet<>(packages))
                    .putInt(FocusService.KEY_ATTEMPTS, 0)
                    .putBoolean(FocusService.KEY_COMPLETED, false)
                    .putLong(FocusService.KEY_STOPPED_AT, 0L)
                    .apply();

            startFocusService();

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to start focus session", error);
            call.reject("Unable to start focus mode.", error);
        }
    }

    @PluginMethod
    public void stopFocusSession(PluginCall call) {
        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();

            if (prefs.getBoolean(FocusService.KEY_ACTIVE, false)) {
                long end = prefs.getLong(FocusService.KEY_END, 0L);

                prefs.edit()
                        .putBoolean(FocusService.KEY_ACTIVE, false)
                        .putBoolean(FocusService.KEY_COMPLETED, false)
                        .putLong(
                                FocusService.KEY_STOPPED_AT,
                                Math.min(System.currentTimeMillis(), end)
                        )
                        .apply();
            }

            stopFocusService();

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to stop focus session", error);
            call.reject("Unable to stop focus mode.", error);
        }
    }

    @PluginMethod
    public void getFocusStatus(PluginCall call) {
        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();

            // Self-heal: session is active but the service was killed.
            if (prefs.getBoolean(FocusService.KEY_ACTIVE, false)
                    && !FocusService.running) {
                startFocusService();
            }

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to read focus status", error);
            call.reject("Unable to read focus status.", error);
        }
    }

    // =========================================================
    // INTERNAL
    // =========================================================

    private SharedPreferences prefs() {
        return getContext()
                .getSharedPreferences(FocusService.PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** If the end time has passed, mark the session finished and completed. */
    private void normalizeExpiredSession() {
        SharedPreferences prefs = prefs();

        if (!prefs.getBoolean(FocusService.KEY_ACTIVE, false)) {
            return;
        }

        long end = prefs.getLong(FocusService.KEY_END, 0L);

        if (System.currentTimeMillis() >= end) {
            prefs.edit()
                    .putBoolean(FocusService.KEY_ACTIVE, false)
                    .putBoolean(FocusService.KEY_COMPLETED, true)
                    .putLong(FocusService.KEY_STOPPED_AT, end)
                    .apply();

            stopFocusService();
        }
    }

    private JSObject buildStatus() {
        SharedPreferences prefs = prefs();

        JSArray packages = new JSArray();
        Set<String> saved = prefs.getStringSet(FocusService.KEY_PACKAGES, null);

        if (saved != null) {
            for (String packageName : saved) {
                packages.put(packageName);
            }
        }

        JSObject status = new JSObject();
        status.put("active", prefs.getBoolean(FocusService.KEY_ACTIVE, false));
        status.put("startTime", prefs.getLong(FocusService.KEY_START, 0L));
        status.put("endTime", prefs.getLong(FocusService.KEY_END, 0L));
        status.put("packages", packages);
        status.put("blockedAttempts", prefs.getInt(FocusService.KEY_ATTEMPTS, 0));
        status.put("completed", prefs.getBoolean(FocusService.KEY_COMPLETED, false));
        status.put("stoppedAt", prefs.getLong(FocusService.KEY_STOPPED_AT, 0L));
        status.put("now", System.currentTimeMillis());

        return status;
    }

    private void startFocusService() {
        try {
            Intent intent = new Intent(getContext(), FocusService.class);
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception error) {
            Log.e(TAG, "Unable to start focus service", error);
        }
    }

    private void stopFocusService() {
        try {
            getContext().stopService(new Intent(getContext(), FocusService.class));
        } catch (Exception error) {
            Log.w(TAG, "Unable to stop focus service", error);
        }
    }

    // =========================================================
    // APP ICON (Base64 PNG data URL)
    // =========================================================

    private String getApplicationIconBase64(String packageName) {
        Bitmap bitmap = null;
        ByteArrayOutputStream output = null;

        try {
            PackageManager pm = getContext().getPackageManager();
            Drawable drawable = pm.getApplicationIcon(packageName);

            bitmap = Bitmap.createBitmap(
                    ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888
            );

            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
            drawable.draw(canvas);

            output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);

            return "data:image/png;base64,"
                    + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);

        } catch (Exception error) {
            Log.w(TAG, "Could not get app icon: " + packageName, error);
            return "";

        } finally {
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }

            if (output != null) {
                try {
                    output.close();
                } catch (Exception ignored) {
                    // No action required.
                }
            }
        }
    }
}