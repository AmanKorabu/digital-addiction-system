import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spin, message } from "antd";
import {
    ReloadOutlined,
    ClockCircleOutlined,
    AppstoreOutlined,
    MobileOutlined,
    WarningOutlined,
    RightOutlined,
} from "@ant-design/icons";

import {
    hasUsageAccess,
    openUsageAccessSettings,
    getTodayUsage,
    getTodayScreenTime,
} from "../../services/usageStatsService";

import BottomNavigation from "../../components/user/BottomNavigation";

const TOP_APPS_LIMIT = 5;

// Must match the route you register for UserUsageDashboard.
const USAGE_DASHBOARD_ROUTE = "/user/usage";

const formatUsage = (milliseconds = 0) => {
    const minutes = Math.floor(Number(milliseconds || 0) / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
    if (hours) return `${hours}h`;
    if (minutes) return `${minutes} min`;
    return "<1 min";
};

const formatPercent = (ratio) => {
    const percent = ratio * 100;

    if (percent <= 0) return "0%";
    if (percent < 1) return "<1%";
    return `${Math.round(percent)}%`;
};

const AppIcon = ({ app }) => {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [app.appIcon, app.packageName]);

    return (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
            {app.appIcon && !imageFailed ? (
                <img
                    src={app.appIcon}
                    alt={`${app.appName} icon`}
                    className="h-full w-full object-contain p-1"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center bg-blue-50 text-lg font-bold text-blue-700">
                    {(app.appName || "A").trim().charAt(0).toUpperCase()}
                </span>
            )}
        </div>
    );
};

const UserDashboard = () => {
    const navigate = useNavigate();

    const [usageData, setUsageData] = useState(null);
    const [screenTime, setScreenTime] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("home");
    const [lastUpdated, setLastUpdated] = useState(null);
    const [accessMissing, setAccessMissing] = useState(false);

    const loadUsage = async () => {
        setLoading(true);

        try {
            const access = await hasUsageAccess();

            if (!access.success || !access.hasAccess) {
                setAccessMissing(true);
                setUsageData(null);
                setScreenTime(null);
                return;
            }

            setAccessMissing(false);

            const [usageResult, timeResult] = await Promise.all([
                getTodayUsage(),
                getTodayScreenTime(),
            ]);

            if (!usageResult.success) {
                message.error(usageResult.error || "Unable to load app usage.");
                return;
            }

            if (!timeResult.success) {
                message.error(timeResult.error || "Unable to load screen time.");
                return;
            }

            setUsageData(usageResult.data);
            setScreenTime(timeResult.data);
            setLastUpdated(new Date());
        } catch {
            message.error("Couldn't load usage data. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsage();
    }, []);

    const apps = useMemo(() => {
        return [...(usageData?.apps || [])].sort(
            (a, b) =>
                Number(b.totalTimeInForeground || 0) -
                Number(a.totalTimeInForeground || 0)
        );
    }, [usageData]);

    const topApps = apps.slice(0, TOP_APPS_LIMIT);

    const totalMilliseconds = Number(
        usageData?.totalScreenTime ?? screenTime?.totalScreenTime ?? 0
    );

    const screenTimeLabel = formatUsage(totalMilliseconds);

    const updatedLabel = lastUpdated
        ? lastUpdated.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "";

    const getRatio = (app) => {
        const duration = Number(app.totalTimeInForeground || 0);

        if (totalMilliseconds <= 0) return 0;

        return Math.min(duration / totalMilliseconds, 1);
    };

    const goToUsageDashboard = () => navigate(USAGE_DASHBOARD_ROUTE);

    return (
        <div className="min-h-screen bg-slate-50 pb-28 text-slate-900">
            <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
                <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                            <MobileOutlined className="text-xl" />
                        </div>
                        <div>
                            <p className="text-xs font-bold tracking-wider text-blue-600">
                                SMART SHIELD
                            </p>
                            <h1 className="text-lg font-bold">
                                Your digital wellbeing
                            </h1>
                        </div>
                    </div>

                    <Button
                        aria-label="Refresh usage"
                        shape="circle"
                        icon={<ReloadOutlined />}
                        onClick={loadUsage}
                        loading={loading}
                    />
                </div>
            </header>

            <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-5">
                {loading && !usageData && (
                    <div className="rounded-3xl border border-slate-200 bg-white py-16 text-center">
                        <Spin size="large" />
                        <p className="mt-4 font-semibold">Loading your activity</p>
                        <p className="mt-1 text-sm text-slate-500">
                            Reading today's device usage…
                        </p>
                    </div>
                )}

                {accessMissing && !loading && (
                    <section className="rounded-3xl border border-blue-100 bg-white p-6 text-center shadow-sm">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <ClockCircleOutlined className="text-2xl" />
                        </div>
                        <h2 className="mt-4 text-lg font-bold">
                            Allow usage access
                        </h2>
                        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                            Smart Shield needs Usage Access permission to show
                            your screen time and most-used apps.
                        </p>
                        <Button
                            type="primary"
                            size="large"
                            className="mt-5"
                            onClick={openUsageAccessSettings}
                        >
                            Open settings
                        </Button>
                        <Button
                            block
                            className="mt-3"
                            onClick={loadUsage}
                        >
                            I've enabled access
                        </Button>
                    </section>
                )}

                {usageData && (
                    <>
                        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 to-indigo-800 p-6 text-white shadow-lg shadow-blue-900/10">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-blue-100">
                                        Your screen time today
                                    </p>
                                    <h2 className="mt-3 text-4xl font-bold tracking-tight">
                                        {screenTime?.formattedScreenTime || screenTimeLabel}
                                    </h2>
                                    <p className="mt-2 text-sm text-blue-100">
                                        Across {apps.length} detected apps
                                    </p>
                                </div>
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                                    <ClockCircleOutlined className="text-2xl" />
                                </div>
                            </div>

                            <div className="mt-6 flex items-center justify-between border-t border-white/20 pt-4 text-xs text-blue-100">
                                <span>Today's activity</span>
                                <span>
                                    {updatedLabel ? `Updated ${updatedLabel}` : "Not updated yet"}
                                </span>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-base font-bold">
                                        Most-used apps
                                    </h2>
                                    <p className="mt-1 text-sm text-slate-500">
                                        See where your time goes
                                    </p>
                                </div>

                                {apps.length > 0 ? (
                                    <Button
                                        type="primary"
                                        size="small"
                                        shape="round"
                                        onClick={goToUsageDashboard}
                                    >
                                        View all
                                    </Button>
                                ) : (
                                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                                        Top {topApps.length}
                                    </span>
                                )}
                            </div>

                            {topApps.length === 0 ? (
                                <div className="py-12 text-center">
                                    <AppstoreOutlined className="text-3xl text-slate-300" />
                                    <p className="mt-3 font-semibold">
                                        No app activity yet
                                    </p>
                                    <p className="mt-1 text-sm text-slate-500">
                                        Refresh after using your phone for a while.
                                    </p>
                                </div>
                            ) : (
                                <div className="mt-3 divide-y divide-slate-100">
                                    {topApps.map((app, index) => {
                                        const ratio = getRatio(app);

                                        return (
                                            <div
                                                key={app.packageName || index}
                                                className="py-4 first:pt-3 last:pb-1"
                                            >
                                                <div className="flex w-full items-center gap-3">
                                                    <AppIcon app={app} />

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-semibold text-slate-400">
                                                                {index + 1}.
                                                            </span>
                                                            <p className="truncate text-sm font-semibold">
                                                                {app.appName || "Unknown app"}
                                                            </p>
                                                        </div>
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            {app.formattedUsage ||
                                                                formatUsage(app.totalTimeInForeground)}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="ml-[60px] mt-3">
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                        <div
                                                            className="h-full rounded-full bg-blue-500 transition-all"
                                                            style={{
                                                                width: `${
                                                                    ratio > 0
                                                                        ? Math.max(ratio * 100, 2)
                                                                        : 0
                                                                }%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <p className="mt-1.5 text-right text-[11px] text-slate-400">
                                                        {formatPercent(ratio)} of detected screen time
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {apps.length > TOP_APPS_LIMIT && (
                                <button
                                    type="button"
                                    onClick={goToUsageDashboard}
                                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-50 py-3 text-sm font-semibold text-blue-700"
                                >
                                    View all {apps.length} apps
                                    <RightOutlined className="text-xs" />
                                </button>
                            )}
                        </section>

                        <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                            <WarningOutlined className="mt-0.5 text-slate-400" />
                            <p className="text-xs leading-5 text-slate-500">
                                Usage is based on activity data provided by Android.
                                It may differ from your phone's Digital Wellbeing total.
                            </p>
                        </div>
                    </>
                )}
            </main>

            <BottomNavigation
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
};

export default UserDashboard;