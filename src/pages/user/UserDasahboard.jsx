import { useEffect, useMemo, useState } from "react";
import { Button, Spin, message } from "antd";

import {
    ReloadOutlined,
    ClockCircleOutlined,
    AppstoreOutlined,
    ArrowUpOutlined,
    WarningOutlined,
    MobileOutlined,
    RightOutlined,
} from "@ant-design/icons";

import {
    hasUsageAccess,
    openUsageAccessSettings,
    getTodayUsage,
    getTodayScreenTime,
} from "../../services/usageStatsService";

import BottomNavigation from "../../components/user/BottomNavigation";


const UserDashboard = () => {

    const [usageData, setUsageData] = useState(null);
    const [screenTime, setScreenTime] = useState(null);

    const [loading, setLoading] = useState(false);

    const [activeTab, setActiveTab] =
        useState("home");

    const [expandedApp, setExpandedApp] =
        useState(null);

    const [lastUpdated, setLastUpdated] =
        useState(null);


    // =========================================================
    // LOAD USAGE DATA
    // =========================================================

    const loadUsage = async () => {

        setLoading(true);

        try {

            const accessResult =
                await hasUsageAccess();


            if (
                !accessResult.success ||
                !accessResult.hasAccess
            ) {

                setUsageData(null);
                setScreenTime(null);

                message.warning(
                    "Please allow Usage Access for Smart Shield."
                );

                return;
            }


            // Load both values together
            const [
                usageResult,
                screenTimeResult,
            ] = await Promise.all([
                getTodayUsage(),
                getTodayScreenTime(),
            ]);


            if (!usageResult.success) {

                message.error(
                    usageResult.error
                );

                return;
            }


            if (!screenTimeResult.success) {

                message.error(
                    screenTimeResult.error
                );

                return;
            }


            setUsageData(
                usageResult.data
            );


            setScreenTime(
                screenTimeResult.data
            );


            setLastUpdated(
                new Date()
            );


        } catch (error) {

            console.error(
                "Dashboard Usage Error:",
                error
            );

            message.error(
                "Unable to load usage data."
            );

        } finally {

            setLoading(false);
        }
    };


    // =========================================================
    // INITIAL LOAD
    // =========================================================

    useEffect(() => {

        loadUsage();

    }, []);


    // =========================================================
    // APP LIST
    // =========================================================

    const apps =
        usageData?.apps || [];


    // =========================================================
    // TOTAL SCREEN TIME IN MINUTES
    // =========================================================

    const screenTimeMinutes = useMemo(() => {

        if (
            !screenTime?.totalScreenTime
        ) {
            return 0;
        }

        return Math.floor(
            screenTime.totalScreenTime /
            (1000 * 60)
        );

    }, [screenTime]);


    // =========================================================
    // TOP APP
    // =========================================================

    const topApp =
        apps.length > 0
            ? apps[0]
            : null;


    // =========================================================
    // FORMAT LAST UPDATED
    // =========================================================

    const formattedLastUpdated =
        lastUpdated
            ? lastUpdated.toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit",
                }
            )
            : "--";


    // =========================================================
    // APP USAGE PERCENTAGE
    // =========================================================

    const getAppPercentage = (app) => {

        if (
            !app?.totalTimeInForeground ||
            screenTimeMinutes <= 0
        ) {
            return 0;
        }

        const appMinutes =
            Math.floor(
                app.totalTimeInForeground /
                (1000 * 60)
            );

        const percentage =
            (appMinutes /
                screenTimeMinutes) *
            100;

        return Math.min(
            Math.round(percentage),
            100
        );
    };


    // =========================================================
    // FORMAT USAGE
    // =========================================================

    const formatUsage = (milliseconds) => {

        const totalMinutes =
            Math.floor(
                Number(milliseconds || 0) /
                (1000 * 60)
            );

        const hours =
            Math.floor(
                totalMinutes / 60
            );

        const minutes =
            totalMinutes % 60;


        if (hours > 0) {

            return `${hours}h ${minutes}m`;
        }


        return `${minutes}m`;
    };


    // =========================================================
    // REFRESH
    // =========================================================

    const handleRefresh = async () => {

        await loadUsage();

        message.success(
            "Usage data refreshed."
        );
    };


    return (

        <div className="min-h-screen bg-slate-50 pb-24">

            {/* ================================================= */}
            {/* HEADER */}
            {/* ================================================= */}

            <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">

                <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">

                    <div>

                        <p className="text-[10px] font-semibold tracking-[0.18em] text-blue-600">
                            SMART SHIELD
                        </p>

                        <h1 className="mt-0.5 text-xl font-bold text-slate-900">
                            Digital Wellbeing
                        </h1>

                    </div>


                    <Button
                        type="text"
                        shape="circle"
                        icon={
                            <ReloadOutlined
                                className={
                                    loading
                                        ? "animate-spin"
                                        : ""
                                }
                            />
                        }
                        onClick={handleRefresh}
                        loading={loading}
                    />

                </div>

            </header>


            <main className="mx-auto max-w-2xl space-y-5 px-5 py-5">


                {/* ================================================= */}
                {/* INITIAL LOADING */}
                {/* ================================================= */}

                {loading &&
                    !usageData && (

                        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-16 text-center">

                            <Spin size="large" />

                            <p className="mt-4 text-sm font-medium text-slate-700">
                                Reading device usage...
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                                Smart Shield is checking today's activity.
                            </p>

                        </div>
                    )}


                {/* ================================================= */}
                {/* MAIN DASHBOARD */}
                {/* ================================================= */}

                {usageData && (

                    <>

                        {/* ========================================= */}
                        {/* SCREEN TIME CARD */}
                        {/* ========================================= */}

                        <section className="overflow-hidden rounded-3xl bg-slate-900 p-6 text-white shadow-sm">

                            <div className="flex items-start justify-between">

                                <div>

                                    <p className="text-sm font-medium text-slate-400">
                                        Today's Screen Time
                                    </p>

                                    <div className="mt-3 flex items-center gap-3">

                                        <ClockCircleOutlined className="text-2xl text-blue-400" />

                                        <h2 className="text-4xl font-bold tracking-tight">

                                            {screenTime?.formattedScreenTime ||
                                                "0m"}

                                        </h2>

                                    </div>

                                </div>


                                <div className="rounded-2xl bg-white/10 p-3">

                                    <MobileOutlined className="text-xl text-blue-300" />

                                </div>

                            </div>


                            <div className="mt-6 border-t border-white/10 pt-4">

                                <div className="flex items-center justify-between">

                                    <p className="text-xs text-slate-400">
                                        Device usage detected today
                                    </p>

                                    <p className="text-xs font-medium text-slate-300">
                                        Updated {formattedLastUpdated}
                                    </p>

                                </div>

                            </div>

                        </section>


                        {/* ========================================= */}
                        {/* TOP APP */}
                        {/* ========================================= */}

                        {topApp && (

                            <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5">

                                <div className="flex items-center justify-between">

                                    <div className="flex items-center gap-3">

                                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">

                                            <ArrowUpOutlined />

                                        </div>


                                        <div>

                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                                                Most Used App
                                            </p>

                                            <p className="mt-1 text-sm font-bold text-slate-900">

                                                {topApp.appName}

                                            </p>

                                        </div>

                                    </div>


                                    <p className="text-lg font-bold text-slate-900">

                                        {topApp.formattedUsage}

                                    </p>

                                </div>

                            </section>
                        )}


                        {/* ========================================= */}
                        {/* QUICK STATS */}
                        {/* ========================================= */}

                        <section className="grid grid-cols-2 gap-4">


                            <div className="rounded-2xl border border-slate-200 bg-white p-5">

                                <div className="flex items-center gap-2 text-slate-400">

                                    <AppstoreOutlined />

                                    <span className="text-xs font-medium">
                                        Apps Used
                                    </span>

                                </div>


                                <p className="mt-3 text-2xl font-bold text-slate-900">

                                    {apps.length}

                                </p>

                                <p className="mt-1 text-[11px] text-slate-400">
                                    Detected today
                                </p>

                            </div>


                            <div className="rounded-2xl border border-slate-200 bg-white p-5">

                                <div className="flex items-center gap-2 text-slate-400">

                                    <ClockCircleOutlined />

                                    <span className="text-xs font-medium">
                                        Updated
                                    </span>

                                </div>


                                <p className="mt-3 text-lg font-bold text-slate-900">

                                    {formattedLastUpdated}

                                </p>

                                <p className="mt-1 text-[11px] text-slate-400">
                                    Latest device reading
                                </p>

                            </div>

                        </section>


                        {/* ========================================= */}
                        {/* APP USAGE */}
                        {/* ========================================= */}

                        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">


                            <div className="border-b border-slate-100 px-5 py-4">

                                <div className="flex items-center justify-between">

                                    <div>

                                        <h2 className="font-semibold text-slate-900">
                                            App Usage
                                        </h2>

                                        <p className="mt-1 text-xs text-slate-400">
                                            Highest usage first
                                        </p>

                                    </div>


                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500">

                                        {apps.length} apps

                                    </span>

                                </div>

                            </div>


                            <div className="divide-y divide-slate-100">


                                {apps.length === 0 ? (

                                    <div className="px-5 py-12 text-center">

                                        <AppstoreOutlined className="text-3xl text-slate-300" />

                                        <p className="mt-3 text-sm font-medium text-slate-700">
                                            No application usage found
                                        </p>

                                        <p className="mt-1 text-xs text-slate-400">
                                            Try refreshing the dashboard.
                                        </p>

                                    </div>

                                ) : (

                                    apps.map(
                                        (app, index) => {

                                            const percentage =
                                                getAppPercentage(
                                                    app
                                                );

                                            const isExpanded =
                                                expandedApp ===
                                                app.packageName;


                                            return (

                                                <div
                                                    key={`${app.packageName}-${index}`}
                                                    className="cursor-pointer px-5 py-4 transition hover:bg-slate-50"
                                                    onClick={() =>
                                                        setExpandedApp(
                                                            isExpanded
                                                                ? null
                                                                : app.packageName
                                                        )
                                                    }
                                                >

                                                    {/* APP HEADER */}

                                                    <div className="flex items-center justify-between gap-4">

                                                        <div className="min-w-0 flex-1">

                                                            <div className="flex items-center gap-2">

                                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-500">

                                                                    {index + 1}

                                                                </span>


                                                                <p className="truncate text-sm font-semibold text-slate-900">

                                                                    {app.appName}

                                                                </p>

                                                            </div>


                                                            <p className="mt-1 truncate pl-9 text-[11px] text-slate-400">

                                                                {app.packageName}

                                                            </p>

                                                        </div>


                                                        <div className="flex shrink-0 items-center gap-2">

                                                            <p className="text-sm font-semibold text-slate-900">

                                                                {app.formattedUsage}

                                                            </p>


                                                            <RightOutlined
                                                                className={`text-[10px] text-slate-300 transition ${
                                                                    isExpanded
                                                                        ? "rotate-90"
                                                                        : ""
                                                                }`}
                                                            />

                                                        </div>

                                                    </div>


                                                    {/* USAGE BAR */}

                                                    <div className="mt-3 pl-9">

                                                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">

                                                            <div
                                                                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                                                                style={{
                                                                    width: `${percentage}%`,
                                                                }}
                                                            />

                                                        </div>

                                                    </div>


                                                    {/* EXPANDED DETAILS */}

                                                    {isExpanded && (

                                                        <div className="mt-4 rounded-xl bg-slate-50 p-4">

                                                            <div className="grid grid-cols-2 gap-4">

                                                                <div>

                                                                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                                                        Usage
                                                                    </p>

                                                                    <p className="mt-1 text-sm font-semibold text-slate-800">
                                                                        {formatUsage(
                                                                            app.totalTimeInForeground
                                                                        )}
                                                                    </p>

                                                                </div>


                                                                <div>

                                                                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                                                        Share
                                                                    </p>

                                                                    <p className="mt-1 text-sm font-semibold text-slate-800">
                                                                        {percentage}%
                                                                    </p>

                                                                </div>

                                                            </div>


                                                            <div className="mt-3 border-t border-slate-200 pt-3">

                                                                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                                                    Package
                                                                </p>

                                                                <p className="mt-1 break-all text-xs text-slate-500">
                                                                    {app.packageName}
                                                                </p>

                                                            </div>

                                                        </div>

                                                    )}

                                                </div>

                                            );
                                        }
                                    )

                                )}

                            </div>

                        </section>


                        {/* ========================================= */}
                        {/* INFO MESSAGE */}
                        {/* ========================================= */}

                        <div className="flex gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4">

                            <WarningOutlined className="mt-0.5 text-amber-500" />

                            <div>

                                <p className="text-xs font-semibold text-amber-800">
                                    Usage information
                                </p>

                                <p className="mt-1 text-xs leading-5 text-amber-700">
                                    Smart Shield reads usage information
                                    provided by Android. App usage and
                                    device screen-time measurements may
                                    differ slightly from the phone's
                                    built-in Digital Wellbeing screen.
                                </p>

                            </div>

                        </div>

                    </>
                )}


                {/* ================================================= */}
                {/* USAGE ACCESS REQUIRED */}
                {/* ================================================= */}

                {!loading &&
                    !usageData && (

                        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center">

                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">

                                <ClockCircleOutlined className="text-xl" />

                            </div>


                            <h2 className="mt-4 font-semibold text-slate-900">
                                Usage Access Required
                            </h2>


                            <p className="mt-2 text-sm leading-6 text-slate-500">
                                Allow Smart Shield to access
                                application usage data on your
                                Android device.
                            </p>


                            <Button
                                type="primary"
                                className="mt-5"
                                onClick={
                                    openUsageAccessSettings
                                }
                            >
                                Open Usage Access Settings
                            </Button>

                        </section>

                    )}

            </main>


            {/* ================================================= */}
            {/* BOTTOM NAVIGATION */}
            {/* ================================================= */}

            <BottomNavigation
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />

        </div>
    );
};


export default UserDashboard;

