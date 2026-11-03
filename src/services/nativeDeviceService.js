
import { registerPlugin } from "@capacitor/core";

const DeviceInfo = registerPlugin("DeviceInfo");

export const getNativeDeviceInfo = async () => {
    try {
        console.log("DEVICE INFO: Calling native DeviceInfo plugin...");

        const result = await DeviceInfo.getDeviceInfo();

        console.log(
            "DEVICE INFO: Raw native response:",
            JSON.stringify(result, null, 2)
        );

        if (!result) {
            throw new Error("Native plugin returned an empty response.");
        }

        if (result.success === false) {
            throw new Error(
                result.error || "Native DeviceInfo plugin failed."
            );
        }

        const deviceInfo = result.data || result;

        const deviceId =
            deviceInfo.deviceId ||
            deviceInfo.androidId ||
            deviceInfo.id;

        if (!deviceId) {
            console.error(
                "DEVICE INFO: Device ID missing. Received:",
                deviceInfo
            );

            throw new Error(
                "Device ID is missing from the native plugin response. Check DeviceInfoPlugin.java."
            );
        }

        const data = {
            deviceId: String(deviceId),
            deviceName: deviceInfo.deviceName || "Android Device",
            platform: deviceInfo.platform || "Android",
            model: deviceInfo.model || "Unknown",
            manufacturer: deviceInfo.manufacturer || "Unknown",
            androidVersion:
                deviceInfo.androidVersion ||
                deviceInfo.osVersion ||
                "Unknown",
        };

        console.log("DEVICE INFO: Normalized device information:", data);

        return {
            success: true,
            data,
        };

    } catch (error) {
        console.error("Native Device Info Error:", error);

        return {
            success: false,
            error:
                error?.message ||
                "Unable to get Android device information.",
        };
    }
};
