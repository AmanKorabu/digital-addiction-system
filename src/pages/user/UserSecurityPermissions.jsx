
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Button, message, Spin } from "antd";
import { registerPlugin } from "@capacitor/core";

import {
    hasUsageAccess,
    openUsageAccessSettings,
} from "../../services/usageStatsService";

const FocusMode = registerPlugin("FocusMode");

const getPermissionValue = (result, keys) => {
    const values = [
        result,
        result?.data,
        result?.result,
    ];

    for (const value of values) {
        if (typeof value === "boolean") return value;

        if (value && typeof value === "object") {
            for (const key of keys) {
                if (typeof value[key] === "boolean") {
                    return value[key];
                }
            }
        }
    }

    return false;
};

const UserSecurityPermissions = () => {
    const navigate = useNavigate();

    const [usageGranted, setUsageGranted] = useState(false);
    const [overlayGranted, setOverlayGranted] = useState(false);
    const [notificationsGranted, setNotificationsGranted] = useState(false);

    const [checking, setChecking] = useState(true);
    const [busy, setBusy] = useState("");

    const checkPermissions = useCallback(async () => {
        setChecking(true);

        try {
            const [usageResult, overlayResult, notificationResult] =
                await Promise.all([
                    hasUsageAccess(),
                    FocusMode.hasOverlayPermission(),
                    LocalNotifications.checkPermissions(),
                ]);

            setUsageGranted(
                getPermissionValue(usageResult, [
                    "hasAccess",
                    "granted",
                ])
            );

            setOverlayGranted(
                getPermissionValue(overlayResult, [
                    "hasPermission",
                    "granted",
                ])
            );

            setNotificationsGranted(
                notificationResult.display === "granted"
            );

        } catch (error) {
            console.error("Permission check failed:", error);
            message.error("Could not check permissions. Please try again.");
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        let listener;

        const initialize = async () => {
            await checkPermissions();

            try {
                const handle = await App.addListener(
                    "appStateChange",
                    ({ isActive }) => {
                        if (isActive && mounted) {
                            checkPermissions();
                        }
                    }
                );

                if (mounted) {
                    listener = handle;
                } else {
                    handle.remove();
                }
            } catch (error) {
                console.error("App state listener failed:", error);
            }
        };

        initialize();

        return () => {
            mounted = false;
            listener?.remove();
        };
    }, [checkPermissions]);

    const requestUsageAccess = async () => {
        setBusy("usage");

        try {
            await openUsageAccessSettings();
            message.info(
                "Enable Usage Access in Android Settings, then return to Smart Shield."
            );
        } catch (error) {
            console.error("Usage Access error:", error);
            message.error("Could not open Usage Access settings.");
        } finally {
            setBusy("");
        }
    };

    const requestOverlayAccess = async () => {
        setBusy("overlay");

        try {
            await FocusMode.openOverlaySettings();

            message.info(
                "Allow display over other apps, then return to Smart Shield."
            );
        } catch (error) {
            console.error("Overlay permission error:", error);
            message.error("Could not open overlay settings.");
        } finally {
            setBusy("");
        }
    };

    const requestNotifications = async () => {
        setBusy("notifications");

        try {
            const result =
                await LocalNotifications.requestPermissions();

            const granted = result.display === "granted";

            setNotificationsGranted(granted);

            if (granted) {
                message.success("Notification permission granted.");
            } else {
                message.warning(
                    "Notification permission was not granted."
                );
            }
        } catch (error) {
            console.error("Notification permission error:", error);
            message.error("Could not request notification permission.");
        } finally {
            setBusy("");
        }
    };

    const allGranted =
        usageGranted &&
        overlayGranted &&
        notificationsGranted;

    return (
        <main className="min-h-screen bg-slate-50 px-5 py-10">
            <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <h1 className="text-2xl font-bold text-slate-900">
                    Security & Permissions
                </h1>

                <p className="mt-2 text-sm text-slate-600">
                    Grant the required permissions to use Smart Shield
                    monitoring and Focus Mode.
                </p>

                {checking ? (
                    <div className="flex justify-center py-10">
                        <Spin size="large" />
                    </div>
                ) : (
                    <div className="mt-6 space-y-4">

                        <PermissionRow
                            title="Usage Access"
                            description="Allows Smart Shield to read app usage and calculate screen time."
                            granted={usageGranted}
                            loading={busy === "usage"}
                            onAllow={requestUsageAccess}
                        />

                        <PermissionRow
                            title="Display over other apps"
                            description="Allows Focus Mode to display blocking screens over selected apps."
                            granted={overlayGranted}
                            loading={busy === "overlay"}
                            onAllow={requestOverlayAccess}
                        />

                        <PermissionRow
                            title="Notifications"
                            description="Allows Smart Shield to show notifications, including background monitoring notifications."
                            granted={notificationsGranted}
                            loading={busy === "notifications"}
                            onAllow={requestNotifications}
                        />

                    </div>
                )}

                <Button
                    type="primary"
                    size="large"
                    block
                    disabled={!allGranted || checking}
                    className="!mt-6 !h-12 !rounded-xl"
                    onClick={() =>
                        navigate("/user/dashboard", {
                            replace: true,
                        })
                    }
                >
                    {allGranted
                        ? "Continue to Dashboard"
                        : "Allow all required permissions"}
                </Button>

                <Button
                    block
                    className="!mt-3"
                    onClick={checkPermissions}
                    disabled={checking || !!busy}
                >
                    Refresh permission status
                </Button>

            </section>
        </main>
    );
};

const PermissionRow = ({
    title,
    description,
    granted,
    loading,
    onAllow,
}) => (
    <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">

            <div className="flex-1">
                <h2 className="font-semibold text-slate-900">
                    {title}
                </h2>

                <p className="mt-1 text-sm text-slate-600">
                    {description}
                </p>

                <p
                    className={`mt-2 text-sm font-medium ${
                        granted ? "text-green-700" : "text-red-600"
                    }`}
                >
                    {granted ? "Granted" : "Not granted"}
                </p>
            </div>

            <Button
                type={granted ? "default" : "primary"}
                disabled={granted || loading}
                loading={loading}
                onClick={onAllow}
            >
                {granted ? "Allowed" : "Allow"}
            </Button>

        </div>
    </div>
);

export default UserSecurityPermissions;
