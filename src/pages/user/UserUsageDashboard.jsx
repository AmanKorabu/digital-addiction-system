import { useEffect, useState } from "react";
import { Button, Spin, message } from "antd";
import {
    ReloadOutlined,
    ClockCircleOutlined,
    AppstoreOutlined,
} from "@ant-design/icons";

import {
    hasUsageAccess,
    openUsageAccessSettings,
    getTodayUsage,
} from "../../services/usageStatsService";
import BottomNavigation from "../../components/user/BottomNavigation";


const UserUsageDashboard = () => {
    const [usageData, setUsageData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("usage");

    const loadUsage = async () => {
        setLoading(true);

        const accessResult = await hasUsageAccess();

        if (!accessResult.success || !accessResult.hasAccess) {
            setLoading(false);

            message.warning(
                "Please allow Usage Access for Smart Shield."
            );

            return;
        }

        const result = await getTodayUsage();

        setLoading(false);

        if (!result.success) {
            message.error(result.error);
            return;
        }

        setUsageData(result.data);
    };

    useEffect(() => {
        loadUsage();
    }, []);

    const formatTotalUsage = (apps = []) => {
        const totalMilliseconds = apps.reduce(
            (total, app) =>
                total + Number(app.totalTimeInForeground || 0),
            0
        );

        const totalMinutes = Math.floor(
            totalMilliseconds / (1000 * 60)
        );

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${minutes}m`;
    };

    const apps = usageData?.apps || [];

    return (
        <div className="min-h-screen bg-slate-50 pb-24">

            {/* Header */}
            <header className="border-b border-slate-200 bg-white">
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

                {/* Usage Summary */}
                {usageData && (
                    <>
                        <section className="rounded-2xl bg-slate-900 p-6 text-white">

                            <p className="text-sm text-slate-300">
                                Today's Screen Time
                            </p>

                            <div className="mt-2 flex items-center gap-3">

                                <ClockCircleOutlined className="text-2xl" />

                                <h2 className="text-4xl font-bold">
                                    {formatTotalUsage(apps)}
                                </h2>

                            </div>

                            <p className="mt-3 text-sm text-slate-400">
                                Total foreground usage detected today
                            </p>

                        </section>

                        {/* Quick Stats */}
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

                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5">

                                <p className="text-xs font-medium text-slate-400">
                                    Last Updated
                                </p>

                                <p className="mt-3 text-sm font-semibold text-slate-900">
                                    {new Date().toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    })}
                                </p>

                            </div>

                        </section>

                        {/* App Usage */}
                        <section className="rounded-2xl border border-slate-200 bg-white">

                            <div className="border-b border-slate-100 px-5 py-4">

                                <h2 className="font-semibold text-slate-900">
                                    App Usage
                                </h2>

                                <p className="mt-1 text-xs text-slate-400">
                                    Highest usage first
                                </p>

                            </div>

                            <div className="divide-y divide-slate-100">

                                {apps.length === 0 ? (

                                    <div className="px-5 py-10 text-center">
                                        <p className="text-sm text-slate-500">
                                            No application usage found.
                                        </p>
                                    </div>

                                ) : (

                                    apps.map((app, index) => (

                                        <div
                                            key={`${app.packageName}-${index}`}
                                            className="flex items-center justify-between px-5 py-4"
                                        >

                                            <div className="min-w-0">

                                                <p className="truncate text-sm font-semibold text-slate-900">
                                                    {app.appName}
                                                </p>

                                                <p className="mt-1 truncate text-xs text-slate-400">
                                                    {app.packageName}
                                                </p>

                                            </div>

                                            <div className="ml-4 shrink-0 text-right">

                                                <p className="text-sm font-semibold text-slate-900">
                                                    {app.formattedUsage}
                                                </p>

                                                <p className="mt-1 text-[11px] text-slate-400">
                                                    #{index + 1}
                                                </p>

                                            </div>

                                        </div>

                                    ))
                                )}

                            </div>

                        </section>

                    </>
                )}

                {/* Usage Access */}
                {!loading && !usageData && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center">

                        <h2 className="font-semibold text-slate-900">
                            Usage Access Required
                        </h2>

                        <p className="mt-2 text-sm text-slate-500">
                            Allow Smart Shield to access application
                            usage data on your Android device.
                        </p>

                        <Button
                            type="primary"
                            className="mt-5"
                            onClick={openUsageAccessSettings}
                        >
                            Open Usage Access Settings
                        </Button>

                    </section>
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