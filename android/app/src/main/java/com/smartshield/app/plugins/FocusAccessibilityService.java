
package com.smartshield.app.plugins;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class FocusAccessibilityService extends AccessibilityService {

    private static final String TAG = "FocusAccessibility";

    // SharedPreferences used by FocusModePlugin and FocusService.
    private static final String PREFS_NAME = "smartshield_focus";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_END = "endTime";
    private static final String KEY_PACKAGES = "packages";
    private static final String KEY_ATTEMPTS = "blockedAttempts";
    private static final String KEY_COMPLETED = "completed";
    private static final String KEY_STOPPED_AT = "stoppedAt";

    private static final long TIMER_TICK_MS = 1000L;
    private static final long HIDE_CONFIRM_MS = 400L;
    private static final long EXPIRY_MARGIN_MS = 100L;

    /**
     * True while Android has connected this Accessibility Service.
     * Read by FocusModePlugin.
     */
    public static volatile boolean connected = false;

    private Handler handler;
    private WindowManager windowManager;

    private View blockingView;
    private TextView appText;
    private TextView timerText;

    private String currentBlockedPackage;

    private boolean overlayVisible = false;
    private boolean hidePending = false;

    // Result of checking currently visible application windows.
    private static final class Scan {
        boolean windowsKnown = false;
        boolean unreadable = false;
        String blockedPackage = null;
    }

    // =========================================================
    // TIMER
    // =========================================================

    private final Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!overlayVisible || handler == null) {
                return;
            }

            SharedPreferences preferences = prefs();

            long remaining =
                    preferences.getLong(KEY_END, 0L)
                            - System.currentTimeMillis();

            if (!preferences.getBoolean(KEY_ACTIVE, false)
                    || remaining <= 0L) {
                evaluate(null, false);
                return;
            }

            if (timerText != null) {
                timerText.setText(formatTime(remaining));
            }

            handler.postDelayed(this, TIMER_TICK_MS);
        }
    };

    private final Runnable expiryRunnable = new Runnable() {
        @Override
        public void run() {
            evaluate(null, false);
        }
    };

    private final Runnable confirmHideRunnable = new Runnable() {
        @Override
        public void run() {
            hidePending = false;

            if (!overlayVisible) {
                return;
            }

            SharedPreferences preferences = prefs();

            if (!preferences.getBoolean(KEY_ACTIVE, false)) {
                hideNow();
                return;
            }

            Scan scan = scanWindows(loadBlockedPackages(preferences));

            // Hide only when Android gives us a readable window list
            // and no blocked application is visible.
            if (scan.blockedPackage == null
                    && scan.windowsKnown
                    && !scan.unreadable) {
                hideNow();
            }
        }
    };

    // =========================================================
    // SERVICE LIFECYCLE
    // =========================================================

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();

        handler = new Handler(Looper.getMainLooper());

        windowManager = (WindowManager)
                getSystemService(Context.WINDOW_SERVICE);

        connected = true;

        Log.i(TAG, "Accessibility service connected");

        // Restore an existing focus session after reconnection.
        evaluate(null, false);
    }

    @Override
    public boolean onUnbind(Intent intent) {
        connected = false;

        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }

        hideNow();

        Log.i(TAG, "Accessibility service unbound");

        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        connected = false;

        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
        }

        hideNow();

        Log.i(TAG, "Accessibility service destroyed");

        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // Do not change blocking state just because Android interrupts
        // accessibility feedback.
        Log.i(TAG, "Accessibility service interrupted");
    }

    // =========================================================
    // ACCESSIBILITY EVENTS
    // =========================================================

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {

        if (event == null || handler == null) {
            return;
        }

        int type = event.getEventType();

        boolean windowState =
                type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;

        boolean windowsChanged =
                type == AccessibilityEvent.TYPE_WINDOWS_CHANGED;

        if (!windowState && !windowsChanged) {
            return;
        }

        String eventPackage = null;

        if (windowState && event.getPackageName() != null) {
            eventPackage = event.getPackageName().toString();
        }

        evaluate(eventPackage, windowState);
    }

    // =========================================================
    // CORE ENFORCEMENT
    // =========================================================

    private void evaluate(String eventPackage, boolean fromWindowState) {

        if (handler == null) {
            return;
        }

        SharedPreferences preferences = prefs();

        if (!preferences.getBoolean(KEY_ACTIVE, false)) {
            hideNow();
            return;
        }

        long now = System.currentTimeMillis();
        long end = preferences.getLong(KEY_END, 0L);

        if (now >= end) {
            completeSession(preferences, end);
            hideNow();
            return;
        }

        scheduleExpiry(end - now);

        Set<String> blockedPackages =
                loadBlockedPackages(preferences);

        if (blockedPackages.isEmpty()) {
            hideNow();
            return;
        }

        Scan scan = scanWindows(blockedPackages);

        String target = scan.blockedPackage;

        // A window-state event can identify a blocked app before
        // Android exposes its window in getWindows().
        if (target == null
                && fromWindowState
                && eventPackage != null
                && blockedPackages.contains(eventPackage)) {

            target = eventPackage;
        }

        if (target != null) {

            cancelPendingHide();

            showOrUpdateOverlay(target);

            // Recheck if the blocked package was detected only
            // from the event rather than the visible window list.
            if (scan.blockedPackage == null) {
                scheduleHideConfirm();
            }

            return;
        }

        // Do not hide when the window information is incomplete.
        if (overlayVisible
                && scan.windowsKnown
                && !scan.unreadable) {

            scheduleHideConfirm();
        }
    }

    // =========================================================
    // VISIBLE WINDOW SCANNING
    // =========================================================

    @SuppressWarnings("deprecation")
    private Scan scanWindows(Set<String> blockedPackages) {

        Scan scan = new Scan();

        List<AccessibilityWindowInfo> windows;

        try {
            windows = getWindows();
        } catch (Exception error) {
            Log.w(TAG, "Unable to read accessibility windows", error);
            return scan;
        }

        if (windows == null || windows.isEmpty()) {
            return scan;
        }

        scan.windowsKnown = true;

        for (AccessibilityWindowInfo window : windows) {

            if (window == null) {
                continue;
            }

            AccessibilityNodeInfo root = null;

            try {

                if (window.getType()
                        != AccessibilityWindowInfo.TYPE_APPLICATION) {
                    continue;
                }

                root = window.getRoot();

                if (root == null || root.getPackageName() == null) {
                    scan.unreadable = true;
                    continue;
                }

                String packageName =
                        root.getPackageName().toString();

                if (blockedPackages.contains(packageName)) {
                    scan.blockedPackage = packageName;
                    break;
                }

            } catch (Exception error) {

                scan.unreadable = true;

                Log.w(TAG, "Unable to inspect an application window", error);

            } finally {

                if (root != null) {
                    root.recycle();
                }

                try {
                    window.recycle();
                } catch (Exception ignored) {
                    // Window may already have been released.
                }
            }
        }

        return scan;
    }

    // =========================================================
    // SESSION COMPLETION
    // =========================================================

    private void completeSession(
            SharedPreferences preferences,
            long end
    ) {

        if (!preferences.getBoolean(KEY_ACTIVE, false)) {
            return;
        }

        preferences.edit()
                .putBoolean(KEY_ACTIVE, false)
                .putBoolean(KEY_COMPLETED, true)
                .putLong(KEY_STOPPED_AT, end)
                .apply();

        Log.i(TAG, "Focus session completed");
    }

    private void scheduleExpiry(long remainingMs) {

        if (handler == null) {
            return;
        }

        handler.removeCallbacks(expiryRunnable);

        handler.postDelayed(
                expiryRunnable,
                Math.max(0L, remainingMs) + EXPIRY_MARGIN_MS
        );
    }

    private void scheduleHideConfirm() {

        if (handler == null || hidePending) {
            return;
        }

        hidePending = true;

        handler.postDelayed(
                confirmHideRunnable,
                HIDE_CONFIRM_MS
        );
    }

    private void cancelPendingHide() {

        hidePending = false;

        if (handler != null) {
            handler.removeCallbacks(confirmHideRunnable);
        }
    }

    // =========================================================
    // BLOCKING OVERLAY
    // =========================================================

    private void showOrUpdateOverlay(String packageName) {

        if (packageName == null || packageName.isEmpty()) {
            return;
        }

        if (windowManager == null) {
            windowManager = (WindowManager)
                    getSystemService(Context.WINDOW_SERVICE);
        }

        if (windowManager == null) {
            Log.e(TAG, "WindowManager unavailable");
            return;
        }

        // Update the current overlay instead of creating duplicates.
        if (overlayVisible && blockingView != null) {

            if (!packageName.equals(currentBlockedPackage)) {

                currentBlockedPackage = packageName;

                updateAppText(packageName);

                countAttempt();
            }

            return;
        }

        View view = buildBlockingView(packageName);

        try {

            windowManager.addView(
                    view,
                    createLayoutParams()
            );

        } catch (Exception error) {

            Log.e(TAG, "Unable to display blocking overlay", error);

            blockingView = null;
            appText = null;
            timerText = null;

            overlayVisible = false;

            return;
        }

        blockingView = view;

        currentBlockedPackage = packageName;

        overlayVisible = true;

        countAttempt();

        if (handler != null) {
            handler.removeCallbacks(timerRunnable);
            handler.post(timerRunnable);
        }

        Log.i(TAG, "Blocking application: " + packageName);
    }

    private void countAttempt() {

        SharedPreferences preferences = prefs();

        int attempts = preferences.getInt(KEY_ATTEMPTS, 0);

        preferences.edit()
                .putInt(KEY_ATTEMPTS, attempts + 1)
                .apply();
    }

    private void updateAppText(String packageName) {

        if (appText != null) {

            appText.setText(
                    getApplicationLabel(packageName)
                            + " is restricted during this session."
            );
        }
    }

    private void hideNow() {

        if (handler != null) {
            handler.removeCallbacks(timerRunnable);
            handler.removeCallbacks(confirmHideRunnable);
        }

        hidePending = false;

        if (blockingView != null && windowManager != null) {

            try {
                windowManager.removeView(blockingView);

            } catch (Exception error) {

                Log.w(TAG, "Overlay was already removed", error);
            }
        }

        blockingView = null;
        appText = null;
        timerText = null;

        currentBlockedPackage = null;

        overlayVisible = false;
    }

    // =========================================================
    // WINDOW LAYOUT
    // =========================================================

    private WindowManager.LayoutParams createLayoutParams() {

        WindowManager.LayoutParams params =
                new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                        PixelFormat.OPAQUE
                );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {

            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams
                            .LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        return params;
    }

    // =========================================================
    // BLOCKING SCREEN UI
    // =========================================================

    private View buildBlockingView(String packageName) {

        LinearLayout root = new LinearLayout(this);

        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);

        root.setPadding(
                dp(28),
                dp(28),
                dp(28),
                dp(28)
        );

        root.setBackgroundColor(Color.rgb(15, 23, 42));
        root.setClickable(true);

        TextView badge = makeText(
                "SMART SHIELD \u2022 FOCUS MODE",
                12,
                "#60A5FA",
                true
        );

        badge.setLetterSpacing(0.12f);

        root.addView(badge, wrapParams(0));

        TextView title = makeText(
                "Take a mindful break",
                27,
                "#FFFFFF",
                true
        );

        root.addView(title, wrapParams(24));

        appText = makeText(
                getApplicationLabel(packageName)
                        + " is restricted during this session.",
                16,
                "#CBD5E1",
                false
        );

        root.addView(appText, wrapParams(14));

        timerText = makeText(
                formatTime(
                        prefs().getLong(KEY_END, 0L)
                                - System.currentTimeMillis()
                ),
                52,
                "#FFFFFF",
                true
        );

        root.addView(timerText, wrapParams(30));

        TextView caption = makeText(
                "remaining in your focus session",
                13,
                "#94A3B8",
                false
        );

        root.addView(caption, wrapParams(5));

        TextView button = makeText(
                "Return to home screen",
                16,
                "#0F172A",
                true
        );

        button.setPadding(
                dp(26),
                dp(15),
                dp(26),
                dp(15)
        );

        GradientDrawable background = new GradientDrawable();

        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(30));

        button.setBackground(background);
        button.setClickable(true);

        button.setOnClickListener(new View.OnClickListener() {

            @Override
            public void onClick(View view) {
                performGlobalAction(GLOBAL_ACTION_HOME);
            }
        });

        root.addView(button, wrapParams(40));

        return root;
    }

    // =========================================================
    // HELPERS
    // =========================================================

    private SharedPreferences prefs() {

        return getSharedPreferences(
                PREFS_NAME,
                MODE_PRIVATE
        );
    }

    private Set<String> loadBlockedPackages(
            SharedPreferences preferences
    ) {

        Set<String> blocked = new HashSet<>();

        Set<String> saved =
                preferences.getStringSet(KEY_PACKAGES, null);

        if (saved != null) {
            blocked.addAll(saved);
        }

        // Never block Smart Shield or Android System UI.
        blocked.remove(getPackageName());
        blocked.remove("com.android.systemui");

        return blocked;
    }

    private String getApplicationLabel(String packageName) {

        try {

            CharSequence label =
                    getPackageManager().getApplicationLabel(
                            getPackageManager().getApplicationInfo(
                                    packageName,
                                    0
                            )
                    );

            return label == null
                    ? packageName
                    : label.toString();

        } catch (Exception error) {

            return packageName;
        }
    }

    private String formatTime(long milliseconds) {

        long seconds = Math.max(
                0L,
                (milliseconds + 999L) / 1000L
        );

        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        long remainingSeconds = seconds % 60L;

        if (hours > 0) {

            return String.format(
                    Locale.getDefault(),
                    "%d:%02d:%02d",
                    hours,
                    minutes,
                    remainingSeconds
            );
        }

        return String.format(
                Locale.getDefault(),
                "%02d:%02d",
                minutes,
                remainingSeconds
        );
    }

    private TextView makeText(
            String text,
            float size,
            String color,
            boolean bold
    ) {

        TextView view = new TextView(this);

        view.setText(text);

        view.setTextSize(
                TypedValue.COMPLEX_UNIT_SP,
                size
        );

        view.setTextColor(Color.parseColor(color));
        view.setGravity(Gravity.CENTER);

        if (bold) {
            view.setTypeface(
                    Typeface.DEFAULT,
                    Typeface.BOLD
            );
        }

        return view;
    }

    private LinearLayout.LayoutParams wrapParams(
            int topMarginDp
    ) {

        LinearLayout.LayoutParams params =
                new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                );

        params.gravity = Gravity.CENTER_HORIZONTAL;
        params.topMargin = dp(topMarginDp);

        return params;
    }

    private int dp(float value) {

        return (int) (
                value * getResources()
                        .getDisplayMetrics()
                        .density
        );
    }
}
