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
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    // Lets the background service reuse this logic without a WebView.
    private Context serviceContext;

    static UsageStatsPlugin forService(Context context) {
        UsageStatsPlugin plugin = new UsageStatsPlugin();
        plugin.serviceContext = context.getApplicationContext();
        return plugin;
    }

    private Context ctx() {
        return serviceContext != null ? serviceContext : getContext();
    }

    /**
     * Today's usage (same numbers the app shows) for the background service.
     * Returns null when Usage Access is not granted or reading fails.
     */
    JSONObject summaryForService() {
        try {
            if (!isUsageAccessGranted()) {
                return null;
            }

            long now = System.currentTimeMillis();

            return buildUsageResponse(startOfDay(now), now, false);

        } catch (Exception error) {
            Log.e(TAG, "Unable to build usage summary for service", error);
            return null;
        }
    }

    private static final String TAG = "UsageStatsPlugin";

    private static final long HOUR_MS = 60L * 60L * 1000L;
    private static final long DAY_MS = 24L * HOUR_MS;

    /** Ignore sub-second usage so it does not create empty rows. */
    private static final long MIN_USAGE_MS = 1000L;

    /** Longest custom range getUsageForRange accepts. */
    private static final int MAX_RANGE_DAYS = 31;

    /** Android only keeps detailed usage events for a limited time (about a week). */
    private static final int MAX_HISTORY_DAYS = 7;

    /** Hours counted as "late night" for sleep-disruption detection: 00:00-04:59. */
    private static final int LATE_NIGHT_END_HOUR = 5;

    /**
     * Digital Wellbeing counts Smart Shield itself.
     * Set to true if you want to hide your own app from the list/total.
     */
    private static final boolean EXCLUDE_OWN_APP = false;

    /**
     * Android Settings is excluded from totals. Set to false to count it.
     */
    private static final boolean EXCLUDE_SETTINGS = true;

    /**
     * Extra history queried before the window starts, only to learn which app
     * was already open. Must be long enough to cover an app left open across
     * midnight (screen-off events close sessions, so a long lookback is safe).
     */
    private static final long PRE_WINDOW_LOOKBACK_MS = 12L * HOUR_MS;

    private static final int ICON_SIZE = 96;

    private static final String SYSTEM_UI = "com.android.systemui";
    private static final String ANDROID_SETTINGS = "com.android.settings";

    private final Map<String, String> iconCache = new ConcurrentHashMap<>();

    // =========================================================
    // RESULT HOLDER
    // =========================================================

    private static class Result {
        final Map<String, Long> usage = new HashMap<>();
        final Map<String, Integer> launches = new HashMap<>();
        final long[] hourly = new long[24];
        int unlocks = 0;
        int screenOns = 0;
        long firstActive = -1L;
        long lastActive = -1L;
    }

    // =========================================================
    // OPEN USAGE ACCESS SETTINGS
    // =========================================================

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx().startActivity(intent);
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

    /**
     * Without Usage Access Android returns empty data, which would look like
     * "0 minutes today". Reject with a clear code instead.
     */
    private boolean rejectIfNoAccess(PluginCall call) {
        if (isUsageAccessGranted()) {
            return false;
        }

        call.reject("Usage Access permission is required.", "USAGE_ACCESS_DENIED");
        return true;
    }

    // =========================================================
    // GET TODAY'S APP USAGE
    //
    // Optional input: includeIcons (boolean, default true). Pass false for
    // fast refreshes and background analysis; icons are the slowest part.
    // =========================================================

    @PluginMethod
    public void getTodayUsage(PluginCall call) {
        if (rejectIfNoAccess(call)) {
            return;
        }

        try {
            long startTime = startOfDay(System.currentTimeMillis());
            long endTime = System.currentTimeMillis();

            call.resolve(buildUsageResponse(startTime, endTime, wantsIcons(call)));

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve today's app usage", error);
            call.reject("Unable to retrieve application usage.", error);
        }
    }

    // =========================================================
    // GET USAGE FOR A CUSTOM RANGE
    //
    // Input: startTime, endTime (epoch ms), includeIcons (optional).
    // =========================================================

    @PluginMethod
    public void getUsageForRange(PluginCall call) {
        if (rejectIfNoAccess(call)) {
            return;
        }

        try {
            JSObject data = call.getData();

            long now = System.currentTimeMillis();
            long startTime = data.optLong("startTime", 0L);
            long endTime = Math.min(data.optLong("endTime", now), now);

            if (startTime <= 0L || endTime <= startTime) {
                call.reject("Provide a valid startTime and endTime.");
                return;
            }

            if (endTime - startTime > MAX_RANGE_DAYS * DAY_MS) {
                call.reject("Range cannot exceed " + MAX_RANGE_DAYS + " days.");
                return;
            }

            call.resolve(buildUsageResponse(startTime, endTime, wantsIcons(call)));

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve range usage", error);
            call.reject("Unable to retrieve application usage.", error);
        }
    }

    // =========================================================
    // GET TODAY'S TOTAL SCREEN TIME
    // =========================================================

    @PluginMethod
    public void getTodayScreenTime(PluginCall call) {
        if (rejectIfNoAccess(call)) {
            return;
        }

        try {
            long startTime = startOfDay(System.currentTimeMillis());
            long endTime = System.currentTimeMillis();

            Result result = compute(startTime, endTime);
            long totalScreenTime = calculateTotalUsage(result.usage);

            JSObject response = new JSObject();
            response.put("totalScreenTime", totalScreenTime);
            response.put("formattedScreenTime", formatDuration(totalScreenTime));
            response.put("unlocks", result.unlocks);
            response.put("startTime", startTime);
            response.put("endTime", endTime);

            call.resolve(response);

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve total screen time", error);
            call.reject("Unable to retrieve today's screen time.", error);
        }
    }

    // =========================================================
    // DAILY HISTORY (for trend / addiction analysis)
    //
    // Input: days (1-7, default 7). Returns one entry per local day,
    // oldest first. Android only retains about a week of events.
    // =========================================================

    @PluginMethod
    public void getDailyTotals(PluginCall call) {
        if (rejectIfNoAccess(call)) {
            return;
        }

        try {
            int days = call.getData().optInt("days", MAX_HISTORY_DAYS);
            days = Math.max(1, Math.min(days, MAX_HISTORY_DAYS));

            long now = System.currentTimeMillis();
            JSONArray list = new JSONArray();

            for (int offset = days - 1; offset >= 0; offset--) {
                long dayStart = startOfDayOffset(now, -offset);
                long dayEnd = Math.min(startOfDayOffset(now, -offset + 1), now);

                Result result = compute(dayStart, dayEnd);
                long total = calculateTotalUsage(result.usage);

                JSONObject day = new JSONObject();
                day.put("date", dayStart);
                day.put("totalScreenTime", total);
                day.put("formattedScreenTime", formatDuration(total));
                day.put("unlocks", result.unlocks);
                day.put("screenOns", result.screenOns);
                day.put("lateNightMs", lateNightMs(result.hourly));
                day.put("firstActiveTime", result.firstActive);
                day.put("lastActiveTime", result.lastActive);

                list.put(day);
            }

            JSObject response = new JSObject();
            response.put("days", list);
            response.put("count", list.length());

            call.resolve(response);

        } catch (Exception error) {
            Log.e(TAG, "Unable to retrieve daily totals", error);
            call.reject("Unable to retrieve usage history.", error);
        }
    }

    // =========================================================
    // RESPONSE BUILDER
    // =========================================================

    private boolean wantsIcons(PluginCall call) {
        Boolean value = call.getBoolean("includeIcons", true);
        return value == null || value;
    }

    private JSObject buildUsageResponse(
            long startTime, long endTime, boolean includeIcons
    ) throws Exception {
        Result result = compute(startTime, endTime);

        List<JSONObject> appList = new ArrayList<>();

        for (Map.Entry<String, Long> entry : result.usage.entrySet()) {
            String packageName = entry.getKey();
            long duration = entry.getValue();

            if (duration < MIN_USAGE_MS) {
                continue;
            }

            Integer launches = result.launches.get(packageName);

            JSONObject app = new JSONObject();
            app.put("appName", getApplicationName(packageName));
            app.put("packageName", packageName);
            app.put("appIcon", includeIcons ? getApplicationIconBase64(packageName) : "");
            app.put("totalTimeInForeground", duration);
            app.put("formattedUsage", formatDuration(duration));
            app.put("launchCount", launches == null ? 0 : launches);

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

        JSONArray hourly = new JSONArray();

        for (long value : result.hourly) {
            hourly.put(value);
        }

        long totalScreenTime = calculateTotalUsage(result.usage);

        JSObject response = new JSObject();
        response.put("apps", appsArray);
        response.put("count", appsArray.length());
        response.put("totalScreenTime", totalScreenTime);
        response.put("formattedScreenTime", formatDuration(totalScreenTime));
        response.put("unlocks", result.unlocks);
        response.put("screenOns", result.screenOns);
        response.put("hourlyUsage", hourly);
        response.put("lateNightMs", lateNightMs(result.hourly));
        response.put("firstActiveTime", result.firstActive);
        response.put("lastActiveTime", result.lastActive);
        response.put("startTime", startTime);
        response.put("endTime", endTime);

        return response;
    }

    private long lateNightMs(long[] hourly) {
        long total = 0L;

        for (int hour = 0; hour < LATE_NIGHT_END_HOUR && hour < hourly.length; hour++) {
            total += hourly[hour];
        }

        return total;
    }

    // =========================================================
    // CORE: PER-APP FOREGROUND TIME FOR [startTime, endTime]
    //
    // 1. Rebuild sessions from UsageEvents (exact time ranges, so
    //    window clipping is correct), with these safeguards:
    //      - only one app can be in the foreground: when another
    //        app resumes, every other open session is closed
    //      - screen off / keyguard / shutdown close all sessions
    //      - launcher and SystemUI are never counted
    //    These stop a missing PAUSED event from leaving a
    //    session "open" for hours.
    // 2. For a single local day only, cross-check against the
    //    INTERVAL_DAILY aggregate and cap each app at that figure.
    //    (Never applied to multi-day or mid-day-aligned windows,
    //    where overlapping buckets would cap incorrectly.)
    // =========================================================

    private Result compute(long startTime, long endTime) {
        Result empty = new Result();

        if (endTime <= startTime) {
            return empty;
        }

        try {
            UsageStatsManager manager =
                    (UsageStatsManager) ctx()
                            .getSystemService(Context.USAGE_STATS_SERVICE);

            if (manager == null) {
                return empty;
            }

            Set<String> launcherPackages = getLauncherPackages();

            Calc calc = new Calc(startTime, endTime, launcherPackages);

            UsageEvents events = manager.queryEvents(
                    Math.max(0L, startTime - PRE_WINDOW_LOOKBACK_MS), endTime
            );

            if (events != null) {
                calc.run(events);
            }

            if (isSingleLocalDay(startTime, endTime)) {
                applyDailyAggregateCap(
                        manager, calc.result, launcherPackages, startTime, endTime
                );
            }

            return calc.result;

        } catch (Exception error) {
            Log.e(TAG, "Failed to calculate app usage", error);
            return empty;
        }
    }

    /** Session reconstruction state for one window. */
    private class Calc {
        final long startTime;
        final long endTime;
        final Set<String> launcherPackages;
        final Result result = new Result();

        // package -> resumed activity class names
        final Map<String, Set<String>> activeActivities = new HashMap<>();

        // package -> time its current foreground session started
        final Map<String, Long> sessionStarts = new HashMap<>();

        // Last app that came to the foreground (for launch counting).
        String lastPackage = null;

        Calc(long startTime, long endTime, Set<String> launcherPackages) {
            this.startTime = startTime;
            this.endTime = endTime;
            this.launcherPackages = launcherPackages;
        }

        void run(UsageEvents events) {
            UsageEvents.Event event = new UsageEvents.Event();

            while (events.hasNextEvent()) {
                events.getNextEvent(event);

                long eventTime = event.getTimeStamp();
                int eventType = event.getEventType();

                if (eventTime > endTime) {
                    continue;
                }

                // Pickup signals, counted only inside the window.
                if (eventType == UsageEvents.Event.SCREEN_INTERACTIVE) {
                    if (eventTime >= startTime) {
                        result.screenOns++;
                    }
                    continue;
                }

                if (eventType == UsageEvents.Event.KEYGUARD_HIDDEN) {
                    if (eventTime >= startTime) {
                        result.unlocks++;
                    }
                    continue;
                }

                // Screen off, lock screen, shutdown: nothing is in the foreground.
                if (eventType == UsageEvents.Event.SCREEN_NON_INTERACTIVE
                        || eventType == UsageEvents.Event.KEYGUARD_SHOWN
                        || eventType == UsageEvents.Event.DEVICE_SHUTDOWN) {

                    closeAll(eventTime);
                    activeActivities.clear();
                    sessionStarts.clear();
                    lastPackage = null;
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
                    closeOthers(packageName, eventTime);

                    boolean newLaunch = !packageName.equals(lastPackage);
                    lastPackage = packageName;

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

                    // Moving between screens inside one app is not a new launch.
                    if (newLaunch && eventTime >= startTime) {
                        Integer count = result.launches.get(packageName);
                        result.launches.put(packageName, count == null ? 1 : count + 1);
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
                            addUsage(packageName, sessionStart, eventTime);
                        }
                    }
                }
            }

            // Whatever is still open is in use right now.
            closeAll(endTime);
        }

        void closeAll(long sessionEnd) {
            for (Map.Entry<String, Long> entry : sessionStarts.entrySet()) {
                addUsage(entry.getKey(), entry.getValue(), sessionEnd);
            }
        }

        void closeOthers(String keepPackage, long sessionEnd) {
            List<String> openPackages = new ArrayList<>(sessionStarts.keySet());

            for (String openPackage : openPackages) {
                if (openPackage.equals(keepPackage)) {
                    continue;
                }

                Long sessionStart = sessionStarts.remove(openPackage);
                activeActivities.remove(openPackage);

                if (sessionStart != null) {
                    addUsage(openPackage, sessionStart, sessionEnd);
                }
            }
        }

        /** Adds the part of a session that falls inside [startTime, endTime]. */
        void addUsage(String packageName, long sessionStart, long sessionEnd) {
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

            Long existing = result.usage.get(packageName);
            long current = existing == null ? 0L : existing;

            result.usage.put(packageName, current + (clippedEnd - clippedStart));

            addHourly(result.hourly, clippedStart, clippedEnd);

            if (result.firstActive < 0 || clippedStart < result.firstActive) {
                result.firstActive = clippedStart;
            }

            if (clippedEnd > result.lastActive) {
                result.lastActive = clippedEnd;
            }
        }
    }

    /** Splits [from, to) across local clock hours and adds to hour-of-day buckets. */
    private void addHourly(long[] hourly, long from, long to) {
        Calendar calendar = Calendar.getInstance();
        long cursor = from;

        while (cursor < to) {
            calendar.setTimeInMillis(cursor);

            int hour = calendar.get(Calendar.HOUR_OF_DAY);

            calendar.set(Calendar.MINUTE, 0);
            calendar.set(Calendar.SECOND, 0);
            calendar.set(Calendar.MILLISECOND, 0);
            calendar.add(Calendar.HOUR_OF_DAY, 1);

            long next = Math.min(calendar.getTimeInMillis(), to);

            if (next <= cursor) {
                next = to; // safety against clock oddities
            }

            hourly[hour] += next - cursor;
            cursor = next;
        }
    }

    // ---------------------------------------------------------
    // Sanity cap using Android's own daily aggregate
    //
    // Records for the same package are NOT additive across
    // overlapping buckets, so we take the max (never the sum) and
    // only use it as an upper bound. Hourly values are scaled so
    // they stay consistent with the capped total.
    // ---------------------------------------------------------

    private void applyDailyAggregateCap(
            UsageStatsManager manager,
            Result result,
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

            // Skip records for apps not used inside this window.
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

        long rawTotal = 0L;
        long cappedTotal = 0L;

        for (Map.Entry<String, Long> entry : result.usage.entrySet()) {
            long value = entry.getValue();
            rawTotal += value;

            Long cap = caps.get(entry.getKey());

            if (cap != null && cap > 0 && value > cap) {
                entry.setValue(cap);
                value = cap;
            }

            cappedTotal += value;
        }

        if (rawTotal > 0 && cappedTotal < rawTotal) {
            double scale = (double) cappedTotal / (double) rawTotal;

            for (int i = 0; i < result.hourly.length; i++) {
                result.hourly[i] = Math.round(result.hourly[i] * scale);
            }
        }
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
    // Excluded: SystemUI, (optionally) Android Settings, home launchers,
    // and (optionally) Smart Shield itself. Every other package counts.
    // =========================================================

    private boolean isIgnoredPackage(
            String packageName,
            Set<String> launcherPackages
    ) {
        if (packageName == null || packageName.isEmpty()) {
            return true;
        }

        if (EXCLUDE_OWN_APP && packageName.equals(ctx().getPackageName())) {
            return true;
        }

        if (SYSTEM_UI.equals(packageName)) {
            return true;
        }

        if (EXCLUDE_SETTINGS && ANDROID_SETTINGS.equals(packageName)) {
            return true;
        }

        return launcherPackages.contains(packageName);
    }

    /**
     * All home-screen apps (not only the default one, so a launcher switched
     * mid-day is still excluded). Needs a <queries> entry for the HOME intent
     * on Android 11+, otherwise this returns an empty set.
     */
    private Set<String> getLauncherPackages() {
        Set<String> launchers = new HashSet<>();

        try {
            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);

            List<ResolveInfo> resolved =
                    ctx()
                            .getPackageManager()
                            .queryIntentActivities(homeIntent, 0);

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
            PackageManager pm = ctx().getPackageManager();
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
    // APPLICATION ICON (Base64 PNG data URL, cached per process)
    // =========================================================

    private String getApplicationIconBase64(String packageName) {
        String cached = iconCache.get(packageName);

        if (cached != null) {
            return cached;
        }

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

            String icon = "data:image/png;base64,"
                    + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);

            iconCache.put(packageName, icon);

            return icon;

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
    // LOCAL-DAY HELPERS
    // =========================================================

    private long startOfDay(long timestamp) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTimeInMillis(timestamp);

        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);

        return calendar.getTimeInMillis();
    }

    /** Local midnight of the day that is dayOffset days from the given time. */
    private long startOfDayOffset(long timestamp, int dayOffset) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTimeInMillis(startOfDay(timestamp));
        calendar.add(Calendar.DAY_OF_YEAR, dayOffset);

        return calendar.getTimeInMillis();
    }

    /** True when the window starts at local midnight and is at most one day long. */
    private boolean isSingleLocalDay(long startTime, long endTime) {
        return startOfDay(startTime) == startTime
                && endTime - startTime <= DAY_MS + HOUR_MS; // +1h for DST days
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