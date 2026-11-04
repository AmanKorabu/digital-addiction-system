
import { registerPlugin } from "@capacitor/core";

const FocusMode = registerPlugin("FocusMode");

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

export const hasOverlayPermission = () =>
    run(() => FocusMode.hasOverlayPermission(), "Unable to check overlay permission.");

export const openOverlaySettings = () =>
    run(() => FocusMode.openOverlaySettings(), "Unable to open overlay settings.");

export const hasAccessibilityPermission = () =>
    run(
        () => FocusMode.hasAccessibilityPermission(),
        "Unable to check accessibility permission."
    );

export const openAccessibilitySettings = () =>
    run(
        () => FocusMode.openAccessibilitySettings(),
        "Unable to open accessibility settings."
    );

export const getLaunchableApps = () =>
    run(() => FocusMode.getLaunchableApps(), "Unable to load installed apps.");

// Normal user session. Admin control is deliberately not exposed here.
export const startFocusSession = ({ packages, durationMs }) =>
    run(
        () => FocusMode.startFocusSession({ packages, durationMs }),
        "Unable to start focus mode."
    );

// Normal user stop. Native Android code will reject this for admin-controlled sessions.
export const stopFocusSession = () =>
    run(() => FocusMode.stopFocusSession(), "Unable to stop focus mode.");

// Reserved for the remote admin-command handler.
export const startAdminFocusSession = ({ packages, durationMs }) =>
    run(
        () => FocusMode.startAdminFocusSession({ packages, durationMs }),
        "Unable to start administrator focus mode."
    );

export const stopAdminFocusSession = () =>
    run(
        () => FocusMode.stopAdminFocusSession(),
        "Unable to stop administrator focus mode."
    );

export const getFocusStatus = () =>
    run(() => FocusMode.getFocusStatus(), "Unable to read focus status.");

const HISTORY_KEY = "smartshield_focus_history";
const MAX_HISTORY = 200;

export const loadFocusHistory = () => {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const saveFocusSession = (session) => {
    const history = loadFocusHistory();

    if (history.some((item) => item.id === session.id)) {
        return history;
    }

    const next = [session, ...history].slice(0, MAX_HISTORY);

    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
        // Storage may be unavailable.
    }

    return next;
};
