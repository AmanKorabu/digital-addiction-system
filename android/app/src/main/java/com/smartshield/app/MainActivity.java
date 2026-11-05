package com.smartshield.app;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.smartshield.app.plugins.DeviceInfoPlugin;
import com.smartshield.app.plugins.FocusModePlugin;
import com.smartshield.app.plugins.UsageStatsPlugin;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Date;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SmartShieldCrash";

    // TEMPORARY debugging aid: remember the last crash and show it on the
    // next launch. Remove the crash code once the crash is fixed.
    private static final String CRASH_PREFS = "smartshield_crash_report";
    private static final String CRASH_KEY = "lastCrash";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        installCrashRecorder();

        // Custom plugins must be registered before super.onCreate().
        registerPlugin(DeviceInfoPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(FocusModePlugin.class);

        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        showSavedCrashReport();
    }

    // -----------------------------------------------------
    // CRASH REPORT (temporary)
    // -----------------------------------------------------

    private void installCrashRecorder() {
        final Context appContext = getApplicationContext();
        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();

        Thread.setDefaultUncaughtExceptionHandler(
                new Thread.UncaughtExceptionHandler() {
                    @Override
                    public void uncaughtException(Thread thread, Throwable throwable) {
                        try {
                            StringWriter writer = new StringWriter();
                            throwable.printStackTrace(new PrintWriter(writer));

                            String report = "Time: " + new Date()
                                    + "\nDevice: " + Build.MANUFACTURER + " " + Build.MODEL
                                    + "\nAndroid: " + Build.VERSION.RELEASE
                                    + " (API " + Build.VERSION.SDK_INT + ")"
                                    + "\nThread: " + thread.getName()
                                    + "\n\n" + writer;

                            appContext
                                    .getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE)
                                    .edit()
                                    .putString(CRASH_KEY, report)
                                    .commit();
                        } catch (Throwable ignored) {
                            // Never fail while recording a failure.
                        }

                        if (previous != null) {
                            previous.uncaughtException(thread, throwable);
                        }
                    }
                }
        );
    }

    private void showSavedCrashReport() {
        try {
            SharedPreferences prefs =
                    getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE);

            final String report = prefs.getString(CRASH_KEY, null);

            if (report == null || isFinishing()) {
                return;
            }

            // Show each crash only once.
            prefs.edit().remove(CRASH_KEY).commit();

            Log.e(TAG, report);

            final String shown =
                    report.length() > 4000 ? report.substring(0, 4000) : report;

            new AlertDialog.Builder(this)
                    .setTitle("Smart Shield crash report")
                    .setMessage(shown)
                    .setPositiveButton("Copy", new android.content.DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(android.content.DialogInterface dialog, int which) {
                            ClipboardManager clipboard = (ClipboardManager)
                                    getSystemService(Context.CLIPBOARD_SERVICE);

                            if (clipboard != null) {
                                clipboard.setPrimaryClip(
                                        ClipData.newPlainText("Smart Shield crash", report)
                                );
                            }
                        }
                    })
                    .setNegativeButton("Close", null)
                    .show();

        } catch (Throwable error) {
            Log.e(TAG, "Unable to show the crash report", error);
        }
    }
}