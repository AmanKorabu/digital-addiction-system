import { registerPlugin } from "@capacitor/core";

const UsageStats = registerPlugin("UsageStats");

// =========================================================
// OPEN USAGE ACCESS SETTINGS
// =========================================================

export const openUsageAccessSettings = async () => {
    try {
        await UsageStats.openUsageAccessSettings();
        return {
            success: true,
        };
    } catch (error) {
        console.error("Open Usage Access Error:", error);
        return {
            success: false,
            error: error?.message || "Unable to open Usage Access settings.",
        };
    }
};

// =========================================================
// CHECK USAGE ACCESS
// =========================================================

export const hasUsageAccess = async () => {
    try {
        const result = await UsageStats.hasUsageAccess();
        return {
            success: true,
            hasAccess: Boolean(result?.hasAccess),
        };
    } catch (error) {
        console.error("Usage Access Check Error:", error);
        return {
            success: false,
            hasAccess: false,
            error: error?.message || "Unable to check Usage Access.",
        };
    }
};

// =========================================================
// CHECK BATTERY OPTIMIZATION / BACKGROUND PERMISSION
// =========================================================

export const hasBatteryOptimizationIgnored = async () => {
    try {
        const result = await UsageStats.hasBatteryOptimizationIgnored();
        return {
            success: true,
            isIgnored: Boolean(result?.isIgnored),
        };
    } catch (error) {
        console.error("Battery Optimization Check Error:", error);
        return {
            success: false,
            isIgnored: false,
            error: error?.message || "Unable to check battery optimization state.",
        };
    }
};

// =========================================================
// OPEN BATTERY OPTIMIZATION SETTINGS
// =========================================================

export const openBatteryOptimizationSettings = async () => {
    try {
        await UsageStats.openBatteryOptimizationSettings();
        return { success: true };
    } catch (error) {
        console.error("Open Battery Optimization Error:", error);
        return {
            success: false,
            error: error?.message || "Unable to open battery settings.",
        };
    }
};

// =========================================================
// GET TODAY'S APP USAGE
// =========================================================

export const getTodayUsage = async () => {
    try {
        const result = await UsageStats.getTodayUsage();

        console.log(
            "SMART SHIELD RAW USAGE:",
            JSON.stringify(result, null, 2)
        );

        console.table(
            (result?.apps || []).map((app) => ({
                appName: app.appName,
                packageName: app.packageName,
                usageMinutes: Math.round(
                    (app.totalTimeInForeground || 0) / 60000
                ),
                usageMilliseconds: app.totalTimeInForeground,
            }))
        );

        return {
            success: true,
            data: result,
        };
    } catch (error) {
        console.error("Get Today Usage Error:", error);
        return {
            success: false,
            data: null,
            error: error?.message || "Unable to retrieve application usage.",
        };
    }
};

// =========================================================
// GET TODAY'S SCREEN TIME
// =========================================================

export const getTodayScreenTime = async () => {
    try {
        const result = await UsageStats.getTodayScreenTime();
        return {
            success: true,
            data: result,
        };
    } catch (error) {
        console.error("Get Today Screen Time Error:", error);
        return {
            success: false,
            data: null,
            error: error?.message || "Unable to retrieve today's screen time.",
        };
    }
};