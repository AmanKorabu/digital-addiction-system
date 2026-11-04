import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";

import { auth, db } from "../config/firebase";
import { getNativeDeviceInfo } from "./nativeDeviceService";
import { hasUsageAccess, getTodayUsage } from "./usageStatsService";

import {
    hasOverlayPermission,
    getFocusStatus,
    startAdminFocusSession,
    stopAdminFocusSession,
} from "./focusModeService";

export const DEVICES_COLLECTION = "devices";

export const HEARTBEAT_MS = 60 * 1000;
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

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
};

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

export const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value === "number") return value;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const deviceRef = (deviceId) =>
    doc(db, DEVICES_COLLECTION, deviceId);

const safeDocId = (value) =>
    String(value).replace(/[^A-Za-z0-9_-]/g, "_");

// ---------------------------------------------------------
// DEVICE REGISTRATION
// ---------------------------------------------------------

const pendingRegistrations = new Map();

export const ensureDeviceRegistered = (userIdInput) => {
    // FIX: Safely resolve userId string, ignoring React Event objects
    const userId = typeof userIdInput === "string" && userIdInput.trim() !== ""
        ? userIdInput
        : auth.currentUser?.uid;

    if (!userId || typeof userId !== "string") {
        return Promise.resolve({
            success: false,
            error: "User ID is missing or invalid.",
        });
    }

    if (pendingRegistrations.has(userId)) {
        return pendingRegistrations.get(userId);
    }

    const task = registerDevice(userId).finally(() => {
        pendingRegistrations.delete(userId);
    });

    pendingRegistrations.set(userId, task);

    return task;
};

const registerDevice = async (userId) => {
    try {
        const native = await getNativeDeviceInfo();

        if (!native?.success || !native.data?.deviceId) {
            throw new Error(
                native?.error || "Could not get the phone device ID."
            );
        }

        const info = native.data;

        const deviceFields = {
            deviceName: info.deviceName || "Android Device",
            model: info.model || "Unknown",
            manufacturer: info.manufacturer || "Unknown",
            androidVersion: info.androidVersion || "Unknown",
            platform: info.platform || "Android",
        };

        const snapshot = await getDocs(
            query(
                collection(db, DEVICES_COLLECTION),
                where("userId", "==", userId)
            )
        );

        const records = snapshot.docs;

        // 1. This phone is already registered.
        const existingDevice = records.find(
            (item) => item.data().nativeDeviceId === info.deviceId
        );

        if (existingDevice) {
            await updateDoc(existingDevice.ref, {
                ...deviceFields,
                status: "connected",
                lastSyncAt: serverTimestamp(),
            });

            return {
                success: true,
                deviceId: existingDevice.id,
                nativeDeviceId: info.deviceId,
                newlyRegistered: false,
            };
        }

        // 2. A parent already created one record for this user.
        const unlinkedDevices = records.filter(
            (item) => !item.data().nativeDeviceId
        );

        if (unlinkedDevices.length === 1) {
            const existing = unlinkedDevices[0];

            await updateDoc(existing.ref, {
                nativeDeviceId: info.deviceId,
                ...deviceFields,
                status: "connected",
                lastSyncAt: serverTimestamp(),
            });

            return {
                success: true,
                deviceId: existing.id,
                nativeDeviceId: info.deviceId,
                newlyRegistered: true,
            };
        }

        // 3. First login on this phone: create the device record.
        const profileSnapshot = await getDoc(doc(db, "users", userId));

        const parentId = profileSnapshot.exists()
            ? profileSnapshot.data().parentId ?? null
            : null;

        const newDeviceId = `${safeDocId(userId)}_${safeDocId(info.deviceId)}`;

        await setDoc(doc(db, DEVICES_COLLECTION, newDeviceId), {
            userId,
            parentId,
            nativeDeviceId: info.deviceId,
            ...deviceFields,
            status: "connected",
            createdAt: serverTimestamp(),
            lastSyncAt: serverTimestamp(),
        });

        return {
            success: true,
            deviceId: newDeviceId,
            nativeDeviceId: info.deviceId,
            newlyRegistered: true,
        };

    } catch (error) {
        console.error("Device registration failed:", error);

        return {
            success: false,
            code: error?.code,
            error: error?.message || "Device registration failed.",
        };
    }
};

// ---------------------------------------------------------
// HEARTBEAT
// ---------------------------------------------------------

export const syncDeviceHeartbeat = async (deviceId) => {
    try {
        if (!deviceId) {
            throw new Error("Device ID is missing.");
        }

        await updateDoc(deviceRef(deviceId), {
            status: "connected",
            lastSyncAt: serverTimestamp(),
        });

        return { success: true };

    } catch (error) {
        console.error("Heartbeat failed:", error);

        return {
            success: false,
            error: error?.message || "Unable to send heartbeat.",
        };
    }
};

// ---------------------------------------------------------
// DEVICE STATUS AND USAGE SYNC
// ---------------------------------------------------------

export const syncDeviceStatus = async (
    deviceId,
    { includeUsage = false } = {}
) => {
    try {
        if (!deviceId) {
            throw new Error("Device ID is missing.");
        }

        const [usageAccess, overlay, focus] = await Promise.all([
            hasUsageAccess(),
            hasOverlayPermission(),
            getFocusStatus(),
        ]);

        const permissions = {
            usageAccess: Boolean(
                usageAccess.success && usageAccess.hasAccess
            ),
            overlay: Boolean(
                overlay.success && overlay.granted
            ),
        };

        const update = {
            status: "connected",
            lastSyncAt: serverTimestamp(),
            permissions,
            focus: {
                active: Boolean(focus.success && focus.active),
                adminControlled: Boolean(
                    focus.success && focus.adminControlled
                ),
                startTime: Number(focus.startTime || 0),
                endTime: Number(focus.endTime || 0),
                blockedAttempts: Number(
                    focus.blockedAttempts || 0
                ),
                packageCount: Array.isArray(focus.packages)
                    ? focus.packages.length
                    : 0,
            },
        };

        if (includeUsage && permissions.usageAccess) {
            const usage = await getTodayUsage();

            if (usage.success) {
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

        return {
            success: true,
            focus: update.focus,
        };

    } catch (error) {
        console.error("Device status sync failed:", error);

        return {
            success: false,
            error: error?.message || "Unable to report device status.",
        };
    }
};

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
// LIVE DEVICE SUBSCRIPTION
// ---------------------------------------------------------

export const subscribeToDevice = (
    deviceId,
    onData,
    onError
) =>
    onSnapshot(
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

// ---------------------------------------------------------
// ADMIN COMMAND EXECUTION ON CHILD DEVICE
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

            if (packages.length === 0) {
                return {
                    success: false,
                    error: "Select at least one application.",
                };
            }

            if (
                !Number.isFinite(minutes) ||
                minutes < 1 ||
                minutes > 1440
            ) {
                return {
                    success: false,
                    error: "Duration must be between 1 and 1440 minutes.",
                };
            }

            return startAdminFocusSession({
                packages,
                durationMs: minutes * 60 * 1000,
            });
        }

        case COMMAND_TYPES.STOP_FOCUS:
            return stopAdminFocusSession();

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
// PROCESS ONE FIRESTORE COMMAND
// ---------------------------------------------------------

const processCommand = async (deviceId, commandSnapshot) => {
    const command = commandSnapshot.data();
    const commandRef = commandSnapshot.ref;

    const createdMs = toMillis(command.createdAt) || Date.now();

    if (Date.now() - createdMs > COMMAND_TTL_MS) {
        await updateDoc(commandRef, {
            status: "expired",
            completedAt: serverTimestamp(),
            result: {
                error: "Command expired because the device was offline.",
            },
        });

        return;
    }

    await updateDoc(commandRef, {
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

    const success = Boolean(result?.success);

    await updateDoc(commandRef, {
        status: success ? "completed" : "failed",
        result: success
            ? {
                message: "Command executed successfully.",
            }
            : {
                error: result?.error || "Command failed.",
            },
        completedAt: serverTimestamp(),
    });

    const syncResult = await syncDeviceStatus(deviceId, {
        includeUsage: false,
    });

    if (!syncResult.success) {
        console.warn(
            "Command completed, but device status sync failed:",
            syncResult.error
        );
    }
};

// ---------------------------------------------------------
// COMMAND LISTENER
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

                const commandId = change.doc.id;

                if (handled.has(commandId)) return;

                handled.add(commandId);

                processCommand(deviceId, change.doc).catch(
                    async (error) => {
                        console.error(
                            "Command processing error:",
                            error
                        );

                        try {
                            await updateDoc(change.doc.ref, {
                                status: "failed",
                                result: {
                                    error:
                                        error?.message ||
                                        "Unable to process command.",
                                },
                                completedAt: serverTimestamp(),
                            });
                        } catch (updateError) {
                            console.error(
                                "Could not update command result:",
                                updateError
                            );
                        }
                    }
                );
            });
        },
        (error) => {
            console.error("Command listener error:", error);
        }
    );
};

// ---------------------------------------------------------
// SEND COMMAND FROM ADMIN DASHBOARD
// ---------------------------------------------------------

export const sendDeviceCommand = async (
    deviceId,
    type,
    payload = {}
) => {
    try {
        if (!deviceId) {
            throw new Error("Device ID is missing.");
        }

        if (!auth.currentUser?.uid) {
            throw new Error("You must be logged in to send commands.");
        }

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
                createdBy: auth.currentUser.uid,
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