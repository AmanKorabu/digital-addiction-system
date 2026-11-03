package com.smartshield.app.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import java.text.DateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Smart Shield focus mode.
 *
 * Runs as a foreground service while a focus session is active. It watches
 * which app is in the foreground (UsageEvents) and, when that app is on the
 * blocked list, covers it with a full-screen overlay until the user goes home
 * or the session ends.
 *
 * CHANGE: when FocusAccessibilityService is connected, it is the only thing
 * that blocks apps. This service then keeps the notification and session
 * lifecycle going but draws NO overlay, so two different blocking screens
 * never compete. If the accessibility service is not connected, this
 * service falls back to its own overlay exactly as before.
 *
 * Session state lives in SharedPreferences so it survives the app/process
 * being killed. The React side reads it through FocusModePlugin.
 */
public class FocusService extends Service {

    private static final String TAG = "FocusService";

    // ---- shared with FocusModePlugin ----
    public static final String PREFS_NAME = "smartshield_focus";
    public static final String KEY_ACTIVE = "active";
    public static final String KEY_START = "startTime";
    public static final String KEY_END = "endTime";
    public static final String KEY_PACKAGES = "packages";
    public static final String KEY_ATTEMPTS = "blockedAttempts";
    public static final String KEY_COMPLETED = "completed";
    public static final String KEY_STOPPED_AT = "stoppedAt";

    /** True while the service instance is alive (used by the plugin). */
    public static volatile boolean running = false;

    private static final String CHANNEL_ID = "smartshield_focus_mode";
    private static final int NOTIFICATION_ID = 4101;
    private static final long POLL_MS = 700L;
    private static final long INITIAL_LOOKBACK_MS = 30L * 60L * 1000L;
    private static final String SYSTEM_UI = "com.android.systemui";

    // ForegroundServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE (API 34)
    private static final int FGS_TYPE_SPECIAL_USE = 0x40000000;

    private Handler handler;
    private WindowManager windowManager;

    private final Set<String> blockedPackages = new HashSet<>();
    private long endTime = 0L;

    private String currentForeground = null;
    private long lastEventTime = 0L;

    private View overlay = null;
    private TextView overlayAppText = null;
    private TextView overlayTimeText = null;

    // =========================================================
    // LIFECYCLE
    // =========================================================

    @Override
    public void onCreate() {
        super.onCreate();

        running = true;
        handler = new Handler(Looper.getMainLooper());
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);

        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        boolean active = prefs.getBoolean(KEY_ACTIVE, false);
        endTime = prefs.getLong(KEY_END, 0L);

        blockedPackages.clear();
        Set<String> saved = prefs.getStringSet(KEY_PACKAGES, null);

        if (saved != null) {
            blockedPackages.addAll(saved);
        }

        // Must be called quickly after startForegroundService().
        startForegroundCompat(buildNotification());

        long now = System.currentTimeMillis();

        if (!active) {
            shutdown();
            return START_NOT_STICKY;
        }

        if (now >= endTime) {
            finishSession(true);
            return START_NOT_STICKY;
        }

        currentForeground = null;
        lastEventTime = now - INITIAL_LOOKBACK_MS;

        handler.removeCallbacks(tick);
        handler.post(tick);

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;

        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }

        hideOverlay();

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // =========================================================
    // MAIN LOOP
    // =========================================================

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();

            if (now >= endTime) {
                finishSession(true);
                return;
            }

            // The accessibility service is the single blocking mechanism while
            // it is connected. Remove any overlay of ours and draw nothing, so
            // there are never two different blocking screens.
            if (FocusAccessibilityService.connected) {
                hideOverlay();
                handler.postDelayed(this, POLL_MS);
                return;
            }

            // Fallback: accessibility service not connected, block ourselves.
            try {
                refreshForeground(now);
            } catch (Exception error) {
                Log.w(TAG, "Foreground detection failed", error);
            }

            if (currentForeground != null
                    && blockedPackages.contains(currentForeground)) {
                showOrUpdateOverlay(currentForeground, now);
            } else {
                hideOverlay();
            }

            handler.postDelayed(this, POLL_MS);
        }
    };

    /** Reads new usage events and updates which app is in the foreground. */
    private void refreshForeground(long now) {
        UsageStatsManager manager =
                (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);

        if (manager == null) {
            return;
        }

        UsageEvents events = manager.queryEvents(lastEventTime + 1L, now);

        if (events == null) {
            return;
        }

        UsageEvents.Event event = new UsageEvents.Event();

        while (events.hasNextEvent()) {
            events.getNextEvent(event);

            long eventTime = event.getTimeStamp();

            if (eventTime > lastEventTime) {
                lastEventTime = eventTime;
            }

            int type = event.getEventType();

            if (type == UsageEvents.Event.SCREEN_NON_INTERACTIVE
                    || type == UsageEvents.Event.KEYGUARD_SHOWN) {
                currentForeground = null;
                continue;
            }

            String packageName = event.getPackageName();

            if (packageName == null || SYSTEM_UI.equals(packageName)) {
                continue;
            }

            if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                currentForeground = packageName;

            } else if (type == UsageEvents.Event.ACTIVITY_PAUSED
                    || type == UsageEvents.Event.ACTIVITY_STOPPED) {

                if (packageName.equals(currentForeground)) {
                    currentForeground = null;
                }
            }
        }
    }

    // =========================================================
    // SESSION END
    // =========================================================

    private void finishSession(boolean completed) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        if (prefs.getBoolean(KEY_ACTIVE, false)) {
            prefs.edit()
                    .putBoolean(KEY_ACTIVE, false)
                    .putBoolean(KEY_COMPLETED, completed)
                    .putLong(
                            KEY_STOPPED_AT,
                            completed ? endTime : System.currentTimeMillis()
                    )
                    .apply();
        }

        shutdown();
    }

    @SuppressWarnings("deprecation")
    private void shutdown() {
        if (handler != null) {
            handler.removeCallbacks(tick);
        }

        hideOverlay();
        stopForeground(true);
        stopSelf();
    }

    // =========================================================
    // OVERLAY (fallback only, used when accessibility is not connected)
    // =========================================================

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(this);
    }

    private void showOrUpdateOverlay(String packageName, long now) {
        if (!canDrawOverlays()) {
            return;
        }

        if (overlay == null) {
            overlay = buildOverlay();

            try {
                windowManager.addView(overlay, overlayParams());
            } catch (Exception error) {
                Log.e(TAG, "Unable to show focus overlay", error);
                overlay = null;
                overlayAppText = null;
                overlayTimeText = null;
                return;
            }

            SharedPreferences prefs =
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

            prefs.edit()
                    .putInt(KEY_ATTEMPTS, prefs.getInt(KEY_ATTEMPTS, 0) + 1)
                    .apply();
        }

        if (overlayAppText != null) {
            overlayAppText.setText(
                    getAppLabel(packageName) + " is blocked while you focus."
            );
        }

        if (overlayTimeText != null) {
            overlayTimeText.setText(formatRemaining(endTime - now));
        }
    }

    @SuppressWarnings("deprecation")
    private WindowManager.LayoutParams overlayParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        return new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.OPAQUE
        );
    }

    private View buildOverlay() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0F172A"));
        root.setPadding(dp(32), dp(32), dp(32), dp(32));
        root.setClickable(true); // swallow touches

        TextView badge = makeText("FOCUS MODE", 12f, "#60A5FA", true);
        badge.setLetterSpacing(0.15f);
        root.addView(badge, wrapParams(0));

        TextView title = makeText("Stay on track", 30f, "#FFFFFF", true);
        root.addView(title, wrapParams(12));

        overlayAppText = makeText("", 15f, "#CBD5E1", false);
        root.addView(overlayAppText, wrapParams(10));

        overlayTimeText = makeText("00:00", 52f, "#FFFFFF", true);
        root.addView(overlayTimeText, wrapParams(32));

        TextView caption =
                makeText("left in this focus session", 13f, "#94A3B8", false);
        root.addView(caption, wrapParams(4));

        TextView button = makeText("Go to home screen", 16f, "#0F172A", true);
        button.setPadding(dp(28), dp(14), dp(28), dp(14));

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(28));
        button.setBackground(background);
        button.setClickable(true);

        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goHome();
            }
        });

        root.addView(button, wrapParams(40));

        return root;
    }

    private void hideOverlay() {
        if (overlay == null) {
            return;
        }

        try {
            windowManager.removeView(overlay);
        } catch (Exception error) {
            Log.w(TAG, "Overlay already removed", error);
        }

        overlay = null;
        overlayAppText = null;
        overlayTimeText = null;
    }

    /**
     * Opens the home screen while the overlay is still visible (newer Android
     * versions only allow this from the background while an overlay window
     * exists), then removes the overlay a moment later.
     */
    private void goHome() {
        currentForeground = null;

        try {
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(home);
        } catch (Exception error) {
            Log.e(TAG, "Unable to open home screen", error);
        }

        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                hideOverlay();
            }
        }, 250L);
    }

    // =========================================================
    // NOTIFICATION
    // =========================================================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Focus mode",
                NotificationManager.IMPORTANCE_LOW
        );

        channel.setDescription("Shown while a Smart Shield focus session is running.");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        String untilText = endTime > 0
                ? "until " + DateFormat.getTimeInstance(DateFormat.SHORT)
                        .format(new Date(endTime))
                : "";

        String text = "Blocking " + blockedPackages.size() + " app"
                + (blockedPackages.size() == 1 ? "" : "s") + " " + untilText;

        PendingIntent contentIntent = null;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());

        if (launch != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            contentIntent = PendingIntent.getActivity(this, 0, launch, flags);
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
                .setContentTitle("Focus mode is on")
                .setContentText(text.trim())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(contentIntent)
                .build();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, FGS_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    // =========================================================
    // SMALL HELPERS
    // =========================================================

    private String getAppLabel(String packageName) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(info);

            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Exception ignored) {
            // Fall through to the package name.
        }

        return packageName;
    }

    private String formatRemaining(long milliseconds) {
        long totalSeconds = Math.max(0L, (milliseconds + 999L) / 1000L);

        long hours = totalSeconds / 3600L;
        long minutes = (totalSeconds % 3600L) / 60L;
        long seconds = totalSeconds % 60L;

        if (hours > 0) {
            return String.format(Locale.getDefault(), "%d:%02d:%02d",
                    hours, minutes, seconds);
        }

        return String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds);
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    private TextView makeText(String text, float sp, String color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(Color.parseColor(color));
        view.setGravity(Gravity.CENTER);

        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }

        return view;
    }

    private LinearLayout.LayoutParams wrapParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );

        params.topMargin = dp(topMarginDp);
        params.gravity = Gravity.CENTER_HORIZONTAL;

        return params;
    }
}