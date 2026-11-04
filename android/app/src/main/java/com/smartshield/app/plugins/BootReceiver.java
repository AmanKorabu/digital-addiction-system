package com.smartshield.app.plugins;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Restarts the background connection after the phone reboots or the app is
 * updated, but only if the user had it turned on.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();

        boolean relevant =
                Intent.ACTION_BOOT_COMPLETED.equals(action)
                        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);

        if (!relevant) {
            return;
        }

        if (!SyncService.prefs(context).getBoolean(SyncService.KEY_ENABLED, false)) {
            return;
        }

        try {
            SyncService.start(context);
        } catch (Exception error) {
            Log.w("SmartShield", "Could not restart background sync", error);
        }
    }
}