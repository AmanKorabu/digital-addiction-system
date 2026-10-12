import { useEffect, useState } from "react";
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  MobileOutlined,
  SafetyOutlined,
  BellOutlined,
  LogoutOutlined,
  RightOutlined,
} from "@ant-design/icons";

import { message, Spin, Switch, Modal } from "antd";
import { getNativeDeviceInfo } from "../../services/nativeDeviceService";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import BottomNavigation from "../../components/user/BottomNavigation";
import { logoutUser } from "../../services/authService";
import {
  getUserDevice,
  registerDevice,
} from "../../services/deviceService";
import { auth, db } from "../../config/firebase";

const UserProfileDashboard = () => {
  const [activeTab, setActiveTab] = useState("profile");

  const [userData, setUserData] = useState(null);

  const [deviceData, setDeviceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deviceLoading, setDeviceLoading] = useState(true);

  // Security modal
  const [securityModalOpen, setSecurityModalOpen] = useState(false);

  // Notifications modal
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);

  // Notification settings
  const [notificationSettings, setNotificationSettings] = useState({
    general: true,
    usageLimit: true,
    focusMode: true,
    important: true,
  });

  // Saving notification setting
  const [savingNotification, setSavingNotification] = useState(false);

  // Store current Firebase user UID
  const [currentUserId, setCurrentUserId] = useState(null);

  // Native servies
  // --------------------------------------------------
  // REGISTER ANDROID DEVICE
  // --------------------------------------------------

  const registerAndroidDevice = async (userId) => {
    try {
      const result = await getNativeDeviceInfo();

      if (!result.success) {
        console.error(
          "Unable to get native device information:",
          result.error
        );

        return null;
      }

      const device = result.data;

      const devicePayload = {
        deviceId: device.deviceId,
        userId: userId,
        deviceName: device.deviceName || "Android Device",
        platform: device.platform || "Android",
        model: device.model || "Unknown",
        manufacturer: device.manufacturer || "Unknown",
        androidVersion: device.androidVersion || "Unknown",
      };

      const registrationResult =
        await registerDevice(devicePayload);

      if (!registrationResult.success) {
        console.error(
          "Device registration failed:",
          registrationResult.error
        );

        return null;
      }

      return devicePayload;
    } catch (error) {
      console.error(
        "Register Android Device Error:",
        error
      );

      return null;
    }
  };
  // --------------------------------------------------
  // LOGOUT
  // --------------------------------------------------

  const handleLogout = async () => {
    const success = await logoutUser();

    if (success) {
      message.success("Logged out successfully");
    } else {
      message.error("Logout failed. Please try again.");
    }
  };

  // --------------------------------------------------
  // LOAD USER PROFILE
  // --------------------------------------------------
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setLoading(false);
        setDeviceLoading(false);
        return;
      }

      try {
        setCurrentUserId(currentUser.uid);

        const userRef = doc(db, "users", currentUser.uid);
        const userSnapshot = await getDoc(userRef);

        if (userSnapshot.exists()) {
          const data = userSnapshot.data();

          setUserData(data);

          if (data.notificationSettings) {
            setNotificationSettings({
              general:
                data.notificationSettings.general ?? true,
              usageLimit:
                data.notificationSettings.usageLimit ?? true,
              focusMode:
                data.notificationSettings.focusMode ?? true,
              important:
                data.notificationSettings.important ?? true,
            });
          }
        }

        // --------------------------------------------------
        // LOAD / REGISTER CONNECTED DEVICE
        // --------------------------------------------------

        setDeviceLoading(true);

        const existingDevice = await getUserDevice(
          currentUser.uid
        );

        if (existingDevice) {
          // Device already registered
          setDeviceData(existingDevice);
        } else {
          // No device found → register this Android device
          const registeredDevice = await registerAndroidDevice(
            currentUser.uid
          );

          if (registeredDevice) {
            setDeviceData({
              id: registeredDevice.deviceId,
              ...registeredDevice,
              status: "connected",
            });
          } else {
            setDeviceData(null);
          }
        }


        setDeviceLoading(false);
      } catch (error) {
        console.error("Profile Load Error:", error);
        message.error("Unable to load profile.");
      } finally {
        setDeviceLoading(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // --------------------------------------------------
  // UPDATE NOTIFICATION SETTING
  // --------------------------------------------------

  const handleNotificationChange = async (settingName, checked) => {
    if (!currentUserId) {
      message.error("User session not found.");
      return;
    }

    // Optimistic UI update
    setNotificationSettings((previous) => ({
      ...previous,
      [settingName]: checked,
    }));

    setSavingNotification(true);

    try {
      const userRef = doc(db, "users", currentUserId);

      await updateDoc(userRef, {
        [`notificationSettings.${settingName}`]: checked,
      });

      message.success(
        checked
          ? "Notification enabled"
          : "Notification disabled"
      );
    } catch (error) {
      console.error(
        "Notification Preference Error:",
        error
      );

      // Revert UI if Firestore update fails
      setNotificationSettings((previous) => ({
        ...previous,
        [settingName]: !checked,
      }));

      message.error(
        "Unable to update notification preference."
      );
    } finally {
      setSavingNotification(false);
    }
  };

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spin size="large" />
      </div>
    );
  }

  // --------------------------------------------------
  // PROFILE ERROR
  // --------------------------------------------------

  if (!userData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-5">
        <div className="text-center">
          <p className="text-sm text-slate-500">
            Unable to load your profile.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // USER NAME
  // --------------------------------------------------

  const fullName = userData.fullName || "User";

  // --------------------------------------------------
  // GENERATE INITIALS
  // --------------------------------------------------

  const nameParts = fullName.trim().split(/\s+/);

  let initials =
    nameParts[0]?.charAt(0).toUpperCase() || "U";

  if (nameParts.length > 1) {
    initials +=
      nameParts[nameParts.length - 1]
        ?.charAt(0)
        .toUpperCase();
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 pb-24">

      {/* ==============================================
          HEADER
      ============================================== */}

      <div className="bg-blue-900 px-5 pt-8 pb-10 rounded-b-[32px]">

        <h1 className="text-2xl font-bold text-white">
          Profile
        </h1>


        <p className="mt-1 text-sm text-blue-200">
          Manage your Smart Shield account
        </p>

      </div>


      {/* ==============================================
          PROFILE CARD
      ============================================== */}

      <div className="px-5 -mt-6">

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">

          <div className="flex items-center gap-4">

            {/* Avatar */}

            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center">

              <span className="text-xl font-bold text-blue-600">
                {initials}
              </span>

            </div>


            {/* User information */}

            <div className="min-w-0">

              <h2 className="text-lg font-semibold text-slate-900">
                {fullName}
              </h2>

              <p className="text-sm text-slate-500 truncate">
                {userData.email || "Email not available"}
              </p>

              <span className="inline-flex mt-2 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">

                {userData.status === "active"
                  ? "Active Account"
                  : "Inactive Account"}

              </span>

            </div>

          </div>

        </div>

      </div>


      {/* ==============================================
          ACCOUNT INFORMATION
      ============================================== */}

      <div className="px-5 mt-6">

        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Account Information
        </h2>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">

          {/* Full Name */}

          <div className="flex items-center gap-4 p-4 border-b border-slate-100">

            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">

              <UserOutlined className="text-slate-600" />

            </div>

            <div>

              <p className="text-xs text-slate-400">
                Full Name
              </p>

              <p className="text-sm font-medium text-slate-800">
                {fullName}
              </p>

            </div>

          </div>


          {/* Email */}

          <div className="flex items-center gap-4 p-4 border-b border-slate-100">

            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">

              <MailOutlined className="text-slate-600" />

            </div>

            <div>

              <p className="text-xs text-slate-400">
                Email
              </p>

              <p className="text-sm font-medium text-slate-800">
                {userData.email || "Not available"}
              </p>

            </div>

          </div>


          {/* Phone */}

          <div className="flex items-center gap-4 p-4">

            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">

              <PhoneOutlined className="text-slate-600" />

            </div>

            <div>

              <p className="text-xs text-slate-400">
                Phone
              </p>

              <p className="text-sm font-medium text-slate-800">
                {userData.phone || "Not added"}
              </p>

            </div>

          </div>

        </div>

      </div>


      {/* ==============================================
          CONNECTED DEVICE
      ============================================== */}

      <div className="px-5 mt-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Connected Device
        </h3>

        {deviceLoading ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Spin size="small" />

            <div>
              <p className="text-sm font-medium text-slate-900">
                Loading device...
              </p>

              <p className="text-xs text-slate-500">
                Checking connected device
              </p>
            </div>
          </div>
        ) : deviceData ? (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <MobileOutlined className="text-xl text-blue-600" />
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {deviceData.manufacturer + " " + deviceData.deviceName || "Android Device"}
                </p>

                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${deviceData.status === "connected"
                      ? "bg-green-500"
                      : "bg-slate-400"
                      }`}
                  />

                  <span className="text-xs text-slate-500">
                    {deviceData.status === "connected"
                      ? "Device connected"
                      : "Device disconnected"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                <MobileOutlined className="text-xl text-slate-400" />
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-900">
                  No device connected
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  Connect an Android device to start monitoring.
                </p>
              </div>
            </div>
          </div>
        )}
        
      </div>

      {/* ==============================================
          SETTINGS
      ============================================== */}

      <div className="px-5 mt-6">

        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Settings
        </h3>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">


          {/* ==========================================
              SECURITY & PERMISSIONS BUTTON
          ========================================== */}

          <button
            type="button"
            onClick={() => setSecurityModalOpen(true)}
            className="w-full flex items-center gap-4 p-4 border-b border-slate-100 text-left"
          >

            <SafetyOutlined className="text-xl text-blue-600" />

            <div className="flex-1">

              <p className="text-sm font-semibold text-slate-900">
                Security & Permissions
              </p>

              <p className="text-xs text-slate-500 mt-1">
                Manage app permissions and security settings
              </p>

            </div>

            <RightOutlined className="text-slate-400" />

          </button>


          {/* ==========================================
              SECURITY & PERMISSIONS MODAL
          ========================================== */}

          <Modal
            title={
              <div>

                <h2 className="text-lg font-semibold text-slate-900">
                  Security & Permissions
                </h2>

                <p className="text-xs font-normal text-slate-500 mt-1">
                  Manage permissions required by Smart Shield
                </p>

              </div>
            }
            open={securityModalOpen}
            onCancel={() => setSecurityModalOpen(false)}
            footer={null}
            centered
            width={450}
          >

            <div className="mt-5 space-y-3">


              {/* Usage Access */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">

                  <MobileOutlined className="text-lg text-blue-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Usage Access
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Required to monitor application usage
                  </p>

                </div>

                <span className="text-xs font-medium text-green-600">
                  Enabled
                </span>

              </div>


              {/* Accessibility */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">

                  <SafetyOutlined className="text-lg text-orange-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Accessibility Access
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Required for supported Focus Mode features
                  </p>

                </div>

                <span className="text-xs font-medium text-orange-600">
                  Disabled
                </span>

              </div>


              {/* Notifications */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">

                  <BellOutlined className="text-lg text-green-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Notifications
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Allow Smart Shield notifications
                  </p>

                </div>

                <Switch
                  checked={notificationSettings.general}
                  onChange={(checked) =>
                    handleNotificationChange(
                      "general",
                      checked
                    )
                  }
                  loading={savingNotification}
                  size="small"
                />

              </div>


              {/* Device Security */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">

                  <SafetyOutlined className="text-lg text-purple-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Device Security
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Your device security settings
                  </p>

                </div>

                <span className="text-xs font-medium text-green-600">
                  Protected
                </span>

              </div>


              {/* Information */}

              <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">

                <p className="text-xs leading-5 text-slate-500">
                  Smart Shield requires certain Android permissions
                  to monitor application usage and provide supported
                  digital wellbeing features.
                </p>

              </div>

            </div>

          </Modal>


          {/* ==========================================
              NOTIFICATIONS BUTTON
          ========================================== */}

          <button
            type="button"
            onClick={() => setNotificationModalOpen(true)}
            className="w-full flex items-center gap-4 p-4 text-left"
          >

            <BellOutlined className="text-xl text-blue-600" />

            <div className="flex-1">

              <p className="text-sm font-semibold text-slate-900">
                Notifications
              </p>

              <p className="text-xs text-slate-500 mt-1">
                Manage notification preferences
              </p>

            </div>

            <RightOutlined className="text-slate-400" />

          </button>


          {/* ==========================================
              NOTIFICATIONS MODAL
          ========================================== */}

          <Modal
            title={
              <div>

                <h2 className="text-lg font-semibold text-slate-900">
                  Notifications
                </h2>

                <p className="text-xs font-normal text-slate-500 mt-1">
                  Manage your Smart Shield notification preferences
                </p>

              </div>
            }
            open={notificationModalOpen}
            onCancel={() => setNotificationModalOpen(false)}
            footer={null}
            centered
            width={450}
          >

            <div className="mt-5 space-y-3">


              {/* General Notifications */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">

                  <BellOutlined className="text-lg text-blue-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    General Notifications
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Receive important Smart Shield notifications
                  </p>

                </div>

                <Switch
                  checked={notificationSettings.general}
                  onChange={(checked) =>
                    handleNotificationChange(
                      "general",
                      checked
                    )
                  }
                  loading={savingNotification}
                  size="small"
                />

              </div>


              {/* Usage Limit Alerts */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">

                  <MobileOutlined className="text-lg text-orange-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Usage Limit Alerts
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Get notified when an app reaches its usage limit
                  </p>

                </div>

                <Switch
                  checked={notificationSettings.usageLimit}
                  onChange={(checked) =>
                    handleNotificationChange(
                      "usageLimit",
                      checked
                    )
                  }
                  loading={savingNotification}
                  size="small"
                />

              </div>


              {/* Focus Mode Alerts */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">

                  <SafetyOutlined className="text-lg text-purple-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Focus Mode Alerts
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Receive updates when Focus Mode starts or ends
                  </p>

                </div>

                <Switch
                  checked={notificationSettings.focusMode}
                  onChange={(checked) =>
                    handleNotificationChange(
                      "focusMode",
                      checked
                    )
                  }
                  loading={savingNotification}
                  size="small"
                />

              </div>


              {/* Important Alerts */}

              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200">

                <div className="w-10 h-10 rounded-xl border border-red-100 bg-red-50 flex items-center justify-center">

                  <BellOutlined className="text-lg text-red-600" />

                </div>

                <div className="flex-1">

                  <p className="text-sm font-semibold text-slate-900">
                    Important Alerts
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Security and important account notifications
                  </p>

                </div>

                <Switch
                  checked={notificationSettings.important}
                  onChange={(checked) =>
                    handleNotificationChange(
                      "important",
                      checked
                    )
                  }
                  loading={savingNotification}
                  size="small"
                />

              </div>


              {/* Information */}

              <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">

                <p className="text-xs leading-5 text-slate-500">
                  Notification preferences are saved to your Smart
                  Shield account and will remain active when you
                  sign in again.
                </p>

              </div>

            </div>

          </Modal>

        </div>

      </div>


      {/* ==============================================
          LOGOUT
      ============================================== */}

      <div className="px-5 mt-6">

        <button
          type="button"
          onClick={handleLogout}
          className="w-full h-12 rounded-xl border border-red-200 bg-red-50 text-red-600 font-medium flex items-center justify-center gap-2 hover:bg-red-100 transition"
        >

          <LogoutOutlined />

          Logout

        </button>

      </div>


      {/* ==============================================
          BOTTOM NAVIGATION
      ============================================== */}

      <BottomNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

    </div >
  );
};

export default UserProfileDashboard;