package com.smartshield.app.plugins;

import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    // =========================================================
    // OPEN USAGE ACCESS SETTINGS
    // =========================================================

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {

        try {

            Intent intent =
                    new Intent(
                            Settings.ACTION_USAGE_ACCESS_SETTINGS
                    );

            getContext().startActivity(intent);

            call.resolve();

        } catch (Exception error) {

            call.reject(
                    "Unable to open Usage Access settings.",
                    error
            );
        }
    }


    // =========================================================
    // CHECK USAGE ACCESS
    // =========================================================

    @PluginMethod
    public void hasUsageAccess(PluginCall call) {

        try {

            UsageStatsManager usageStatsManager =
                    (UsageStatsManager) getContext()
                            .getSystemService(
                                    Context.USAGE_STATS_SERVICE
                            );

            if (usageStatsManager == null) {

                JSObject result =
                        new JSObject();

                result.put(
                        "hasAccess",
                        false
                );

                call.resolve(result);

                return;
            }

            long endTime =
                    System.currentTimeMillis();

            long startTime =
                    endTime -
                            (60L * 60L * 1000L);

            List<android.app.usage.UsageStats> stats =
                    usageStatsManager.queryUsageStats(
                            UsageStatsManager.INTERVAL_DAILY,
                            startTime,
                            endTime
                    );

            boolean hasAccess =
                    stats != null &&
                    !stats.isEmpty();

            JSObject result =
                    new JSObject();

            result.put(
                    "hasAccess",
                    hasAccess
            );

            call.resolve(result);

        } catch (Exception error) {

            call.reject(
                    "Unable to check Usage Access permission.",
                    error
            );
        }
    }


    // =========================================================
    // TODAY USAGE
    // =========================================================

    @PluginMethod
    public void getTodayUsage(PluginCall call) {

        try {

            long startTime =
                    getTodayStartTime();

            long endTime =
                    System.currentTimeMillis();

            Map<String, Long> usageMap =
                    calculateAppUsage(
                            startTime,
                            endTime
                    );

            List<JSONObject> apps =
                    new ArrayList<>();


            // -------------------------------------------------
            // CREATE APP OBJECTS
            // -------------------------------------------------

            for (
                    Map.Entry<String, Long> entry :
                    usageMap.entrySet()
            ) {

                String packageName =
                        entry.getKey();

                long duration =
                        entry.getValue();

                if (duration <= 0) {
                    continue;
                }

                JSONObject app =
                        new JSONObject();

                app.put(
                        "appName",
                        getApplicationName(
                                packageName
                        )
                );

                app.put(
                        "packageName",
                        packageName
                );

                app.put(
                        "totalTimeInForeground",
                        duration
                );

                app.put(
                        "formattedUsage",
                        formatDuration(
                                duration
                        )
                );

                apps.add(app);
            }


            // -------------------------------------------------
            // SORT BY USAGE
            // -------------------------------------------------

            Collections.sort(
                    apps,
                    new Comparator<JSONObject>() {

                        @Override
                        public int compare(
                                JSONObject first,
                                JSONObject second
                        ) {

                            try {

                                long firstTime =
                                        first.getLong(
                                                "totalTimeInForeground"
                                        );

                                long secondTime =
                                        second.getLong(
                                                "totalTimeInForeground"
                                        );

                                return Long.compare(
                                        secondTime,
                                        firstTime
                                );

                            } catch (Exception error) {

                                return 0;
                            }
                        }
                    }
            );


            JSONArray appsArray =
                    new JSONArray();

            for (JSONObject app : apps) {
                appsArray.put(app);
            }


            // -------------------------------------------------
            // TOTAL SCREEN TIME
            // -------------------------------------------------

            long totalScreenTime =
                    calculateTotalUsage(
                            usageMap
                    );


            // -------------------------------------------------
            // RESPONSE
            // -------------------------------------------------

            JSObject result =
                    new JSObject();

            result.put(
                    "apps",
                    appsArray
            );

            result.put(
                    "count",
                    appsArray.length()
            );

            result.put(
                    "totalScreenTime",
                    totalScreenTime
            );

            result.put(
                    "formattedScreenTime",
                    formatDuration(
                            totalScreenTime
                    )
            );

            result.put(
                    "startTime",
                    startTime
            );

            result.put(
                    "endTime",
                    endTime
            );

            call.resolve(result);

        } catch (Exception error) {

            call.reject(
                    "Unable to retrieve application usage.",
                    error
            );
        }
    }


    // =========================================================
    // TODAY SCREEN TIME
    // =========================================================

    @PluginMethod
    public void getTodayScreenTime(PluginCall call) {

        try {

            long startTime =
                    getTodayStartTime();

            long endTime =
                    System.currentTimeMillis();

            Map<String, Long> usageMap =
                    calculateAppUsage(
                            startTime,
                            endTime
                    );

            long totalScreenTime =
                    calculateTotalUsage(
                            usageMap
                    );

            JSObject result =
                    new JSObject();

            result.put(
                    "totalScreenTime",
                    totalScreenTime
            );

            result.put(
                    "formattedScreenTime",
                    formatDuration(
                            totalScreenTime
                    )
            );

            result.put(
                    "startTime",
                    startTime
            );

            result.put(
                    "endTime",
                    endTime
            );

            call.resolve(result);

        } catch (Exception error) {

            call.reject(
                    "Unable to retrieve today's screen time.",
                    error
            );
        }
    }


    // =========================================================
    // MAIN USAGE CALCULATION
    // =========================================================

    private Map<String, Long> calculateAppUsage(
            long startTime,
            long endTime
    ) {

        UsageStatsManager usageStatsManager =
                (UsageStatsManager) getContext()
                        .getSystemService(
                                Context.USAGE_STATS_SERVICE
                        );

        Map<String, Long> usageMap =
                new HashMap<>();

        if (usageStatsManager == null) {
            return usageMap;
        }


        /*
         * Query before midnight so we can determine whether
         * an application was already active when today started.
         */
        long queryStartTime =
                startTime -
                        (24L * 60L * 60L * 1000L);


        UsageEvents events =
                usageStatsManager.queryEvents(
                        queryStartTime,
                        endTime
                );

        if (events == null) {
            return usageMap;
        }


        UsageEvents.Event event =
                new UsageEvents.Event();


        String currentPackage = null;

        long currentStart = -1;


        // =====================================================
        // PROCESS EVENT STREAM
        // =====================================================

        while (events.hasNextEvent()) {

            events.getNextEvent(event);

            String packageName =
                    event.getPackageName();

            if (
                    packageName == null ||
                    packageName.isEmpty()
            ) {
                continue;
            }


            long eventTime =
                    event.getTimeStamp();


            if (
                    eventTime < queryStartTime ||
                    eventTime > endTime
            ) {
                continue;
            }


            int eventType =
                    event.getEventType();


            // =================================================
            // SCREEN BECAME NON-INTERACTIVE
            // =================================================

            if (
                    eventType ==
                    UsageEvents.Event.SCREEN_NON_INTERACTIVE
            ) {

                closeCurrentSession(
                        usageMap,
                        currentPackage,
                        currentStart,
                        eventTime,
                        startTime,
                        endTime
                );

                currentPackage = null;
                currentStart = -1;

                continue;
            }


            // =================================================
            // KEYGUARD SHOWN
            // =================================================

            if (
                    eventType ==
                    UsageEvents.Event.KEYGUARD_SHOWN
            ) {

                closeCurrentSession(
                        usageMap,
                        currentPackage,
                        currentStart,
                        eventTime,
                        startTime,
                        endTime
                );

                currentPackage = null;
                currentStart = -1;

                continue;
            }


            // =================================================
            // ANDROID 10+
            // =================================================

            if (
                    Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.Q
            ) {

                if (
                        eventType ==
                        UsageEvents.Event.ACTIVITY_RESUMED
                ) {

                    handleResumedEvent(
                            usageMap,
                            packageName,
                            eventTime,
                            startTime,
                            endTime,
                            Holder.of(
                                    currentPackage,
                                    currentStart
                            )
                    );


                    Holder holder =
                            Holder.of(
                                    currentPackage,
                                    currentStart
                            );

                    /*
                     * Recalculate the state after processing.
                     */
                    if (
                            isIgnoredPackage(
                                    packageName
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage = null;
                        currentStart = -1;

                    } else {

                        if (
                                currentPackage == null
                        ) {

                            currentPackage =
                                    packageName;

                            currentStart =
                                    eventTime;

                        } else if (
                                !currentPackage.equals(
                                        packageName
                                )
                        ) {

                            closeCurrentSession(
                                    usageMap,
                                    currentPackage,
                                    currentStart,
                                    eventTime,
                                    startTime,
                                    endTime
                            );

                            currentPackage =
                                    packageName;

                            currentStart =
                                    eventTime;
                        }
                    }
                }


                // ---------------------------------------------
                // ACTIVITY PAUSED
                // ---------------------------------------------

                if (
                        eventType ==
                        UsageEvents.Event.ACTIVITY_PAUSED
                ) {

                    if (
                            packageName.equals(
                                    currentPackage
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage = null;
                        currentStart = -1;
                    }
                }


                // ---------------------------------------------
                // ACTIVITY STOPPED
                // ---------------------------------------------

                if (
                        eventType ==
                        UsageEvents.Event.ACTIVITY_STOPPED
                ) {

                    if (
                            packageName.equals(
                                    currentPackage
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage = null;
                        currentStart = -1;
                    }
                }
            }


            // =================================================
            // OLD ANDROID
            // =================================================

            else {

                if (
                        eventType ==
                        UsageEvents.Event.MOVE_TO_FOREGROUND
                ) {

                    if (
                            isIgnoredPackage(
                                    packageName
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage = null;
                        currentStart = -1;

                        continue;
                    }


                    if (
                            currentPackage == null
                    ) {

                        currentPackage =
                                packageName;

                        currentStart =
                                eventTime;

                    } else if (
                            !currentPackage.equals(
                                    packageName
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage =
                                packageName;

                        currentStart =
                                eventTime;
                    }
                }


                if (
                        eventType ==
                        UsageEvents.Event.MOVE_TO_BACKGROUND
                ) {

                    if (
                            packageName.equals(
                                    currentPackage
                            )
                    ) {

                        closeCurrentSession(
                                usageMap,
                                currentPackage,
                                currentStart,
                                eventTime,
                                startTime,
                                endTime
                        );

                        currentPackage = null;
                        currentStart = -1;
                    }
                }
            }
        }


        // =====================================================
        // CLOSE LAST SESSION
        // =====================================================

        if (
                currentPackage != null &&
                currentStart >= 0
        ) {

            closeCurrentSession(
                    usageMap,
                    currentPackage,
                    currentStart,
                    endTime,
                    startTime,
                    endTime
            );
        }


        return usageMap;
    }


    // =========================================================
    // RESUMED EVENT HANDLER
    // =========================================================

    private void handleResumedEvent(
            Map<String, Long> usageMap,
            String packageName,
            long eventTime,
            long startTime,
            long endTime,
            Holder holder
    ) {

        /*
         * This method intentionally does not add usage itself.
         *
         * Session transitions are handled centrally inside
         * calculateAppUsage().
         *
         * This keeps the calculation from accidentally adding
         * the same interval twice.
         */
    }


    // =========================================================
    // CLOSE SESSION
    // =========================================================

    private void closeCurrentSession(
            Map<String, Long> usageMap,
            String packageName,
            long sessionStart,
            long sessionEnd,
            long startTime,
            long endTime
    ) {

        if (
                packageName == null ||
                sessionStart < 0
        ) {
            return;
        }


        if (
                isIgnoredPackage(
                        packageName
                )
        ) {
            return;
        }


        if (
                sessionEnd <= sessionStart
        ) {
            return;
        }


        long clippedStart =
                Math.max(
                        sessionStart,
                        startTime
                );


        long clippedEnd =
                Math.min(
                        sessionEnd,
                        endTime
                );


        if (
                clippedEnd <= clippedStart
        ) {
            return;
        }


        long duration =
                clippedEnd -
                clippedStart;


        if (duration <= 0) {
            return;
        }


        addUsage(
                usageMap,
                packageName,
                duration
        );
    }


    // =========================================================
    // ADD USAGE
    // =========================================================

    private void addUsage(
            Map<String, Long> usageMap,
            String packageName,
            long duration
    ) {

        if (
                packageName == null ||
                packageName.isEmpty() ||
                duration <= 0
        ) {
            return;
        }


        long previous =
                usageMap.containsKey(packageName)
                        ? usageMap.get(packageName)
                        : 0;


        usageMap.put(
                packageName,
                previous + duration
        );
    }


    // =========================================================
    // TOTAL USAGE
    // =========================================================

    private long calculateTotalUsage(
            Map<String, Long> usageMap
    ) {

        long total = 0;

        for (Long duration :
                usageMap.values()) {

            if (
                    duration != null &&
                    duration > 0
            ) {

                total += duration;
            }
        }

        return total;
    }


    // =========================================================
    // IGNORE NON-USER APP PACKAGES
    // =========================================================

    private boolean isIgnoredPackage(
            String packageName
    ) {

        if (
                packageName == null ||
                packageName.isEmpty()
        ) {
            return true;
        }


        // Smart Shield itself
        if (
                packageName.equals(
                        getContext().getPackageName()
                )
        ) {
            return true;
        }


        // Android System UI
        if (
                packageName.equals(
                        "com.android.systemui"
                )
        ) {
            return true;
        }


        // Android Settings
        if (
                packageName.equals(
                        "com.android.settings"
                )
        ) {
            return true;
        }


        // -----------------------------------------------------
        // HOME / LAUNCHER
        // -----------------------------------------------------

        try {

            Intent homeIntent =
                    new Intent(
                            Intent.ACTION_MAIN
                    );

            homeIntent.addCategory(
                    Intent.CATEGORY_HOME
            );


            List<android.content.pm.ResolveInfo> launchers =
                    getContext()
                            .getPackageManager()
                            .queryIntentActivities(
                                    homeIntent,
                                    PackageManager.MATCH_DEFAULT_ONLY
                            );


            for (
                    android.content.pm.ResolveInfo info :
                    launchers
            ) {

                if (
                        info.activityInfo != null &&
                        packageName.equals(
                                info.activityInfo.packageName
                        )
                ) {

                    return true;
                }
            }

        } catch (Exception ignored) {
        }


        return false;
    }


    // =========================================================
    // GET APPLICATION NAME
    // =========================================================

    private String getApplicationName(
            String packageName
    ) {

        try {

            PackageManager packageManager =
                    getContext()
                            .getPackageManager();


            ApplicationInfo applicationInfo =
                    packageManager.getApplicationInfo(
                            packageName,
                            0
                    );


            CharSequence label =
                    packageManager.getApplicationLabel(
                            applicationInfo
                    );


            if (label != null) {
                return label.toString();
            }

        } catch (Exception ignored) {
        }


        return packageName;
    }


    // =========================================================
    // TODAY START
    // =========================================================

    private long getTodayStartTime() {

        Calendar calendar =
                Calendar.getInstance();

        calendar.set(
                Calendar.HOUR_OF_DAY,
                0
        );

        calendar.set(
                Calendar.MINUTE,
                0
        );

        calendar.set(
                Calendar.SECOND,
                0
        );

        calendar.set(
                Calendar.MILLISECOND,
                0
        );

        return calendar.getTimeInMillis();
    }


    // =========================================================
    // FORMAT DURATION
    // =========================================================

    private String formatDuration(
            long milliseconds
    ) {

        long totalMinutes =
                milliseconds /
                (1000 * 60);

        long hours =
                totalMinutes / 60;

        long minutes =
                totalMinutes % 60;


        if (
                hours > 0 &&
                minutes > 0
        ) {

            return hours +
                    "h " +
                    minutes +
                    "m";
        }


        if (hours > 0) {
            return hours + "h";
        }


        if (minutes > 0) {
            return minutes + "m";
        }


        return "<1m";
    }


    // =========================================================
    // SMALL STATE HOLDER
    // =========================================================

    private static class Holder {

        String packageName;
        long startTime;


        private Holder(
                String packageName,
                long startTime
        ) {

            this.packageName =
                    packageName;

            this.startTime =
                    startTime;
        }


        static Holder of(
                String packageName,
                long startTime
        ) {

            return new Holder(
                    packageName,
                    startTime
            );
        }
    }
}