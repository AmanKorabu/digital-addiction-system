
import {
    addDoc,
    collection,
    doc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from "firebase/firestore";

import { auth, db } from "../config/firebase";
import { getNativeDeviceInfo } from "./nativeDeviceService";
import { hasUsageAccess, getTodayUsage } from "./usageStatsService";

import {
    hasOverlayPermission,
    getFocusStatus,
    startFocusSession,
    stopFocusSession,
} from "./focusModeService";

// ---------------------------------------------------------
// Constants
// ---------------------------------------------------------

export const DEVICES_COLLECTION = "devices";

// Heartbeat every 10 seconds.
export const HEARTBEAT_MS = 10 * 1000;

// Dashboard considers the device offline after 30 seconds
// without a successful heartbeat.
export const ONLINE_WINDOW_MS = 5 * 1000;

const COMMAND_TTL_MS = 10 * 60 * 1000;
const TOP_APPS_IN_SUMMARY = 10;

export const COMMAND_TYPES = {
    START_FOCUS: "START_FOCUS",
    STOP_FOCUS: "STOP_FOCUS",
    SYNC_NOW: "SYNC_NOW",
};

export const LINK_ERRORS = {
    NOT_LINKED: "NOT_LINKED",
    OTHER_PHONE: "OTHER_PHONE",
    MULTIPLE_UNLINKED_DEVICES: "MULTIPLE_UNLINKED_DEVICES",
    REGISTRATION_FAILED: "REGISTRATION_FAILED",
};

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

export const toMillis = (value) => {
    if (!value) return 0;

    if (typeof value === "number") return value;

    if (typeof value.toMillis === "function") {
        return value.toMillis();
    }

    if (typeof value.toDate === "function") {
        return value.toDate().getTime();
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value.seconds === "number") {
        return value.seconds * 1000;
    }

    return 0;
};

const deviceRef = (deviceId) =>
    doc(db, DEVICES_COLLECTION, deviceId);

// ---------------------------------------------------------
// Device registration
// ---------------------------------------------------------

/**
 * Finds the device document created by the parent.
 * Links this Android phone to that document.
 *
 * This function DOES NOT create a new device document.
 */
export const ensureDeviceRegistered = async (userId) => {
    try {
        const currentUserId = userId || auth.currentUser?.uid;

        if (!currentUserId) {
            throw new Error("User is not authenticated.");
        }

        console.log("DEVICE REGISTRATION: Starting...");
        console.log("DEVICE REGISTRATION: User ID:", currentUserId);

        const native = await getNativeDeviceInfo();

        console.log("DEVICE REGISTRATION: Native response:", native);

        if (!native) {
            throw new Error("Native device information is empty.");
        }

        if (native.success === false) {
            throw new Error(
                native.error || "Unable to retrieve Android device information."
            );
        }

        const info = native.data || native;

        if (!info.deviceId) {
            throw new Error(
                "Device ID is missing from native device information."
            );
        }

        const nativeDeviceId = String(info.deviceId);

        const devicesQuery = query(
            collection(db, DEVICES_COLLECTION),
            where("userId", "==", currentUserId)
        );

        const snapshot = await getDocs(devicesQuery);

        console.log(
            "DEVICE REGISTRATION: Matching documents:",
            snapshot.size
        );

        const records = snapshot.docs;

        if (records.length === 0) {
            return {
                success: false,
                code: LINK_ERRORS.NOT_LINKED,
                error:
                    "No device is assigned to this user. Register the device from the parent dashboard first.",
            };
        }

        const existingDevice = records.find(
            (item) =>
                String(item.data().nativeDeviceId || "") === nativeDeviceId
        );

        const hardwareDetails = {
            deviceName: info.deviceName || "Android Device",
            model: info.model || "Unknown",
            manufacturer: info.manufacturer || "Unknown",
            androidVersion: info.androidVersion || "Unknown",
            platform: info.platform || "Android",
            status: "connected",
            lastSyncAt: serverTimestamp(),
        };

        if (existingDevice) {
            await updateDoc(existingDevice.ref, hardwareDetails);

            console.log(
                "DEVICE REGISTRATION: Existing device refreshed:",
                existingDevice.id
            );

            return {
                success: true,
                deviceId: existingDevice.id,
                nativeDeviceId,
                newlyRegistered: false,
            };
        }

        const unlinkedDevices = records.filter((item) => {
            const data = item.data();

            return (
                data.nativeDeviceId === undefined ||
                data.nativeDeviceId === null ||
                data.nativeDeviceId === ""
            );
        });

        if (unlinkedDevices.length === 0) {
            return {
                success: false,
                code: LINK_ERRORS.OTHER_PHONE,
                error:
                    "This account already has a device linked to another phone.",
            };
        }

        if (unlinkedDevices.length > 1) {
            return {
                success: false,
                code: LINK_ERRORS.MULTIPLE_UNLINKED_DEVICES,
                error:
                    "Multiple unlinked device records were found. Check the parent dashboard.",
            };
        }

        const device = unlinkedDevices[0];

        await updateDoc(device.ref, {
            ...hardwareDetails,
            nativeDeviceId,
        });

        console.log(
            "DEVICE REGISTRATION: Successfully linked:",
            device.id
        );

        return {
            success: true,
            deviceId: device.id,
            nativeDeviceId,
            newlyRegistered: true,
        };

    } catch (error) {
        console.error("Device registration failed:", error);
        console.error("REGISTRATION ERROR CODE:", error?.code);
        console.error("REGISTRATION ERROR MESSAGE:", error?.message);

        return {
            success: false,
            code: error?.code || LINK_ERRORS.REGISTRATION_FAILED,
            error: error?.message || "Device registration failed.",
        };
    }
};

// ---------------------------------------------------------
// Lightweight device heartbeat
// ---------------------------------------------------------

/**
 * Updates only connection status and last successful sync.
 * Called frequently by DeviceSync.jsx.
 */
export const syncDeviceHeartbeat = async (deviceId) => {
    try {
        if (!deviceId) {
            throw new Error("Device document ID is missing.");
        }

        await updateDoc(deviceRef(deviceId), {
            status: "connected",
            lastSyncAt: serverTimestamp(),
        });

        return { success: true };

    } catch (error) {
        console.error("Device heartbeat failed:", error);

        return {
            success: false,
            code: error?.code || "HEARTBEAT_FAILED",
            error: error?.message || "Unable to send heartbeat.",
        };
    }
};

// ---------------------------------------------------------
// Full device status reporting
// ---------------------------------------------------------

export const syncDeviceStatus = async (
    deviceId,
    { includeUsage = false } = {}
) => {
    try {
        if (!deviceId) {
            throw new Error("Device document ID is missing.");
        }

        const [usageAccess, overlay, focus] = await Promise.all([
            hasUsageAccess(),
            hasOverlayPermission(),
            getFocusStatus(),
        ]);

        const permissions = {
            usageAccess: Boolean(
                usageAccess?.success && usageAccess?.hasAccess
            ),
            overlay: Boolean(
                overlay?.success && overlay?.granted
            ),
        };

        const update = {
            status: "connected",
            lastSyncAt: serverTimestamp(),

            permissions,

            focus: {
                active: Boolean(focus?.success && focus?.active),
                startTime: Number(focus?.startTime || 0),
                endTime: Number(focus?.endTime || 0),
                blockedAttempts: Number(focus?.blockedAttempts || 0),
                packageCount: (focus?.packages || []).length,
            },
        };

        if (includeUsage && permissions.usageAccess) {
            const usage = await getTodayUsage();

            if (usage?.success) {
                const apps = usage.data?.apps || [];

                update.usageSummary = {
                    totalScreenTime: Number(
                        usage.data?.totalScreenTime || 0
                    ),

                    appCount: apps.length,

                    apps: apps
                        .slice(0, TOP_APPS_IN_SUMMARY)
                        .map((app) => ({
                            appName:
                                app.appName || app.packageName,
                            packageName: app.packageName,
                            timeMs: Number(
                                app.totalTimeInForeground || 0
                            ),
                        })),

                    updatedAt: serverTimestamp(),
                };
            }
        }

        await updateDoc(deviceRef(deviceId), update);

        return { success: true };

    } catch (error) {
        console.error("Device status sync failed:", error);

        return {
            success: false,
            code: error?.code || "SYNC_FAILED",
            error: error?.message || "Unable to report device status.",
        };
    }
};

// ---------------------------------------------------------
// Mark device offline
// ---------------------------------------------------------

export const markDeviceOffline = async (deviceId) => {
    if (!deviceId) return;

    try {
        await updateDoc(deviceRef(deviceId), {
            status: "disconnected",
            lastSyncAt: serverTimestamp(),
        });
    } catch (error) {
        console.warn("Unable to mark device offline:", error);
    }
};

// ---------------------------------------------------------
// Live device document
// ---------------------------------------------------------

export const subscribeToDevice = (
    deviceId,
    onData,
    onError
) => {
    return onSnapshot(
        deviceRef(deviceId),

        (snapshot) => {
            onData(
                snapshot.exists()
                    ? {
                        id: snapshot.id,
                        ...snapshot.data(),
                    }
                    : null
            );
        },

        (error) => {
            console.error("Device subscription error:", error);

            if (onError) {
                onError(error);
            }
        }
    );
};

// ---------------------------------------------------------
// Remote command execution
// ---------------------------------------------------------

const executeCommand = async (command, deviceId) => {
    const payload = command.payload || {};

    switch (command.type) {
        case COMMAND_TYPES.START_FOCUS: {
            const packages = Array.isArray(payload.packages)
                ? payload.packages
                : [];

            const minutes = Number(
                payload.durationMinutes || 0
            );

            if (packages.length === 0 || minutes < 1) {
                return {
                    success: false,
                    error:
                        "START_FOCUS requires packages and durationMinutes >= 1.",
                };
            }

            return startFocusSession({
                packages,
                durationMs: minutes * 60 * 1000,
            });
        }

        case COMMAND_TYPES.STOP_FOCUS:
            return stopFocusSession();

        case COMMAND_TYPES.SYNC_NOW:
            return syncDeviceStatus(deviceId, {
                includeUsage: true,
            });

        default:
            return {
                success: false,
                error: `Unsupported command: ${command.type}`,
            };
    }
};

// ---------------------------------------------------------
// Process remote commands
// ---------------------------------------------------------

const processCommand = async (deviceId, commandSnapshot) => {
    const command = commandSnapshot.data();
    const ref = commandSnapshot.ref;

    const createdMs =
        toMillis(command.createdAt) || Date.now();

    if (Date.now() - createdMs > COMMAND_TTL_MS) {
        await updateDoc(ref, {
            status: "expired",
            completedAt: serverTimestamp(),
        });

        return;
    }

    await updateDoc(ref, {
        status: "processing",
        startedAt: serverTimestamp(),
    });

    let result;

    try {
        result = await executeCommand(command, deviceId);
    } catch (error) {
        result = {
            success: false,
            error: error?.message || "Command execution failed.",
        };
    }

    await updateDoc(ref, {
        status: result?.success ? "completed" : "failed",

        result: result?.success
            ? { message: "Done" }
            : {
                error: result?.error || "Command failed.",
            },

        completedAt: serverTimestamp(),
    });

    await syncDeviceStatus(deviceId, {
        includeUsage: false,
    });
};

// ---------------------------------------------------------
// Listen for parent commands
// ---------------------------------------------------------

export const subscribeToDeviceCommands = (deviceId) => {
    const handled = new Set();

    const pendingQuery = query(
        collection(
            db,
            DEVICES_COLLECTION,
            deviceId,
            "commands"
        ),
        where("status", "==", "pending")
    );

    return onSnapshot(
        pendingQuery,

        (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type !== "added") return;

                if (handled.has(change.doc.id)) return;

                handled.add(change.doc.id);

                processCommand(
                    deviceId,
                    change.doc
                ).catch((error) => {
                    console.error(
                        "Command processing error:",
                        error
                    );
                });
            });
        },

        (error) => {
            console.error(
                "Command listener error:",
                error
            );
        }
    );
};

// ---------------------------------------------------------
// Admin panel: send command to device
// ---------------------------------------------------------

export const sendDeviceCommand = async (
    deviceId,
    type,
    payload = {}
) => {
    try {
        const created = await addDoc(
            collection(
                db,
                DEVICES_COLLECTION,
                deviceId,
                "commands"
            ),
            {
                type,
                payload,
                status: "pending",
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.uid || null,
            }
        );

        return {
            success: true,
            commandId: created.id,
        };

    } catch (error) {
        console.error("Unable to send device command:", error);

        return {
            success: false,
            error: error?.message || "Unable to send command.",
        };
    }
};
