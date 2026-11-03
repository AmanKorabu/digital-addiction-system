import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, InputNumber, Modal, Spin, message } from "antd";
import {
    ReloadOutlined,
    SearchOutlined,
    CheckCircleFilled,
    SafetyCertificateOutlined,
    FireOutlined,
    StopOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from "@ant-design/icons";

import {
    hasUsageAccess,
    openUsageAccessSettings,
    getTodayUsage,
} from "../../services/usageStatsService";
import {
    hasOverlayPermission,
    openOverlaySettings,
    getLaunchableApps,
    startFocusSession,
    stopFocusSession,
    getFocusStatus,
    loadFocusHistory,
    saveFocusSession,
} from "../../services/focusModeService";
import BottomNavigation from "../../components/user/BottomNavigation";

const DURATION_PRESETS = [15, 25, 45, 60];
const TICK_MS = 500;
const STATUS_POLL_MS = 4000;

const RING_RADIUS = 96;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const pad = (value) => String(value).padStart(2, "0");

const formatClock = (milliseconds = 0) => {
    const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
};

const formatMinutes = (milliseconds = 0) => {
    const minutes = Math.round(Number(milliseconds || 0) / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
};

const dayKey = (timestamp) => {
    const date = new Date(timestamp);

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
    )}`;
};

const AppIcon = ({ app, size = "h-11 w-11" }) => {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [app.appIcon, app.packageName]);

    return (
        <div
            className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50`}
        >
            {app.appIcon && !imageFailed ? (
                <img
                    src={app.appIcon}
                    alt={`${app.appName} icon`}
                    className="h-full w-full object-contain p-1"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center bg-blue-50 text-base font-bold text-blue-700">
                    {(app.appName || "A").trim().charAt(0).toUpperCase()}
                </span>
            )}
        </div>
    );
};

const UserFocusDashboard = () => {
    const [activeTab, setActiveTab] = useState("focus");

    const [apps, setApps] = useState([]);
    const [usageRank, setUsageRank] = useState({});
    const [appsLoading, setAppsLoading] = useState(true);
    const [selected, setSelected] = useState([]);
    const [query, setQuery] = useState("");

    const [duration, setDuration] = useState(25);
    const [permissions, setPermissions] = useState({
        checked: false,
        overlay: true,
        usage: true,
    });

    const [session, setSession] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [starting, setStarting] = useState(false);
    const [history, setHistory] = useState(() => loadFocusHistory());

    const sessionRef = useRef(null);
    const finalizingRef = useRef(false);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    // ---------------------------------------------------------
    // Permissions
    // ---------------------------------------------------------

    const checkPermissions = useCallback(async () => {
        const [overlay, usage] = await Promise.all([
            hasOverlayPermission(),
            hasUsageAccess(),
        ]);

        setPermissions({
            checked: true,
            overlay: Boolean(overlay.success && overlay.granted),
            usage: Boolean(usage.success && usage.hasAccess),
        });
    }, []);

    // ---------------------------------------------------------
    // Apps for the picker
    // ---------------------------------------------------------

    const loadApps = useCallback(async () => {
        setAppsLoading(true);

        try {
            const [appsResult, usageResult] = await Promise.all([
                getLaunchableApps(),
                getTodayUsage(),
            ]);

            if (appsResult.success) {
                setApps(appsResult.data?.apps || []);
            } else {
                message.error(appsResult.error || "Unable to load apps.");
            }

            if (usageResult.success) {
                const rank = {};

                (usageResult.data?.apps || []).forEach((app, index) => {
                    rank[app.packageName] = index;
                });

                setUsageRank(rank);
            }
        } finally {
            setAppsLoading(false);
        }
    }, []);

    // ---------------------------------------------------------
    // Session bookkeeping
    // ---------------------------------------------------------

    const recordFinished = useCallback((status) => {
        const startTime = Number(status?.startTime || 0);

        if (!startTime) return;

        const endTime = Number(status.endTime || 0);
        const stoppedAt = Number(status.stoppedAt) || Date.now();

        const record = {
            id: String(startTime),
            startTime,
            plannedMs: Math.max(0, endTime - startTime),
            actualMs: Math.max(0, Math.min(stoppedAt, endTime) - startTime),
            completed: Boolean(status.completed),
            blockedAttempts: Number(status.blockedAttempts || 0),
            appCount: (status.packages || []).length,
        };

        setHistory(saveFocusSession(record));
    }, []);

    /** Reads the native status and updates the screen accordingly. */
    const syncStatus = useCallback(async () => {
        const result = await getFocusStatus();

        if (!result.success) return null;

        if (result.active) {
            setSession({
                startTime: Number(result.startTime),
                endTime: Number(result.endTime),
                packages: result.packages || [],
                blockedAttempts: Number(result.blockedAttempts || 0),
            });

            return result;
        }

        // Not running (any more).
        const wasRunning = Boolean(sessionRef.current);

        sessionRef.current = null;
        setSession(null);

        if (result.startTime) {
            recordFinished(result);

            if (wasRunning) {
                if (result.completed) {
                    message.success("Focus session complete. Great work!");
                } else {
                    message.info("Focus session ended.");
                }
            }
        }

        return result;
    }, [recordFinished]);

    const refreshAll = useCallback(async () => {
        await Promise.all([checkPermissions(), loadApps(), syncStatus()]);
    }, [checkPermissions, loadApps, syncStatus]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    // Re-check permissions when coming back from Android settings.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                checkPermissions();
                syncStatus();
            }
        };

        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [checkPermissions, syncStatus]);

    // Countdown + auto-finish.
    useEffect(() => {
        if (!session) return undefined;

        const timer = setInterval(() => {
            const current = Date.now();

            setNow(current);

            if (current >= session.endTime && !finalizingRef.current) {
                finalizingRef.current = true;

                syncStatus().finally(() => {
                    finalizingRef.current = false;
                });
            }
        }, TICK_MS);

        return () => clearInterval(timer);
    }, [session, syncStatus]);

    // Keep the blocked-attempts counter fresh while running.
    useEffect(() => {
        if (!session) return undefined;

        const poll = setInterval(() => {
            syncStatus();
        }, STATUS_POLL_MS);

        return () => clearInterval(poll);
    }, [session, syncStatus]);

    // ---------------------------------------------------------
    // Actions
    // ---------------------------------------------------------

    const toggleApp = (packageName) => {
        setSelected((current) =>
            current.includes(packageName)
                ? current.filter((item) => item !== packageName)
                : [...current, packageName]
        );
    };

    const pickTopApps = () => {
        const top = apps
            .filter((app) => usageRank[app.packageName] !== undefined)
            .sort(
                (a, b) =>
                    usageRank[a.packageName] - usageRank[b.packageName]
            )
            .slice(0, 3)
            .map((app) => app.packageName);

        if (top.length === 0) {
            message.info("No usage data yet for today.");
            return;
        }

        setSelected(top);
    };

    const handleStart = async () => {
        if (selected.length === 0) {
            message.warning("Pick at least one app to block.");
            return;
        }

        setStarting(true);

        const result = await startFocusSession({
            packages: selected,
            durationMs: Number(duration) * 60 * 1000,
        });

        setStarting(false);

        if (!result.success) {
            message.error(result.error || "Unable to start focus mode.");
            checkPermissions();
            return;
        }

        const nextSession = {
            startTime: Number(result.startTime),
            endTime: Number(result.endTime),
            packages: result.packages || selected,
            blockedAttempts: 0,
        };

        sessionRef.current = nextSession;
        setNow(Date.now());
        setSession(nextSession);
        message.success("Focus mode is on.");
    };

    const handleStop = () => {
        Modal.confirm({
            title: "End focus session?",
            content:
                "Blocked apps will be available again and this session will be saved as ended early.",
            okText: "End session",
            okButtonProps: { danger: true },
            cancelText: "Keep focusing",
            onOk: async () => {
                const result = await stopFocusSession();

                if (!result.success) {
                    message.error(result.error || "Unable to end session.");
                    return;
                }

                sessionRef.current = null;
                setSession(null);
                recordFinished(result);
                message.info("Session ended early.");
            },
        });
    };

    // ---------------------------------------------------------
    // Derived data
    // ---------------------------------------------------------

    const selectedSet = useMemo(() => new Set(selected), [selected]);

    const sortedApps = useMemo(() => {
        return [...apps].sort((a, b) => {
            const rankA = usageRank[a.packageName] ?? 9999;
            const rankB = usageRank[b.packageName] ?? 9999;

            if (rankA !== rankB) return rankA - rankB;

            return (a.appName || "").localeCompare(b.appName || "");
        });
    }, [apps, usageRank]);

    const filteredApps = useMemo(() => {
        const search = query.trim().toLowerCase();

        if (!search) return sortedApps;

        return sortedApps.filter(
            (app) =>
                (app.appName || "").toLowerCase().includes(search) ||
                (app.packageName || "").toLowerCase().includes(search)
        );
    }, [sortedApps, query]);

    const blockedApps = useMemo(() => {
        if (!session) return [];

        const blocked = new Set(session.packages);

        return apps.filter((app) => blocked.has(app.packageName));
    }, [session, apps]);

    const stats = useMemo(() => {
        const todayKey = dayKey(Date.now());
        const todays = history.filter(
            (item) => dayKey(item.startTime) === todayKey
        );

        const focusMs = todays.reduce(
            (sum, item) => sum + Number(item.actualMs || 0),
            0
        );

        const blocked = todays.reduce(
            (sum, item) => sum + Number(item.blockedAttempts || 0),
            0
        );

        const completedDays = new Set(
            history
                .filter((item) => item.completed)
                .map((item) => dayKey(item.startTime))
        );

        let streak = 0;
        const cursor = new Date();

        if (!completedDays.has(dayKey(cursor.getTime()))) {
            cursor.setDate(cursor.getDate() - 1);
        }

        while (completedDays.has(dayKey(cursor.getTime()))) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }

        const week = [];

        for (let offset = 6; offset >= 0; offset -= 1) {
            const date = new Date();
            date.setDate(date.getDate() - offset);

            const key = dayKey(date.getTime());

            const ms = history
                .filter((item) => dayKey(item.startTime) === key)
                .reduce((sum, item) => sum + Number(item.actualMs || 0), 0);

            week.push({
                key,
                label: date.toLocaleDateString([], { weekday: "narrow" }),
                ms,
            });
        }

        return {
            focusMs,
            sessions: todays.length,
            blocked,
            streak,
            week,
            weekMax: Math.max(...week.map((day) => day.ms), 1),
        };
    }, [history]);

    const remainingMs = session ? Math.max(0, session.endTime - now) : 0;
    const plannedMs = session
        ? Math.max(1, session.endTime - session.startTime)
        : Number(duration) * 60 * 1000;

    const progress = session ? Math.min(remainingMs / plannedMs, 1) : 1;
    const ringOffset = RING_CIRCUMFERENCE * (1 - progress);

    const setupMissing =
        permissions.checked && (!permissions.overlay || !permissions.usage);

    const canStart =
        !session &&
        !starting &&
        !setupMissing &&
        selected.length > 0 &&
        Number(duration) >= 1;

    // ---------------------------------------------------------
    // Render
    // ---------------------------------------------------------

    return (
        <div className="min-h-screen bg-slate-50 pb-28 text-slate-900">
            <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
                    <div>
                        <p className="text-xs font-medium text-slate-400">
                            SMART SHIELD
                        </p>
                        <h1 className="text-xl font-bold text-slate-900">
                            Focus Mode
                        </h1>
                    </div>

                    <Button
                        type="text"
                        aria-label="Refresh"
                        icon={<ReloadOutlined />}
                        onClick={refreshAll}
                        loading={appsLoading}
                    />
                </div>
            </header>

            <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-5">
                {/* Setup */}
                {setupMissing && !session && (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                        <div className="flex items-center gap-2">
                            <WarningOutlined className="text-amber-600" />
                            <h2 className="font-semibold text-amber-900">
                                Finish setup to block apps
                            </h2>
                        </div>

                        <p className="mt-2 text-sm text-amber-800">
                            Focus mode needs two Android permissions so it can
                            see which app is open and cover blocked apps.
                        </p>

                        <div className="mt-4 space-y-3">
                            {!permissions.usage && (
                                <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
                                    <div>
                                        <p className="text-sm font-semibold">
                                            Usage access
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Detects the app in the foreground
                                        </p>
                                    </div>
                                    <Button
                                        type="primary"
                                        size="small"
                                        onClick={openUsageAccessSettings}
                                    >
                                        Allow
                                    </Button>
                                </div>
                            )}

                            {!permissions.overlay && (
                                <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
                                    <div>
                                        <p className="text-sm font-semibold">
                                            Display over other apps
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Shows the focus screen on top
                                        </p>
                                    </div>
                                    <Button
                                        type="primary"
                                        size="small"
                                        onClick={openOverlaySettings}
                                    >
                                        Allow
                                    </Button>
                                </div>
                            )}
                        </div>

                        <Button
                            block
                            className="mt-4"
                            onClick={checkPermissions}
                        >
                            I've enabled them
                        </Button>
                    </section>
                )}

                {/* Timer */}
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="relative mx-auto h-[220px] w-[220px]">
                        <svg
                            width="220"
                            height="220"
                            viewBox="0 0 220 220"
                            className="-rotate-90"
                        >
                            <circle
                                cx="110"
                                cy="110"
                                r={RING_RADIUS}
                                fill="none"
                                stroke="#e2e8f0"
                                strokeWidth="12"
                            />
                            <circle
                                cx="110"
                                cy="110"
                                r={RING_RADIUS}
                                fill="none"
                                stroke={session ? "#2563eb" : "#93c5fd"}
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={RING_CIRCUMFERENCE}
                                strokeDashoffset={ringOffset}
                                style={{
                                    transition: "stroke-dashoffset 0.5s linear",
                                }}
                            />
                        </svg>

                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <p className="text-xs font-semibold tracking-wider text-blue-600">
                                {session ? "FOCUSING" : "READY"}
                            </p>
                            <p className="mt-1 text-4xl font-bold tabular-nums">
                                {session
                                    ? formatClock(remainingMs)
                                    : formatClock(plannedMs)}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                                {session
                                    ? `${blockedApps.length || session.packages.length} apps blocked`
                                    : `${selected.length} apps selected`}
                            </p>
                        </div>
                    </div>

                    {session ? (
                        <>
                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl bg-slate-50 p-3 text-center">
                                    <p className="text-[11px] text-slate-400">
                                        Distractions blocked
                                    </p>
                                    <p className="mt-1 text-xl font-bold">
                                        {session.blockedAttempts}
                                    </p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-3 text-center">
                                    <p className="text-[11px] text-slate-400">
                                        Ends at
                                    </p>
                                    <p className="mt-1 text-xl font-bold">
                                        {new Date(
                                            session.endTime
                                        ).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </p>
                                </div>
                            </div>

                            <Button
                                danger
                                block
                                size="large"
                                className="mt-5"
                                icon={<StopOutlined />}
                                onClick={handleStop}
                            >
                                End session
                            </Button>
                        </>
                    ) : (
                        <>
                            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                                {DURATION_PRESETS.map((minutes) => (
                                    <button
                                        key={minutes}
                                        type="button"
                                        onClick={() => setDuration(minutes)}
                                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                                            Number(duration) === minutes
                                                ? "bg-blue-600 text-white"
                                                : "bg-slate-100 text-slate-600"
                                        }`}
                                    >
                                        {minutes} min
                                    </button>
                                ))}
                            </div>

                            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
                                <span>Custom</span>
                                <InputNumber
                                    min={1}
                                    max={240}
                                    value={duration}
                                    onChange={(value) =>
                                        setDuration(value || 1)
                                    }
                                />
                                <span>min</span>
                            </div>

                            <Button
                                type="primary"
                                block
                                size="large"
                                className="mt-5"
                                icon={<ThunderboltOutlined />}
                                loading={starting}
                                disabled={!canStart}
                                onClick={handleStart}
                            >
                                Start focus session
                            </Button>

                            {selected.length === 0 && !setupMissing && (
                                <p className="mt-2 text-center text-xs text-slate-400">
                                    Pick the apps to block below
                                </p>
                            )}
                        </>
                    )}
                </section>

                {/* Blocked apps (running) */}
                {session && (
                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2">
                            <SafetyCertificateOutlined className="text-blue-600" />
                            <h2 className="text-base font-bold">
                                Blocked until the timer ends
                            </h2>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                            {blockedApps.map((app) => (
                                <div
                                    key={app.packageName}
                                    className="flex w-16 flex-col items-center gap-1"
                                >
                                    <AppIcon app={app} />
                                    <span className="w-full truncate text-center text-[11px] text-slate-500">
                                        {app.appName}
                                    </span>
                                </div>
                            ))}

                            {blockedApps.length === 0 && (
                                <p className="text-sm text-slate-500">
                                    {session.packages.length} apps are blocked.
                                </p>
                            )}
                        </div>
                    </section>
                )}

                {/* App picker (idle) */}
                {!session && (
                    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-bold">
                                    Apps to block
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Most used today first
                                </p>
                            </div>

                            <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                                {selected.length} selected
                            </span>
                        </div>

                        <div className="mt-4 flex gap-2">
                            <Button size="small" onClick={pickTopApps}>
                                Pick my top 3
                            </Button>
                            <Button
                                size="small"
                                disabled={selected.length === 0}
                                onClick={() => setSelected([])}
                            >
                                Clear
                            </Button>
                        </div>

                        <Input
                            allowClear
                            className="mt-3"
                            size="large"
                            prefix={
                                <SearchOutlined className="text-slate-400" />
                            }
                            placeholder="Search apps"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />

                        {appsLoading && apps.length === 0 ? (
                            <div className="flex justify-center py-12">
                                <Spin />
                            </div>
                        ) : filteredApps.length === 0 ? (
                            <p className="py-10 text-center text-sm text-slate-500">
                                {query
                                    ? "No matching apps."
                                    : "No apps found."}
                            </p>
                        ) : (
                            <div className="mt-2 max-h-96 divide-y divide-slate-100 overflow-y-auto">
                                {filteredApps.map((app) => {
                                    const isSelected = selectedSet.has(
                                        app.packageName
                                    );

                                    return (
                                        <button
                                            key={app.packageName}
                                            type="button"
                                            onClick={() =>
                                                toggleApp(app.packageName)
                                            }
                                            className="flex w-full items-center gap-3 py-3 text-left"
                                        >
                                            <AppIcon app={app} />

                                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                                {app.appName}
                                            </span>

                                            {isSelected ? (
                                                <CheckCircleFilled className="text-xl text-blue-600" />
                                            ) : (
                                                <span className="h-5 w-5 rounded-full border-2 border-slate-300" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                )}

                {/* Stats */}
                <section className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-xs font-medium text-slate-400">
                            Focus today
                        </p>
                        <p className="mt-3 text-xl font-bold">
                            {formatMinutes(stats.focusMs)}
                        </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-xs font-medium text-slate-400">
                            Blocked
                        </p>
                        <p className="mt-3 text-xl font-bold">
                            {stats.blocked}
                        </p>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-1 text-slate-400">
                            <FireOutlined />
                            <span className="text-xs font-medium">Streak</span>
                        </div>
                        <p className="mt-3 text-xl font-bold">
                            {stats.streak}d
                        </p>
                    </div>
                </section>

                {/* Weekly chart */}
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-bold">This week</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Focus minutes per day
                    </p>

                    <div className="mt-4 flex h-28 items-end justify-between gap-2">
                        {stats.week.map((day) => (
                            <div
                                key={day.key}
                                className="flex flex-1 flex-col items-center gap-1"
                            >
                                <div className="flex h-24 w-full items-end">
                                    <div
                                        className="w-full rounded-t-lg bg-blue-500"
                                        title={formatMinutes(day.ms)}
                                        style={{
                                            height: `${Math.max(
                                                (day.ms / stats.weekMax) * 100,
                                                day.ms > 0 ? 6 : 3
                                            )}%`,
                                            opacity: day.ms > 0 ? 1 : 0.2,
                                        }}
                                    />
                                </div>
                                <span className="text-[11px] text-slate-400">
                                    {day.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Recent sessions */}
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-bold">Recent sessions</h2>

                    {history.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-500">
                            Your finished sessions will appear here.
                        </p>
                    ) : (
                        <div className="mt-2 divide-y divide-slate-100">
                            {history.slice(0, 5).map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between gap-3 py-3"
                                >
                                    <div>
                                        <p className="text-sm font-semibold">
                                            {formatMinutes(item.actualMs)} of{" "}
                                            {formatMinutes(item.plannedMs)}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-400">
                                            {new Date(
                                                item.startTime
                                            ).toLocaleString([], {
                                                month: "short",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}{" "}
                                            · {item.blockedAttempts} blocked
                                        </p>
                                    </div>

                                    <span
                                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                            item.completed
                                                ? "bg-emerald-50 text-emerald-700"
                                                : "bg-slate-100 text-slate-500"
                                        }`}
                                    >
                                        {item.completed
                                            ? "Completed"
                                            : "Ended early"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <WarningOutlined className="mt-0.5 text-slate-400" />
                    <p className="text-xs leading-5 text-slate-500">
                        Focus mode keeps working while Smart Shield is closed.
                        On OPPO / ColorOS, allow auto-launch and set battery
                        usage to "Unrestricted" for Smart Shield so Android
                        doesn't stop it.
                    </p>
                </div>
            </main>

            <BottomNavigation
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
};

export default UserFocusDashboard;