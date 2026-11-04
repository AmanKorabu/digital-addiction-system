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

    // Lets the background service reuse this logic without a WebView.
    private Context serviceContext;

    static FocusModePlugin forService(Context context) {
        FocusModePlugin plugin = new FocusModePlugin();
        plugin.serviceContext = context.getApplicationContext();
        return plugin;
    }

    private Context ctx() {
        return serviceContext != null ? serviceContext : getContext();
    }

    private static final String TAG = "FocusModePlugin";
    private static final int ICON_SIZE = 72;
    private static final long MIN_SESSION_MS = 60L * 1000L;
    private static final long MAX_SESSION_MS = 24L * 60L * 60L * 1000L;
    private static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";

    /** True while the running session was started by the admin (parent). */
    private static final String KEY_ADMIN_CONTROLLED = "adminControlled";

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

            ctx().startActivity(intent);

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
                    ctx().getContentResolver(),
                    Settings.Secure.ACCESSIBILITY_ENABLED,
                    0
            );

            if (enabled != 1) {
                return false;
            }

            String enabledServices = Settings.Secure.getString(
                    ctx().getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );

            if (enabledServices == null || enabledServices.isEmpty()) {
                return false;
            }

            ComponentName expected = new ComponentName(
                    ctx(),
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
                    Uri.parse("package:" + ctx().getPackageName())
            );

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx().startActivity(intent);

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
            ctx().startActivity(intent);

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
                || Settings.canDrawOverlays(ctx());
    }

    @SuppressWarnings("deprecation")
    private boolean isUsageAccessGranted() {
        Context context = ctx();

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

        return ContextCompat.checkSelfPermission(ctx(), POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (serviceContext != null || getActivity() == null || isNotificationPermissionGranted()) {
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

        protectedPackages.add(ctx().getPackageName());
        protectedPackages.add("com.android.phone");
        protectedPackages.add("com.android.dialer");
        protectedPackages.add("com.google.android.dialer");
        protectedPackages.add("com.android.emergency");

        try {
            TelecomManager telecom = (TelecomManager)
                    ctx().getSystemService(Context.TELECOM_SERVICE);

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
            PackageManager pm = ctx().getPackageManager();
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

    /** Session started by the user on this phone. */
    @PluginMethod
    public void startFocusSession(PluginCall call) {
        beginSession(call, false);
    }

    /** Session forced by the admin (parent). The user cannot stop it. */
    @PluginMethod
    public void startAdminFocusSession(PluginCall call) {
        beginSession(call, true);
    }

    private void beginSession(PluginCall call, boolean adminControlled) {
        try {
            normalizeExpiredSession();

            // A user can never replace a running session.
            // An admin can replace any running session.
            if (!adminControlled
                    && prefs().getBoolean(FocusService.KEY_ACTIVE, false)) {
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
                        adminControlled
                                ? "Accessibility is turned off on the child's phone, "
                                + "so apps cannot be blocked."
                                : "Turn on Smart Shield in Accessibility settings first, "
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
                    .putBoolean(KEY_ADMIN_CONTROLLED, adminControlled)
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

    /** Stop requested by the user. Refused while an admin session is running. */
    @PluginMethod
    public void stopFocusSession(PluginCall call) {
        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();

            if (prefs.getBoolean(FocusService.KEY_ACTIVE, false)
                    && prefs.getBoolean(KEY_ADMIN_CONTROLLED, false)) {
                call.reject(
                        "This focus session was started by your admin and "
                                + "cannot be stopped here.",
                        "ADMIN_LOCKED"
                );
                return;
            }

            endActiveSession(prefs);
            stopFocusService();

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to stop focus session", error);
            call.reject("Unable to stop focus mode.", error);
        }
    }

    /** Stop requested by the admin. Stops only an admin-controlled session. */
    @PluginMethod
    public void stopAdminFocusSession(PluginCall call) {
        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();

            boolean stopped = false;

            if (prefs.getBoolean(FocusService.KEY_ACTIVE, false)
                    && prefs.getBoolean(KEY_ADMIN_CONTROLLED, false)) {
                endActiveSession(prefs);
                stopFocusService();
                stopped = true;
            }

            JSObject status = buildStatus();
            status.put("stopped", stopped);

            call.resolve(status);

        } catch (Exception error) {
            Log.e(TAG, "Unable to stop admin focus session", error);
            call.reject("Unable to stop administrator focus mode.", error);
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
        return ctx()
                .getSharedPreferences(FocusService.PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** Marks the running session as stopped early (not completed). */
    private void endActiveSession(SharedPreferences prefs) {
        if (!prefs.getBoolean(FocusService.KEY_ACTIVE, false)) {
            return;
        }

        long end = prefs.getLong(FocusService.KEY_END, 0L);

        prefs.edit()
                .putBoolean(FocusService.KEY_ACTIVE, false)
                .putBoolean(KEY_ADMIN_CONTROLLED, false)
                .putBoolean(FocusService.KEY_COMPLETED, false)
                .putLong(
                        FocusService.KEY_STOPPED_AT,
                        Math.min(System.currentTimeMillis(), end)
                )
                .commit();
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
                    .putBoolean(KEY_ADMIN_CONTROLLED, false)
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

        boolean active = prefs.getBoolean(FocusService.KEY_ACTIVE, false);
        String mode = enforcementMode();

        JSObject status = new JSObject();
        status.put("active", active);

        // Only meaningful while a session is running (a finished session
        // must never keep reporting "admin controlled").
        status.put("adminControlled",
                active && prefs.getBoolean(KEY_ADMIN_CONTROLLED, false));

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
            Intent intent = new Intent(ctx(), FocusService.class);
            ContextCompat.startForegroundService(ctx(), intent);
        } catch (Exception error) {
            Log.e(TAG, "Unable to start focus service", error);
        }
    }

    private void stopFocusService() {
        try {
            ctx().stopService(new Intent(ctx(), FocusService.class));
        } catch (Exception error) {
            Log.w(TAG, "Unable to stop focus service", error);
        }
    }

    // =========================================================
    // BACKGROUND SERVICE ENTRY POINTS (no PluginCall / no WebView)
    // =========================================================

    /** Returns null on success, otherwise a readable error message. */
    String startAdminSessionFromService(JSONArray packageArray, long durationMs) {
        try {
            normalizeExpiredSession();

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
                return "Pick at least one app to block.";
            }

            if (durationMs < MIN_SESSION_MS) {
                return "Choose a session of at least 1 minute.";
            }

            if (durationMs > MAX_SESSION_MS) {
                return "Choose a session of 24 hours or less.";
            }

            if (!isAccessibilityServiceEnabled()) {
                return "Accessibility is turned off on the child's phone, "
                        + "so apps cannot be blocked.";
            }

            long now = System.currentTimeMillis();

            boolean saved = prefs()
                    .edit()
                    .putBoolean(FocusService.KEY_ACTIVE, true)
                    .putBoolean(KEY_ADMIN_CONTROLLED, true)
                    .putLong(FocusService.KEY_START, now)
                    .putLong(FocusService.KEY_END, now + durationMs)
                    .putStringSet(FocusService.KEY_PACKAGES, new HashSet<>(packages))
                    .putInt(FocusService.KEY_ATTEMPTS, 0)
                    .putBoolean(FocusService.KEY_COMPLETED, false)
                    .putLong(FocusService.KEY_STOPPED_AT, 0L)
                    .commit();

            if (!saved) {
                return "Unable to save the focus session.";
            }

            startFocusService();
            return null;

        } catch (Exception error) {
            Log.e(TAG, "Unable to start admin focus from service", error);
            return "Unable to start focus mode: " + error.getMessage();
        }
    }

    /** Stops only an admin-controlled session. Returns null on success. */
    String stopAdminSessionFromService() {
        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();

            if (prefs.getBoolean(FocusService.KEY_ACTIVE, false)
                    && prefs.getBoolean(KEY_ADMIN_CONTROLLED, false)) {
                endActiveSession(prefs);
                stopFocusService();
            }

            return null;

        } catch (Exception error) {
            Log.e(TAG, "Unable to stop admin focus from service", error);
            return "Unable to stop focus mode: " + error.getMessage();
        }
    }

    JSONObject permissionsForService() {
        JSONObject result = new JSONObject();

        try {
            result.put("usageAccess", isUsageAccessGranted());
            result.put("overlay", canDrawOverlays());
        } catch (Exception error) {
            Log.w(TAG, "Could not read permissions", error);
        }

        return result;
    }

    JSONObject focusStateForService() {
        JSONObject result = new JSONObject();

        try {
            normalizeExpiredSession();

            SharedPreferences prefs = prefs();
            boolean active = prefs.getBoolean(FocusService.KEY_ACTIVE, false);
            Set<String> saved = prefs.getStringSet(FocusService.KEY_PACKAGES, null);

            result.put("active", active);
            result.put("adminControlled",
                    active && prefs.getBoolean(KEY_ADMIN_CONTROLLED, false));
            result.put("startTime", prefs.getLong(FocusService.KEY_START, 0L));
            result.put("endTime", prefs.getLong(FocusService.KEY_END, 0L));
            result.put("blockedAttempts", prefs.getInt(FocusService.KEY_ATTEMPTS, 0));
            result.put("packageCount", saved == null ? 0 : saved.size());

        } catch (Exception error) {
            Log.w(TAG, "Could not read focus state", error);
        }

        return result;
    }

    // =========================================================
    // APP ICON (Base64 PNG data URL)
    // =========================================================

    private String getApplicationIconBase64(String packageName) {
        Bitmap bitmap = null;
        ByteArrayOutputStream output = null;

        try {
            PackageManager pm = ctx().getPackageManager();
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