import { Capacitor, registerPlugin } from "@capacitor/core";

const BackgroundSync = registerPlugin("BackgroundSync");

const run = async (action, fallbackError) => {
    try {
        const data = (await action()) || {};
        return { success: true, data, ...data };
    } catch (error) {
        return {
            success: false,
            error: error?.message || fallbackError,
        };
    }
};

// Hands the signed-in user to the native service so it can keep the
// device "online" even when the app window is closed.
export const startBackgroundSync = (user, deviceId) => {
    if (!Capacitor.isNativePlatform()) {
        return Promise.resolve({
            success: false,
            error: "Background sync works only inside the Android app.",
        });
    }

    return run(
        () =>
            BackgroundSync.start({
                deviceId,
                projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
                apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
                refreshToken: user?.refreshToken || "",
            }),
        "Unable to start background sync."
    );
};

export const stopBackgroundSync = () => {
    if (!Capacitor.isNativePlatform()) {
        return Promise.resolve({ success: true });
    }

    return run(
        () => BackgroundSync.stop(),
        "Unable to stop background sync."
    );
};

export const getBackgroundSyncStatus = () =>
    run(
        () => BackgroundSync.getStatus(),
        "Unable to read background sync status."
    );

export const isBatteryUnrestricted = () =>
    run(
        () => BackgroundSync.isBatteryUnrestricted(),
        "Unable to check battery setting."
    );

export const requestBatteryUnrestricted = () =>
    run(
        () => BackgroundSync.requestBatteryUnrestricted(),
        "Unable to open battery settings."
    );

export const openAutoStartSettings = () =>
    run(
        () => BackgroundSync.openAutoStartSettings(),
        "Unable to open auto-start settings."
    );