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

        console.error(
            "Open Usage Access Error:",
            error
        );

        return {
            success: false,
            error:
                error?.message ||
                "Unable to open Usage Access settings.",
        };
    }
};


// =========================================================
// CHECK USAGE ACCESS
// =========================================================

export const hasUsageAccess = async () => {
    try {

        const result =
            await UsageStats.hasUsageAccess();

        return {
            success: true,
            hasAccess: result.hasAccess,
        };

    } catch (error) {

        console.error(
            "Usage Access Check Error:",
            error
        );

        return {
            success: false,
            hasAccess: false,
            error:
                error?.message ||
                "Unable to check Usage Access.",
        };
    }
};


// =========================================================
// GET TODAY'S APP USAGE
// =========================================================

export const getTodayUsage = async () => {
    try {

        const result =
            await UsageStats.getTodayUsage();

        return {
            success: true,
            data: result,
        };

    } catch (error) {

        console.error(
            "Get Today Usage Error:",
            error
        );

        return {
            success: false,
            data: null,
            error:
                error?.message ||
                "Unable to retrieve application usage.",
        };
    }
};


// =========================================================
// GET TODAY'S SCREEN TIME
// =========================================================

export const getTodayScreenTime = async () => {
    try {

        const result =
            await UsageStats.getTodayScreenTime();

        return {
            success: true,
            data: result,
        };

    } catch (error) {

        console.error(
            "Get Today Screen Time Error:",
            error
        );

        return {
            success: false,
            data: null,
            error:
                error?.message ||
                "Unable to retrieve today's screen time.",
        };
    }
};

