import { registerPlugin } from "@capacitor/core";

const FocusMode = registerPlugin("FocusMode");

/**
 * Same result shape as usageStatsService:
 *   { success: true, data, ...data }  or  { success: false, error }
 */
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

export const startFocusSession = ({ packages, durationMs }) =>
    run(
        () => FocusMode.startFocusSession({ packages, durationMs }),
        "Unable to start focus mode."
    );

export const stopFocusSession = () =>
    run(() => FocusMode.stopFocusSession(), "Unable to stop focus mode.");

export const getFocusStatus = () =>
    run(() => FocusMode.getFocusStatus(), "Unable to read focus status.");

// ---------------------------------------------------------
// Local focus history (kept on the device)
// ---------------------------------------------------------

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

/** Saves one finished session. Sessions are de-duplicated by `id`. */
export const saveFocusSession = (session) => {
    const history = loadFocusHistory();

    if (history.some((item) => item.id === session.id)) {
        return history;
    }

    const next = [session, ...history].slice(0, MAX_HISTORY);

    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable; the in-memory list still works.
    }

    return next;
};