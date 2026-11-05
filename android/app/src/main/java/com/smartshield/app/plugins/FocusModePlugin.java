
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
    private static final String POST_NOTIFICATIONS =
            "android.permission.POST_NOTIFICATIONS";

    private static final String KEY_ADMIN_CONTROLLED = "adminControlled";

    private final java.util.Map<String, String> iconCache =
            new java.util.concurrent.ConcurrentHashMap<>();

    /*
     * Context used when this controller is created by SyncService.
     * A service-created controller is not attached to the Capacitor bridge,
     * so it must never depend on Plugin.getContext().
     */
    private Context serviceContext;

    // =========================================================
    // SERVICE ACCESS
    // =========================================================

    /**
     * Creates a controller that can be used by SyncService without
     * requiring a Capacitor Plugin instance attached to the bridge.
     */
    public static FocusModePlugin forService(Context context) {
        FocusModePlugin plugin = new FocusModePlugin();
        plugin.serviceContext = context.getApplicationContext();
        return plugin;
    }

    /**
     * Returns the application context for service operations,
     * or the Capacitor context when called from the app.
     */
    private Context appContext() {
        if (serviceContext != null) {
            return serviceContext;
        }

        return getContext();
    }

    // =========================================================
    // ACCESSIBILITY
    // =========================================================

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
            Intent intent =
                    new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            appContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {
            Log.e(TAG, "Unable to open Accessibility settings", error);
            call.reject("Unable to open Accessibility settings.", error);
        }
    }

    private boolean isAccessibilityServiceEnabled() {

        if (FocusAccessibilityService.connected) {
            return true;
        }

        try {
            int enabled = Settings.Secure.getInt(
                    appContext().getContentResolver(),
                    Settings.Secure.ACCESSIBILITY_ENABLED,
                    0
            );

            if (enabled != 1) {
                return false;
            }

            String enabledServices = Settings.Secure.getString(
                    appContext().getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );

            if (enabledServices == null || enabledServices.isEmpty()) {
                return false;
            }

            ComponentName expected = new ComponentName(
                    appContext(),
                    FocusAccessibilityService.class
            );

            for (String entry : enabledServices.split(":")) {

                ComponentName component =
                        ComponentName.unflattenFromString(entry);

                if (component != null && component.equals(expected)) {
                    return true;
                }
            }

        } catch (Exception error) {
            Log.w(TAG, "Could not read enabled accessibility services", error);
        }

        return false;
    }

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
                    Uri.parse("package:" + appContext().getPackageName())
            );

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            appContext().startActivity(intent);

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
            Intent intent =
                    new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            appContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {
            Log.e(TAG, "Unable to open usage access settings", error);
            call.reject("Unable to open usage access settings.", error);
        }
    }

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();

        result.put("accessibility", isAccessibilityServiceEnabled());
        result.put("accessibilityConnected",
                FocusAccessibilityService.connected);
        result.put("overlay", canDrawOverlays());
        result.put("usageAccess", isUsageAccessGranted());
        result.put("notifications", isNotificationPermissionGranted());

        call.resolve(result);
    }

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(appContext());
    }

    @SuppressWarnings("deprecation")
    private boolean isUsageAccessGranted() {

        Context context = appContext();

        AppOpsManager appOps =
                (AppOpsManager) context.getSystemService(
                        Context.APP_OPS_SERVICE
                );

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

        return ContextCompat.checkSelfPermission(
                appContext(),
                POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * This method is only called from the Capacitor UI flow.
     * Do not call it from SyncService.
     */
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
    // SERVICE PERMISSION STATUS
    // =========================================================

    /**
     * Used by SyncService to report the device's current permissions.
     */
    public JSONObject permissionsForService() {

        try {
            return new JSONObject()
                    .put("accessibility", isAccessibilityServiceEnabled())
                    .put("accessibilityConnected",
                            FocusAccessibilityService.connected)
                    .put("overlay", canDrawOverlays())
                    .put("usageAccess", isUsageAccessGranted())
                    .put("notifications", isNotificationPermissionGranted());

        } catch (Exception error) {
            Log.e(TAG, "Unable to read service permissions", error);
            return new JSONObject();
        }
    }

    // =========================================================
    // PROTECTED APPLICATIONS
    // =========================================================

    private Set<String> getProtectedPackages() {

        Set<String> protectedPackages = new HashSet<>();

        protectedPackages.add(appContext().getPackageName());
        protectedPackages.add("com.android.phone");
        protectedPackages.add("com.android.dialer");
        protectedPackages.add("com.google.android.dialer");
        protectedPackages.add("com.android.emergency");

        try {
            TelecomManager telecom = (TelecomManager)
                    appContext().getSystemService(Context.TELECOM_SERVICE);

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
    // APP LIST
    // =========================================================

    @PluginMethod
    public void getLaunchableApps(PluginCall call) {

        try {
            PackageManager pm = appContext().getPackageManager();

            Set<String> protectedPackages = getProtectedPackages();

            Set<String> wanted = null;

            JSONArray wantedArray =
                    call.getData().optJSONArray("packages");

            if (wantedArray != null && wantedArray.length() > 0) {

                wanted = new HashSet<>();

                for (int i = 0; i < wantedArray.length(); i++) {

                    String wantedName = wantedArray.optString(i, "");

                    if (!wantedName.isEmpty()) {
                        wanted.add(wantedName);
                    }
                }
            }

            Boolean iconsFlag = call.getBoolean("includeIcons", true);
            boolean includeIcons = iconsFlag == null || iconsFlag;

            Set<String> homePackages = new HashSet<>();

            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);

            List<ResolveInfo> homes =
                    pm.queryIntentActivities(homeIntent, 0);

            if (homes != null) {
                for (ResolveInfo info : homes) {
                    if (info.activityInfo != null) {
                        homePackages.add(info.activityInfo.packageName);
                    }
                }
            }

            Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
            launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);

            List<ResolveInfo> resolved =
                    pm.queryIntentActivities(launcherIntent, 0);

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
                            || (wanted != null && !wanted.contains(packageName))
                            || !seen.add(packageName)) {
                        continue;
                    }

                    CharSequence label = info.loadLabel(pm);

                    JSONObject app = new JSONObject();

                    app.put(
                            "appName",
                            label != null ? label.toString() : packageName
                    );

                    app.put("packageName", packageName);

                    app.put(
                            "appIcon",
                            includeIcons
                                    ? getApplicationIconBase64(packageName)
                                    : ""
                    );

                    appList.add(app);
                }
            }

            Collections.sort(
                    appList,
                    new Comparator<JSONObject>() {
                        @Override
                        public int compare(
                                JSONObject first,
                                JSONObject second
                        ) {
                            return first.optString("appName", "")
                                    .compareToIgnoreCase(
                                            second.optString("appName", "")
                                    );
                        }
                    }
            );

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
        beginSession(call, false);
    }

    @PluginMethod
    public void startAdminFocusSession(PluginCall call) {
        beginSession(call, true);
    }

    private void beginSession(
            PluginCall call,
            boolean adminControlled
    ) {

        try {
            normalizeExpiredSession();

            if (!adminControlled
                    && prefs().getBoolean(
                            FocusService.KEY_ACTIVE,
                            false
                    )) {

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

            boolean saved = prefs()
                    .edit()
                    .putBoolean(FocusService.KEY_ACTIVE, true)
                    .putBoolean(KEY_ADMIN_CONTROLLED, adminControlled)
                    .putLong(FocusService.KEY_START, now)
                    .putLong(FocusService.KEY_END, now + durationMs)
                    .putStringSet(
                            FocusService.KEY_PACKAGES,
                            new HashSet<>(packages)
                    )
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

    // =========================================================
    // ADMIN SESSION FROM SYNCSERVICE
    // =========================================================

    /**
     * Starts an administrator-controlled session from SyncService.
     *
     * Returns null on success, or an error message on failure.
     */
    public String startAdminSessionFromService(
            JSONArray packageArray,
            long durationMs
    ) {

        try {
            normalizeExpiredSession();

            if (packageArray == null || packageArray.length() == 0) {
                return "Select at least one application.";
            }

            if (durationMs < MIN_SESSION_MS
                    || durationMs > MAX_SESSION_MS) {

                return "Duration must be between 1 minute and 24 hours.";
            }

            if (!isAccessibilityServiceEnabled()) {

                return "Accessibility is turned off on the child's phone. "
                        + "Apps cannot be blocked.";
            }

            Set<String> protectedPackages = getProtectedPackages();
            Set<String> packages = new HashSet<>();

            for (int i = 0; i < packageArray.length(); i++) {

                String packageName = packageArray.optString(i, "");

                if (!packageName.isEmpty()
                        && !protectedPackages.contains(packageName)) {

                    packages.add(packageName);
                }
            }

            if (packages.isEmpty()) {
                return "No valid applications were selected.";
            }

            long now = System.currentTimeMillis();

            boolean saved = prefs()
                    .edit()
                    .putBoolean(FocusService.KEY_ACTIVE, true)
                    .putBoolean(KEY_ADMIN_CONTROLLED, true)
                    .putLong(FocusService.KEY_START, now)
                    .putLong(FocusService.KEY_END, now + durationMs)
                    .putStringSet(
                            FocusService.KEY_PACKAGES,
                            new HashSet<>(packages)
                    )
                    .putInt(FocusService.KEY_ATTEMPTS, 0)
                    .putBoolean(FocusService.KEY_COMPLETED, false)
                    .putLong(FocusService.KEY_STOPPED_AT, 0L)
                    .commit();

            if (!saved) {
                return "Unable to save the administrator focus session.";
            }

            startFocusService();

            Log.i(TAG, "Administrator Focus Mode started successfully.");

            return null;

        } catch (Exception error) {

            Log.e(TAG, "Unable to start admin focus session", error);

            return error.getMessage() != null
                    ? error.getMessage()
                    : "Unable to start administrator Focus Mode.";
        }
    }

    /**
     * Stops only an administrator-controlled session.
     *
     * Returns null on success, or an error message on failure.
     */
    public String stopAdminSessionFromService() {

        try {
            normalizeExpiredSession();

            SharedPreferences preferences = prefs();

            boolean active = preferences.getBoolean(
                    FocusService.KEY_ACTIVE,
                    false
            );

            boolean adminControlled = preferences.getBoolean(
                    KEY_ADMIN_CONTROLLED,
                    false
            );

            if (active && adminControlled) {

                endActiveSession(preferences);
                stopFocusService();

                Log.i(TAG, "Administrator Focus Mode stopped.");
            }

            return null;

        } catch (Exception error) {

            Log.e(TAG, "Unable to stop admin focus session", error);

            return error.getMessage() != null
                    ? error.getMessage()
                    : "Unable to stop administrator Focus Mode.";
        }
    }

    // =========================================================
    // STOP SESSION FROM CAPACITOR
    // =========================================================

    @PluginMethod
    public void stopFocusSession(PluginCall call) {

        try {
            normalizeExpiredSession();

            SharedPreferences preferences = prefs();

            if (preferences.getBoolean(
                    FocusService.KEY_ACTIVE,
                    false
            ) && preferences.getBoolean(
                    KEY_ADMIN_CONTROLLED,
                    false
            )) {

                call.reject(
                        "This focus session was started by your admin and "
                                + "cannot be stopped here.",
                        "ADMIN_LOCKED"
                );

                return;
            }

            endActiveSession(preferences);
            stopFocusService();

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to stop focus session", error);
            call.reject("Unable to stop focus mode.", error);
        }
    }

    @PluginMethod
    public void stopAdminFocusSession(PluginCall call) {

        try {
            normalizeExpiredSession();

            SharedPreferences preferences = prefs();

            boolean stopped = false;

            if (preferences.getBoolean(
                    FocusService.KEY_ACTIVE,
                    false
            ) && preferences.getBoolean(
                    KEY_ADMIN_CONTROLLED,
                    false
            )) {

                endActiveSession(preferences);
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

    // =========================================================
    // FOCUS STATUS
    // =========================================================

    @PluginMethod
    public void getFocusStatus(PluginCall call) {

        try {
            normalizeExpiredSession();

            SharedPreferences preferences = prefs();

            if (preferences.getBoolean(
                    FocusService.KEY_ACTIVE,
                    false
            ) && !FocusService.running) {

                startFocusService();
            }

            call.resolve(buildStatus());

        } catch (Exception error) {
            Log.e(TAG, "Unable to read focus status", error);
            call.reject("Unable to read focus status.", error);
        }
    }

    /**
     * Used by SyncService to retrieve focus status.
     */
    public JSONObject focusStateForService() {

        try {
            normalizeExpiredSession();

            SharedPreferences preferences = prefs();

            if (preferences.getBoolean(
                    FocusService.KEY_ACTIVE,
                    false
            ) && !FocusService.running) {

                startFocusService();
            }

            return new JSONObject(buildStatus().toString());

        } catch (Exception error) {

            Log.e(TAG, "Unable to read service focus state", error);

            return new JSONObject();
        }
    }

    // =========================================================
    // INTERNAL SESSION MANAGEMENT
    // =========================================================

    private SharedPreferences prefs() {

        return appContext().getSharedPreferences(
                FocusService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
    }

    private void endActiveSession(SharedPreferences preferences) {

        if (!preferences.getBoolean(
                FocusService.KEY_ACTIVE,
                false
        )) {
            return;
        }

        long end = preferences.getLong(
                FocusService.KEY_END,
                0L
        );

        preferences.edit()
                .putBoolean(FocusService.KEY_ACTIVE, false)
                .putBoolean(KEY_ADMIN_CONTROLLED, false)
                .putBoolean(FocusService.KEY_COMPLETED, false)
                .putLong(
                        FocusService.KEY_STOPPED_AT,
                        Math.min(System.currentTimeMillis(), end)
                )
                .commit();
    }

    private void normalizeExpiredSession() {

        SharedPreferences preferences = prefs();

        if (!preferences.getBoolean(
                FocusService.KEY_ACTIVE,
                false
        )) {
            return;
        }

        long end = preferences.getLong(
                FocusService.KEY_END,
                0L
        );

        if (System.currentTimeMillis() >= end) {

            preferences.edit()
                    .putBoolean(FocusService.KEY_ACTIVE, false)
                    .putBoolean(KEY_ADMIN_CONTROLLED, false)
                    .putBoolean(FocusService.KEY_COMPLETED, true)
                    .putLong(FocusService.KEY_STOPPED_AT, end)
                    .commit();

            stopFocusService();
        }
    }

    // =========================================================
    // BUILD FOCUS STATUS
    // =========================================================

    private JSObject buildStatus() {

        SharedPreferences preferences = prefs();

        JSArray packages = new JSArray();

        Set<String> saved = preferences.getStringSet(
                FocusService.KEY_PACKAGES,
                null
        );

        if (saved != null) {

            for (String packageName : saved) {
                packages.put(packageName);
            }
        }

        boolean active = preferences.getBoolean(
                FocusService.KEY_ACTIVE,
                false
        );

        String mode = enforcementMode();

        JSObject status = new JSObject();

        status.put("active", active);

        status.put(
                "adminControlled",
                active && preferences.getBoolean(
                        KEY_ADMIN_CONTROLLED,
                        false
                )
        );

        status.put(
                "startTime",
                preferences.getLong(FocusService.KEY_START, 0L)
        );

        status.put(
                "endTime",
                preferences.getLong(FocusService.KEY_END, 0L)
        );

        status.put("packages", packages);
        status.put("packageCount", packages.length());

        status.put(
                "blockedAttempts",
                preferences.getInt(FocusService.KEY_ATTEMPTS, 0)
        );

        status.put(
                "completed",
                preferences.getBoolean(FocusService.KEY_COMPLETED, false)
        );

        status.put(
                "stoppedAt",
                preferences.getLong(FocusService.KEY_STOPPED_AT, 0L)
        );

        status.put("now", System.currentTimeMillis());

        status.put(
                "accessibilityEnabled",
                isAccessibilityServiceEnabled()
        );

        status.put(
                "accessibilityConnected",
                FocusAccessibilityService.connected
        );

        status.put("enforcementMode", mode);

        status.put(
                "enforcementReady",
                "accessibility".equals(mode)
        );

        return status;
    }

    // =========================================================
    // START / STOP FOCUS SERVICE
    // =========================================================

    private void startFocusService() {

        try {
            Context context = appContext();

            Intent intent = new Intent(
                    context,
                    FocusService.class
            );

            ContextCompat.startForegroundService(context, intent);

        } catch (Exception error) {
            Log.e(TAG, "Unable to start focus service", error);
        }
    }

    private void stopFocusService() {

        try {
            Context context = appContext();

            context.stopService(
                    new Intent(context, FocusService.class)
            );

        } catch (Exception error) {
            Log.w(TAG, "Unable to stop focus service", error);
        }
    }

    // =========================================================
    // APP ICON - BASE64 PNG
    // =========================================================

    private String getApplicationIconBase64(String packageName) {

        String cached = iconCache.get(packageName);

        if (cached != null) {
            return cached;
        }

        Bitmap bitmap = null;
        ByteArrayOutputStream output = null;

        try {
            PackageManager pm = appContext().getPackageManager();

            Drawable drawable = pm.getApplicationIcon(packageName);

            bitmap = Bitmap.createBitmap(
                    ICON_SIZE,
                    ICON_SIZE,
                    Bitmap.Config.ARGB_8888
            );

            Canvas canvas = new Canvas(bitmap);

            drawable.setBounds(
                    0,
                    0,
                    ICON_SIZE,
                    ICON_SIZE
            );

            drawable.draw(canvas);

            output = new ByteArrayOutputStream();

            bitmap.compress(
                    Bitmap.CompressFormat.PNG,
                    100,
                    output
            );

            String icon = "data:image/png;base64,"
                    + Base64.encodeToString(
                            output.toByteArray(),
                            Base64.NO_WRAP
                    );

            iconCache.put(packageName, icon);

            return icon;

        } catch (Exception error) {

            Log.w(
                    TAG,
                    "Could not get app icon: " + packageName,
                    error
            );

            return "";

        } finally {

            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }

            if (output != null) {

                try {
                    output.close();

                } catch (Exception ignored) {
                    // Nothing to do.
                }
            }
        }
    }
}
