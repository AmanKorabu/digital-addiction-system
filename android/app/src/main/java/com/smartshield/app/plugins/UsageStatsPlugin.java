package com.smartshield.app.plugins;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    private static final String TAG = "UsageStatsPlugin";

    private static final long HOUR_MS = 60L * 60L * 1000L;
    private static final long DAY_MS = 24L * HOUR_MS;

    /** Ignore sub-second usage so it does not create empty rows. */
    private static final long MIN_USAGE_MS = 1000L;

    /**
     * Digital Wellbeing counts Smart Shield itself (your 14 minutes).
     * Set to true if you want to hide your own app from the list/total.
     */
    private static final boolean EXCLUDE_OWN_APP = false;

    /** Extra history queried before midnight, only to learn which app was already open. */
    private static final long PRE_MIDNIGHT_LOOKBACK_MS = HOUR_MS;

    private static final String SYSTEM_UI = "com.android.systemui";
    private static final String ANDROID_SETTINGS = "com.android.settings";

    // =========================================================
    // OPEN USAGE ACCESS SETTINGS
    // =========================================================

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            Log.e(TAG, "Unable to open Usage Access settings", error);
            call.reject("Unable to open Usage Access settings.", error);
        }
    }

    // =========================================================
    // CHECK USAGE ACCESS (AppOps based)
    // =========================================================

    @PluginMethod
    public void hasUsageAccess(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("hasAccess", isUsageAccessGranted());
            call.resolve(result);
        } catch (Exception error) {
            Log.e(TAG, "Unable to check Usage Access", error);
            call.reject("Unable to check Usage Access permission.", error);
        }
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

    // =========================================================
    // GET TODAY'S APP USAGE
    // =========================================================

    @PluginMethod
    public void getTodayUsage(PluginCall call) {
        try {
            long startTime = getTodayStartTime();
            long endTime = System.currentTimeMillis();

            Map<String, Long> usageMap = calculateAppUsage(startTime, endTime);

            List<JSONObject> appList = new ArrayList<>();

            for (Map.Entry<String, Long> entry : usageMap.entrySet()) {
                String packageName = entry.getKey();
                long duration = entry.getValue();

                if (duration < MIN_USAGE_MS) {
                    continue;
                }

                JSONObject app = new JSONObject();

                app.put("appName", getApplicationName(packageName));
                app.put("packageName", packageName);
                app.put("appIcon", getApplicationIconBase64(packageName));
                app.put("totalTimeInForeground", duration);
                app.put("formattedUsage", formatDuration(duration));

                appList.add(app);
            }

            // Highest usage first.
            Collections.sort(appList, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject first, JSONObject second) {
                    return Long.compare(
                            second.optLong("totalTimeInForeground", 0L),
                            first.optLong("totalTimeInForeground", 0L)
                    );
                }
            });

            JSONArray appsArray = new JSONArray();

            for (JSONObject app : appList) {
                appsArray.put(app);
            }

            long totalScreenTime = calculateTotalUsage(usageMap);

            JSObject result = new JSObject();
            result.put("apps", appsArray);
            result.put("count", appsArray.length());
            result.put("totalScreenTime", totalScreenTime);
            result.put("formattedScreenTime", formatDuration(totalScreenTime));
            result.put("startTime", startTime);
            result.put("endTime", endTime);

            call.resolve(result);

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve today's app usage", error);
            call.reject("Unable to retrieve application usage.", error);
        }
    }

    // =========================================================
    // GET TODAY'S TOTAL SCREEN TIME
    // =========================================================

    @PluginMethod
    public void getTodayScreenTime(PluginCall call) {
        try {
            long startTime = getTodayStartTime();
            long endTime = System.currentTimeMillis();

            Map<String, Long> usageMap = calculateAppUsage(startTime, endTime);
            long totalScreenTime = calculateTotalUsage(usageMap);

            JSObject result = new JSObject();
            result.put("totalScreenTime", totalScreenTime);
            result.put("formattedScreenTime", formatDuration(totalScreenTime));
            result.put("startTime", startTime);
            result.put("endTime", endTime);

            call.resolve(result);

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve total screen time", error);
            call.reject("Unable to retrieve today's screen time.", error);
        }
    }

    // =========================================================
    // CORE: PER-APP FOREGROUND TIME FOR [startTime, endTime]
    //
    // 1. Rebuild sessions from UsageEvents (exact time ranges, so
    //    midnight clipping is correct), with these safeguards:
    //      - only one app can be in the foreground: when another
    //        app resumes, every other open session is closed
    //      - screen off / keyguard / shutdown close all sessions
    //      - launcher and SystemUI are never counted
    //    These stop a missing PAUSED event from leaving a
    //    session "open" for hours (the cause of 4h on Instagram).
    // 2. Cross-check against the INTERVAL_DAILY aggregate and cap
    //    each app at that figure (never summed, only max'ed).
    // =========================================================

    private Map<String, Long> calculateAppUsage(long startTime, long endTime) {
        Map<String, Long> usageMap = new HashMap<>();

        if (endTime <= startTime) {
            return usageMap;
        }

        try {
            UsageStatsManager manager =
                    (UsageStatsManager) getContext()
                            .getSystemService(Context.USAGE_STATS_SERVICE);

            if (manager == null) {
                return usageMap;
            }

            Set<String> launcherPackages = getLauncherPackages();

            calculateFromEvents(
                    manager, usageMap, launcherPackages, startTime, endTime
            );

            applyDailyAggregateCap(
                    manager, usageMap, launcherPackages, startTime, endTime
            );

        } catch (Exception error) {
            Log.e(TAG, "Failed to calculate app usage", error);
        }

        return usageMap;
    }

    // ---------------------------------------------------------
    // Step 1: event based sessions
    // ---------------------------------------------------------

    private void calculateFromEvents(
            UsageStatsManager manager,
            Map<String, Long> usageMap,
            Set<String> launcherPackages,
            long startTime,
            long endTime
    ) {
        long queryStart = Math.max(0L, startTime - PRE_MIDNIGHT_LOOKBACK_MS);

        UsageEvents events = manager.queryEvents(queryStart, endTime);

        if (events == null) {
            return;
        }

        // package -> resumed activity class names
        Map<String, Set<String>> activeActivities = new HashMap<>();

        // package -> time its current foreground session started
        Map<String, Long> sessionStarts = new HashMap<>();

        UsageEvents.Event event = new UsageEvents.Event();

        while (events.hasNextEvent()) {
            events.getNextEvent(event);

            long eventTime = event.getTimeStamp();
            int eventType = event.getEventType();

            if (eventTime > endTime) {
                continue;
            }

            // Screen off, lock screen, shutdown: nothing is in the foreground.
            if (eventType == UsageEvents.Event.SCREEN_NON_INTERACTIVE
                    || eventType == UsageEvents.Event.KEYGUARD_SHOWN
                    || eventType == UsageEvents.Event.DEVICE_SHUTDOWN) {

                closeAllSessions(
                        usageMap, sessionStarts, launcherPackages,
                        eventTime, startTime, endTime
                );
                activeActivities.clear();
                sessionStarts.clear();
                continue;
            }

            boolean isResumed = eventType == UsageEvents.Event.ACTIVITY_RESUMED;
            boolean isEnded = eventType == UsageEvents.Event.ACTIVITY_PAUSED
                    || eventType == UsageEvents.Event.ACTIVITY_STOPPED;

            if (!isResumed && !isEnded) {
                continue;
            }

            String packageName = event.getPackageName();

            if (packageName == null || packageName.isEmpty()) {
                continue;
            }

            // SystemUI overlays must not interrupt the app underneath.
            if (SYSTEM_UI.equals(packageName)) {
                continue;
            }

            String className = event.getClassName();

            if (className == null || className.isEmpty()) {
                className = packageName;
            }

            if (isResumed) {
                // A different app came to the foreground: close all others,
                // even if Android never delivered their PAUSED event.
                closeOtherSessions(
                        usageMap, sessionStarts, activeActivities,
                        launcherPackages, packageName,
                        eventTime, startTime, endTime
                );

                if (isIgnoredPackage(packageName, launcherPackages)) {
                    continue;
                }

                Set<String> activities = activeActivities.get(packageName);

                if (activities == null) {
                    activities = new HashSet<>();
                    activeActivities.put(packageName, activities);
                }

                activities.add(className);

                if (!sessionStarts.containsKey(packageName)) {
                    sessionStarts.put(packageName, eventTime);
                }

            } else {
                Set<String> activities = activeActivities.get(packageName);

                if (activities == null) {
                    continue;
                }

                activities.remove(className);

                if (activities.isEmpty()) {
                    activeActivities.remove(packageName);

                    Long sessionStart = sessionStarts.remove(packageName);

                    if (sessionStart != null) {
                        addClippedUsage(
                                usageMap, launcherPackages, packageName,
                                sessionStart, eventTime, startTime, endTime
                        );
                    }
                }
            }
        }

        // Whatever is still open is in use right now.
        closeAllSessions(
                usageMap, sessionStarts, launcherPackages,
                endTime, startTime, endTime
        );
    }

    // ---------------------------------------------------------
    // Step 2: sanity cap using Android's own daily aggregate
    //
    // queryUsageStats(INTERVAL_DAILY) returns one record per
    // package per daily bucket. Records for the same package are
    // NOT additive across overlapping buckets, so we take the max
    // (never the sum) and only use it as an upper bound.
    // ---------------------------------------------------------

    private void applyDailyAggregateCap(
            UsageStatsManager manager,
            Map<String, Long> usageMap,
            Set<String> launcherPackages,
            long startTime,
            long endTime
    ) {
        List<UsageStats> stats;

        try {
            stats = manager.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY, startTime, endTime
            );
        } catch (Exception error) {
            Log.w(TAG, "Daily aggregate unavailable", error);
            return;
        }

        if (stats == null || stats.isEmpty()) {
            return;
        }

        Map<String, Long> caps = new HashMap<>();

        for (UsageStats stat : stats) {
            if (stat == null) {
                continue;
            }

            String packageName = stat.getPackageName();

            if (packageName == null
                    || isIgnoredPackage(packageName, launcherPackages)) {
                continue;
            }

            // Skip records for apps not used since local midnight.
            if (stat.getLastTimeUsed() < startTime) {
                continue;
            }

            long total = stat.getTotalTimeInForeground();

            if (total <= 0) {
                continue;
            }

            Long existing = caps.get(packageName);

            if (existing == null || total > existing) {
                caps.put(packageName, total);
            }
        }

        for (Map.Entry<String, Long> entry : usageMap.entrySet()) {
            Long cap = caps.get(entry.getKey());

            if (cap != null && cap > 0 && entry.getValue() > cap) {
                entry.setValue(cap);
            }
        }
    }

    // =========================================================
    // SESSION HELPERS
    // =========================================================

    private void closeAllSessions(
            Map<String, Long> usageMap,
            Map<String, Long> sessionStarts,
            Set<String> launcherPackages,
            long sessionEnd,
            long startTime,
            long endTime
    ) {
        for (Map.Entry<String, Long> entry : sessionStarts.entrySet()) {
            addClippedUsage(
                    usageMap, launcherPackages, entry.getKey(),
                    entry.getValue(), sessionEnd, startTime, endTime
            );
        }
    }

    private void closeOtherSessions(
            Map<String, Long> usageMap,
            Map<String, Long> sessionStarts,
            Map<String, Set<String>> activeActivities,
            Set<String> launcherPackages,
            String keepPackage,
            long sessionEnd,
            long startTime,
            long endTime
    ) {
        List<String> openPackages = new ArrayList<>(sessionStarts.keySet());

        for (String openPackage : openPackages) {
            if (openPackage.equals(keepPackage)) {
                continue;
            }

            Long sessionStart = sessionStarts.remove(openPackage);
            activeActivities.remove(openPackage);

            if (sessionStart != null) {
                addClippedUsage(
                        usageMap, launcherPackages, openPackage,
                        sessionStart, sessionEnd, startTime, endTime
                );
            }
        }
    }

    /** Adds the part of a session that falls inside [startTime, endTime]. */
    private void addClippedUsage(
            Map<String, Long> usageMap,
            Set<String> launcherPackages,
            String packageName,
            long sessionStart,
            long sessionEnd,
            long startTime,
            long endTime
    ) {
        if (packageName == null
                || packageName.isEmpty()
                || isIgnoredPackage(packageName, launcherPackages)
                || sessionStart < 0
                || sessionEnd <= sessionStart) {
            return;
        }

        long clippedStart = Math.max(sessionStart, startTime);
        long clippedEnd = Math.min(sessionEnd, endTime);

        if (clippedEnd <= clippedStart) {
            return;
        }

        Long existing = usageMap.get(packageName);
        long current = existing == null ? 0L : existing;

        usageMap.put(packageName, current + (clippedEnd - clippedStart));
    }

    // =========================================================
    // TOTAL (always the sum of the per-app values)
    // =========================================================

    private long calculateTotalUsage(Map<String, Long> usageMap) {
        long total = 0L;

        for (Long duration : usageMap.values()) {
            if (duration != null && duration >= MIN_USAGE_MS) {
                total += duration;
            }
        }

        return total;
    }

    // =========================================================
    // PACKAGE FILTERING
    //
    // Excluded: SystemUI, Android Settings, home launchers, and
    // (optionally) Smart Shield itself. Every other package,
    // including user apps and system apps like Phone/Camera, counts.
    // =========================================================

    private boolean isIgnoredPackage(
            String packageName,
            Set<String> launcherPackages
    ) {
        if (packageName == null || packageName.isEmpty()) {
            return true;
        }

        if (EXCLUDE_OWN_APP && packageName.equals(getContext().getPackageName())) {
            return true;
        }

        if (SYSTEM_UI.equals(packageName) || ANDROID_SETTINGS.equals(packageName)) {
            return true;
        }

        return launcherPackages.contains(packageName);
    }

    /**
     * Home-screen apps only. Needs a <queries> entry for the HOME intent on
     * Android 11+ (see the manifest notes), otherwise this returns an empty set.
     */
    private Set<String> getLauncherPackages() {
        Set<String> launchers = new HashSet<>();

        try {
            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);

            List<ResolveInfo> resolved =
                    getContext()
                            .getPackageManager()
                            .queryIntentActivities(
                                    homeIntent,
                                    PackageManager.MATCH_DEFAULT_ONLY
                            );

            if (resolved != null) {
                for (ResolveInfo info : resolved) {
                    if (info.activityInfo != null
                            && info.activityInfo.packageName != null) {
                        launchers.add(info.activityInfo.packageName);
                    }
                }
            }

        } catch (Exception error) {
            Log.w(TAG, "Could not identify launcher packages", error);
        }

        return launchers;
    }

    // =========================================================
    // APPLICATION NAME
    // =========================================================

    private String getApplicationName(String packageName) {
        try {
            PackageManager pm = getContext().getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(info);

            if (label != null && label.length() > 0) {
                return label.toString();
            }

        } catch (Exception error) {
            Log.w(TAG, "Could not get app name: " + packageName, error);
        }

        return packageName;
    }

    // =========================================================
    // APPLICATION ICON (Base64 PNG data URL)
    // =========================================================

    private String getApplicationIconBase64(String packageName) {
        Bitmap bitmap = null;
        ByteArrayOutputStream output = null;

        try {
            PackageManager pm = getContext().getPackageManager();
            Drawable drawable = pm.getApplicationIcon(packageName);

            int size = 96;

            bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);

            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, size, size);
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

    // =========================================================
    // TODAY'S LOCAL MIDNIGHT
    // =========================================================

    private long getTodayStartTime() {
        Calendar calendar = Calendar.getInstance();

        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);

        return calendar.getTimeInMillis();
    }

    // =========================================================
    // FORMAT DURATION (milliseconds -> "1h 5m", "47m", "<1m")
    // =========================================================

    private String formatDuration(long milliseconds) {
        long totalMinutes = milliseconds / 60000L;

        long hours = totalMinutes / 60L;
        long minutes = totalMinutes % 60L;

        if (hours > 0 && minutes > 0) {
            return hours + "h " + minutes + "m";
        }

        if (hours > 0) {
            return hours + "h";
        }

        if (minutes > 0) {
            return minutes + "m";
        }

        return "<1m";
    }
}