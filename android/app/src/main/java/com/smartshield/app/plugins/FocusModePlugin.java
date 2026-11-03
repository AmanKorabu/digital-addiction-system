package com.smartshield.app.plugins;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.ComponentName;
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
import android.telecom.TelecomManager;
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
    private static final long MAX_SESSION_MS = 24L * 60L * 60L * 1000L;
    private static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";

    // =========================================================
    // ACCESSIBILITY (the main enforcement mechanism)
    // =========================================================

    /**
     * granted   = the user switched Smart Shield on in Accessibility settings.
     * connected = Android has the service running right now.
     * Real enforcement needs both; "granted" can be true for a moment
     * before "connected" after the app starts.
     */
    @PluginMethod
    public void hasAccessibilityPermission(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("granted", isAccessibilityServiceEnabled());
            result.put("connected", FocusAccessibilityService.connected);
            call.resolve(result);

        } catch (Exception error) {
            Log.e(TAG, "Accessibility permission check failed", error);
            call.reject("Unable to check Accessibility permission.", error);
        }
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {
            Log.e(TAG, "Unable to open Accessibility settings", error);
            call.reject("Unable to open Accessibility settings.", error);
        }
    }

    /** True when Smart Shield's accessibility service is switched on in Settings. */
    private boolean isAccessibilityServiceEnabled() {
        if (FocusAccessibilityService.connected) {
            return true;
        }

        try {
            int enabled = Settings.Secure.getInt(
                    getContext().getContentResolver(),
                    Settings.Secure.ACCESSIBILITY_ENABLED,
                    0
            );

            if (enabled != 1) {
                return false;
            }

            String enabledServices = Settings.Secure.getString(
                    getContext().getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );

            if (enabledServices == null || enabledServices.isEmpty()) {
                return false;
            }

            ComponentName expected = new ComponentName(
                    getContext(),
                    FocusAccessibilityService.class
            );

            // Compare parsed components, because some phones store the short
            // form (".plugins.X") and others the full class name.
            for (String entry : enabledServices.split(":")) {
                ComponentName component = ComponentName.unflattenFromString(entry);

                if (component != null && component.equals(expected)) {
                    return true;
                }
            }

        } catch (Exception error) {
            Log.w(TAG, "Could not read enabled accessibility services", error);
        }

        return false;
    }

    /**
     * "accessibility" = reliable blocking is running
     * "limited"       = only the older overlay fallback is possible
     * "none"          = nothing can block apps right now
     */
    private String enforcementMode() {
        if (FocusAccessibilityService.connected) {
            return "accessibility";
        }

        if (canDrawOverlays() && isUsageAccessGranted()) {
            return "limited";
        }

        return "none";
    }

    // =========================================================
    // OTHER PERMISSIONS
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

    @PluginMethod
    public void hasUsageAccessPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isUsageAccessGranted());
        call.resolve(result);
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {
            Log.e(TAG, "Unable to open usage access settings", error);
            call.reject("Unable to open usage access settings.", error);
        }
    }

    /** One call for the permission screen: everything the session needs. */
    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("accessibility", isAccessibilityServiceEnabled());
        result.put("accessibilityConnected", FocusAccessibilityService.connected);
        result.put("overlay", canDrawOverlays());
        result.put("usageAccess", isUsageAccessGranted());
        result.put("notifications", isNotificationPermissionGranted());
        call.resolve(result);
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

    private boolean isNotificationPermissionGranted() {
        if (Build.VERSION.SDK_INT < 33) {
            return true;
        }

        return ContextCompat.checkSelfPermission(getContext(), POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (getActivity() == null || isNotificationPermissionGranted()) {
            return;
        }

        ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{POST_NOTIFICATIONS},
                4101
        );
    }

    // =========================================================
    // APPS THAT MUST NEVER BE BLOCKED
    // =========================================================

    /**
     * Safety net for a wellbeing app: the user must always be able to make
     * calls (including emergency calls). Add more packages here if needed.
     */
    private Set<String> getProtectedPackages() {
        Set<String> protectedPackages = new HashSet<>();

        protectedPackages.add(getContext().getPackageName());
        protectedPackages.add("com.android.phone");
        protectedPackages.add("com.android.dialer");
        protectedPackages.add("com.google.android.dialer");
        protectedPackages.add("com.android.emergency");

        try {
            TelecomManager telecom = (TelecomManager)
                    getContext().getSystemService(Context.TELECOM_SERVICE);

            if (telecom != null) {
                String dialer = telecom.getDefaultDialerPackage();

                if (dialer != null) {
                    protectedPackages.add(dialer);
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "Could not resolve default dialer", error);
        }

        return protectedPackages;
    }

    // =========================================================
    // APP LIST FOR THE PICKER
    // =========================================================

    /**
     * NOTE: on Android 11+ this only sees launcher apps if the manifest has a
     * <queries> block for ACTION_MAIN / CATEGORY_LAUNCHER and CATEGORY_HOME
     * (or QUERY_ALL_PACKAGES). Without it the list comes back nearly empty.
     */
    @PluginMethod
    public void getLaunchableApps(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            Set<String> protectedPackages = getProtectedPackages();

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
                            || protectedPackages.contains(packageName)
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
            normalizeExpiredSession();

            if (prefs().getBoolean(FocusService.KEY_ACTIVE, false)) {
                call.reject("A focus session is already running.");
                return;
            }

            JSObject data = call.getData();

            long durationMs = data.optLong("durationMs", 0L);
            JSONArray packageArray = data.optJSONArray("packages");

            Set<String> protectedPackages = getProtectedPackages();
            Set<String> packages = new HashSet<>();

            if (packageArray != null) {
                for (int i = 0; i < packageArray.length(); i++) {
                    String packageName = packageArray.optString(i, "");

                    if (!packageName.isEmpty()
                            && !protectedPackages.contains(packageName)) {
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

            if (durationMs > MAX_SESSION_MS) {
                call.reject("Choose a session of 24 hours or less.");
                return;
            }

            // Do not start a session that cannot actually block anything.
            if (!isAccessibilityServiceEnabled()) {
                call.reject(
                        "Turn on Smart Shield in Accessibility settings first, "
                                + "otherwise apps cannot be blocked.",
                        "ACCESSIBILITY_REQUIRED"
                );
                return;
            }

            requestNotificationPermissionIfNeeded();

            long now = System.currentTimeMillis();

            // commit() (not apply()) so the services are guaranteed to read the
            // new session when they start a moment later.
            boolean saved = prefs()
                    .edit()
                    .putBoolean(FocusService.KEY_ACTIVE, true)
                    .putLong(FocusService.KEY_START, now)
                    .putLong(FocusService.KEY_END, now + durationMs)
                    .putStringSet(FocusService.KEY_PACKAGES, new HashSet<>(packages))
                    .putInt(FocusService.KEY_ATTEMPTS, 0)
                    .putBoolean(FocusService.KEY_COMPLETED, false)
                    .putLong(FocusService.KEY_STOPPED_AT, 0L)
                    .commit();

            if (!saved) {
                call.reject("Unable to save the focus session.");
                return;
            }

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
                        .commit();
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
                    .commit();

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

        String mode = enforcementMode();

        JSObject status = new JSObject();
        status.put("active", prefs.getBoolean(FocusService.KEY_ACTIVE, false));
        status.put("startTime", prefs.getLong(FocusService.KEY_START, 0L));
        status.put("endTime", prefs.getLong(FocusService.KEY_END, 0L));
        status.put("packages", packages);
        status.put("blockedAttempts", prefs.getInt(FocusService.KEY_ATTEMPTS, 0));
        status.put("completed", prefs.getBoolean(FocusService.KEY_COMPLETED, false));
        status.put("stoppedAt", prefs.getLong(FocusService.KEY_STOPPED_AT, 0L));
        status.put("now", System.currentTimeMillis());

        // Honest enforcement report for the UI.
        status.put("accessibilityEnabled", isAccessibilityServiceEnabled());
        status.put("accessibilityConnected", FocusAccessibilityService.connected);
        status.put("enforcementMode", mode);
        status.put("enforcementReady", "accessibility".equals(mode));

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