import { registerPlugin } from "@capacitor/core";

const DeviceInfo = registerPlugin("DeviceInfo");

export const getNativeDeviceInfo = async () => {
  try {
    const deviceInfo = await DeviceInfo.getDeviceInfo();

    return {
      success: true,
      data: deviceInfo,
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