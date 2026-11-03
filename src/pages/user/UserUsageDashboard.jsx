import { useEffect, useMemo, useState } from "react";
import { Button, Input, Spin, message } from "antd";
import {
    ReloadOutlined,
    ClockCircleOutlined,
    AppstoreOutlined,
    SearchOutlined,
    RightOutlined,
    WarningOutlined,
} from "@ant-design/icons";

import {
    hasUsageAccess,
    openUsageAccessSettings,
    getTodayUsage,
} from "../../services/usageStatsService";
import BottomNavigation from "../../components/user/BottomNavigation";

const SEGMENT_COLORS = [
    "bg-blue-500",
    "bg-indigo-500",
    "bg-sky-400",
    "bg-violet-500",
    "bg-cyan-500",
];

const formatUsage = (milliseconds = 0) => {
    const minutes = Math.floor(Number(milliseconds || 0) / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
    if (hours) return `${hours}h`;
    if (minutes) return `${minutes}m`;
    return "<1m";
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
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
            {app.appIcon && !imageFailed ? (
                <img
                    src={app.appIcon}
                    alt={`${app.appName} icon`}
                    className="h-full w-full object-contain p-1"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center bg-slate-100 text-base font-bold text-slate-600">
                    {(app.appName || "A").trim().charAt(0).toUpperCase()}
                </span>
            )}
        </div>
    );
};

const UserUsageDashboard = () => {
    const [usageData, setUsageData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("usage");
    const [accessMissing, setAccessMissing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [expandedApp, setExpandedApp] = useState(null);
    const [query, setQuery] = useState("");

    const loadUsage = async () => {
        setLoading(true);

        try {
            const accessResult = await hasUsageAccess();

            if (!accessResult.success || !accessResult.hasAccess) {
                setAccessMissing(true);
                setUsageData(null);
                message.warning("Please allow Usage Access for Smart Shield.");
                return;
            }

            setAccessMissing(false);

            const result = await getTodayUsage();

            if (!result.success) {
                message.error(result.error || "Unable to load app usage.");
                return;
            }

            setUsageData(result.data);
            setLastUpdated(new Date());
        } catch {
            message.error("Couldn't load usage data. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsage();
        window.scrollTo({ top: 0 });
    }, []);

    // Highest usage first.
    const apps = useMemo(() => {
        return [...(usageData?.apps || [])].sort(
            (a, b) =>
                Number(b.totalTimeInForeground || 0) -
                Number(a.totalTimeInForeground || 0)
        );
    }, [usageData]);

    // Prefer the native total; fall back to summing the apps.
    const totalMilliseconds = useMemo(() => {
        const nativeTotal = Number(usageData?.totalScreenTime);

        if (Number.isFinite(nativeTotal) && nativeTotal > 0) {
            return nativeTotal;
        }

        return apps.reduce(
            (total, app) => total + Number(app.totalTimeInForeground || 0),
            0
        );
    }, [usageData, apps]);

    const getRatio = (app) => {
        if (totalMilliseconds <= 0) return 0;

        return Math.min(
            Number(app.totalTimeInForeground || 0) / totalMilliseconds,
            1
        );
    };

    const filteredApps = useMemo(() => {
        const search = query.trim().toLowerCase();

        if (!search) return apps;

        return apps.filter(
            (app) =>
                (app.appName || "").toLowerCase().includes(search) ||
                (app.packageName || "").toLowerCase().includes(search)
        );
    }, [apps, query]);

    // Stacked share bar: top 5 apps + "Others".
    const segments = useMemo(() => {
        const top = apps.slice(0, 5).map((app, index) => ({
            key: app.packageName || index,
            name: app.appName || "Unknown app",
            ratio: getRatio(app),
            color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
        }));

        const used = top.reduce((sum, item) => sum + item.ratio, 0);
        const others = Math.max(1 - used, 0);

        if (apps.length > 5 && others > 0.005) {
            top.push({
                key: "others",
                name: "Others",
                ratio: others,
                color: "bg-slate-300",
            });
        }

        return top;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apps, totalMilliseconds]);

    const updatedLabel = lastUpdated
        ? lastUpdated.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
          })
        : "--";

    const mostUsedApp = apps[0];

    return (
        <div className="min-h-screen bg-slate-50 pb-24">
            {/* Header */}
            <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
                    <div>
                        <p className="text-xs font-medium text-slate-400">
                            SMART SHIELD
                        </p>

                        <h1 className="text-xl font-bold text-slate-900">
                            Usage Dashboard
                        </h1>
                    </div>

                    <Button
                        type="text"
                        aria-label="Refresh usage"
                        icon={<ReloadOutlined />}
                        onClick={loadUsage}
                        loading={loading}
                    />
                </div>
            </header>

            <main className="mx-auto max-w-2xl space-y-5 px-5 py-5">
                {/* Loading */}
                {loading && !usageData && (
                    <div className="flex justify-center py-16">
                        <Spin size="large" />
                    </div>
                )}

                {/* Usage Access */}
                {accessMissing && !loading && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
                        <h2 className="font-semibold text-slate-900">
                            Usage Access Required
                        </h2>

                        <p className="mt-2 text-sm text-slate-500">
                            Allow Smart Shield to access application usage
                            data on your Android device.
                        </p>

                        <Button
                            type="primary"
                            className="mt-5"
                            onClick={openUsageAccessSettings}
                        >
                            Open Usage Access Settings
                        </Button>

                        <Button block className="mt-3" onClick={loadUsage}>
                            I've enabled access
                        </Button>
                    </section>
                )}

                {usageData && (
                    <>
                        {/* Usage Summary */}
                        <section className="rounded-2xl bg-slate-900 p-6 text-white">
                            <p className="text-sm text-slate-300">
                                Today's Screen Time
                            </p>

                            <div className="mt-2 flex items-center gap-3">
                                <ClockCircleOutlined className="text-2xl" />

                                <h2 className="text-4xl font-bold">
                                    {formatUsage(totalMilliseconds)}
                                </h2>
                            </div>

                            <p className="mt-3 text-sm text-slate-400">
                                Total foreground usage detected today
                            </p>
                        </section>

                        {/* Quick Stats */}
                        <section className="grid grid-cols-3 gap-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center gap-2 text-slate-400">
                                    <AppstoreOutlined />
                                    <span className="text-xs font-medium">
                                        Apps Used
                                    </span>
                                </div>

                                <p className="mt-3 text-2xl font-bold text-slate-900">
                                    {apps.length}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <p className="text-xs font-medium text-slate-400">
                                    Top App
                                </p>

                                <p className="mt-3 truncate text-sm font-semibold text-slate-900">
                                    {mostUsedApp?.appName || "--"}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <p className="text-xs font-medium text-slate-400">
                                    Last Updated
                                </p>

                                <p className="mt-3 text-sm font-semibold text-slate-900">
                                    {updatedLabel}
                                </p>
                            </div>
                        </section>

                        {/* Time split */}
                        {apps.length > 0 && (
                            <section className="rounded-2xl border border-slate-200 bg-white p-5">
                                <h2 className="font-semibold text-slate-900">
                                    How your time is split
                                </h2>

                                <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                                    {segments.map((segment) => (
                                        <div
                                            key={segment.key}
                                            className={`h-full ${segment.color}`}
                                            style={{
                                                width: `${segment.ratio * 100}%`,
                                            }}
                                            title={`${segment.name} ${formatPercent(segment.ratio)}`}
                                        />
                                    ))}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                                    {segments.map((segment) => (
                                        <div
                                            key={segment.key}
                                            className="flex items-center gap-1.5 text-[11px] text-slate-500"
                                        >
                                            <span
                                                className={`h-2 w-2 rounded-full ${segment.color}`}
                                            />
                                            <span className="max-w-[90px] truncate">
                                                {segment.name}
                                            </span>
                                            <span className="font-semibold text-slate-700">
                                                {formatPercent(segment.ratio)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* App Usage */}
                        <section className="rounded-2xl border border-slate-200 bg-white">
                            <div className="border-b border-slate-100 px-5 py-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h2 className="font-semibold text-slate-900">
                                            App Usage
                                        </h2>

                                        <p className="mt-1 text-xs text-slate-400">
                                            Highest usage first
                                        </p>
                                    </div>

                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                        {filteredApps.length} apps
                                    </span>
                                </div>

                                <Input
                                    allowClear
                                    className="mt-4"
                                    prefix={
                                        <SearchOutlined className="text-slate-400" />
                                    }
                                    placeholder="Search apps"
                                    value={query}
                                    onChange={(event) =>
                                        setQuery(event.target.value)
                                    }
                                />
                            </div>

                            <div className="divide-y divide-slate-100">
                                {filteredApps.length === 0 ? (
                                    <div className="px-5 py-10 text-center">
                                        <p className="text-sm text-slate-500">
                                            {query
                                                ? "No matching apps."
                                                : "No application usage found."}
                                        </p>
                                    </div>
                                ) : (
                                    filteredApps.map((app) => {
                                        const ratio = getRatio(app);
                                        const rank = apps.indexOf(app) + 1;
                                        const isExpanded =
                                            expandedApp === app.packageName;

                                        return (
                                            <div
                                                key={app.packageName}
                                                className="px-5 py-4"
                                            >
                                                <button
                                                    type="button"
                                                    className="flex w-full items-center gap-3 text-left"
                                                    onClick={() =>
                                                        setExpandedApp(
                                                            isExpanded
                                                                ? null
                                                                : app.packageName
                                                        )
                                                    }
                                                >
                                                    <AppIcon app={app} />

                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-semibold text-slate-900">
                                                            {app.appName ||
                                                                "Unknown app"}
                                                        </p>

                                                        <p className="mt-1 text-[11px] text-slate-400">
                                                            #{rank} ·{" "}
                                                            {formatPercent(ratio)}{" "}
                                                            of screen time
                                                        </p>
                                                    </div>

                                                    <div className="shrink-0 text-right">
                                                        <p className="text-sm font-semibold text-slate-900">
                                                            {app.formattedUsage ||
                                                                formatUsage(
                                                                    app.totalTimeInForeground
                                                                )}
                                                        </p>
                                                    </div>

                                                    {/* <RightOutlined
                                                        className={`text-xs text-slate-300 transition-transform ${
                                                            isExpanded
                                                                ? "rotate-90"
                                                                : ""
                                                        }`}
                                                    /> */}
                                                </button>

                                                <div className="ml-14 mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                                    <div
                                                        className="h-full rounded-full bg-slate-800 transition-all"
                                                        style={{
                                                            width: `${
                                                                ratio > 0
                                                                    ? Math.max(
                                                                          ratio * 100,
                                                                          2
                                                                      )
                                                                    : 0
                                                            }%`,
                                                        }}
                                                    />
                                                </div>

                                                {/* {isExpanded && (
                                                    <div className="ml-14 mt-3 rounded-xl bg-slate-50 p-3">
                                                        <p className="text-xs font-medium text-slate-500">
                                                            Package name
                                                        </p>
                                                        <p className="mt-1 break-all text-xs text-slate-700">
                                                            {app.packageName}
                                                        </p>
                                                    </div>
                                                )} */}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </section>

                        <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                            <WarningOutlined className="mt-0.5 text-slate-400" />
                            <p className="text-xs leading-5 text-slate-500">
                                Usage is based on activity data provided by
                                Android. It may differ from your phone's Digital
                                Wellbeing total.
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

export default UserUsageDashboard;