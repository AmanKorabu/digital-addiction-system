import { useState } from "react";
import { Button, message, Spin } from "antd";

import {
    openUsageAccessSettings,
    hasUsageAccess,
    getTodayUsage,
} from "../../services/usageStatsService";
import BottomNavigation from "./BottomNavigation";

const UsageTest = () => {
    const [checking, setChecking] = useState(false);
    const [usageData, setUsageData] = useState(null);
    const [activeTab, setActiveTab] = useState("usage");
    const handleCheckAccess = async () => {
        setChecking(true);

        const result = await hasUsageAccess();

        setChecking(false);

        console.log("USAGE ACCESS RESULT:", result);

        if (result.success && result.hasAccess) {
            message.success("Usage Access is enabled.");
        } else {
            message.warning("Usage Access is not enabled.");
        }
    };

    const handleOpenSettings = async () => {
        const result = await openUsageAccessSettings();

        console.log("OPEN USAGE SETTINGS:", result);

        if (!result.success) {
            message.error(result.error);
        }
    };

    const handleGetUsage = async () => {
        setChecking(true);

        const result = await getTodayUsage();

        setChecking(false);

        console.log("TODAY USAGE RESULT:", result);

        if (!result.success) {
            message.error(result.error);
            return;
        }

        setUsageData(result.data);

        message.success(
            `Usage data received: ${result.data.count} apps`
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 p-5">

            <div className="mx-auto max-w-lg">

                <h1 className="text-2xl font-bold text-slate-900">
                    Usage Monitoring Test
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                    Test Android application usage monitoring.
                </p>

                <div className="mt-6 space-y-3">

                    <Button
                        block
                        onClick={handleCheckAccess}
                        loading={checking}
                    >
                        Check Usage Access
                    </Button>

                    <Button
                        block
                        type="primary"
                        onClick={handleOpenSettings}
                    >
                        Open Usage Access Settings
                    </Button>

                    <Button
                        block
                        onClick={handleGetUsage}
                        loading={checking}
                    >
                        Get Today's Usage
                    </Button>

                </div>

                {checking && (
                    <div className="mt-6 flex justify-center">
                        <Spin />
                    </div>
                )}

                {usageData && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">

                        <h2 className="text-sm font-semibold text-slate-900">
                            Usage Result
                        </h2>

                        <p className="mt-2 text-sm text-slate-600">
                            Applications found:{" "}
                            <strong>{usageData.count}</strong>
                        </p>

                        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-white">
                            {JSON.stringify(
                                usageData,
                                null,
                                2
                            )}
                        </pre>

                    </div>
                )}

            </div>
            <BottomNavigation activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
    );
};

export default UsageTest;