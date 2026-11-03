import { useCallback, useEffect, useRef, useState } from "react";
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  MobileOutlined,
  SafetyOutlined,
  BellOutlined,
  LogoutOutlined,
  RightOutlined,
  ReloadOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  WarningOutlined,
} from "@ant-design/icons";

import { Button, message, Spin, Switch, Modal } from "antd";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import BottomNavigation from "../../components/user/BottomNavigation";
import { logoutUser } from "../../services/authService";
import { auth, db } from "../../config/firebase";
import {
  hasUsageAccess,
  openUsageAccessSettings,
} from "../../services/usageStatsService";
import {
  hasOverlayPermission,
  openOverlaySettings,
} from "../../services/focusModeService";
import {
  ONLINE_WINDOW_MS,
  ensureDeviceRegistered,
  markDeviceOffline,
  subscribeToDevice,
  syncDeviceStatus,
  toMillis,
} from "../../services/deviceControlService";

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const DEFAULT_NOTIFICATIONS = {
  general: true,
  usageLimit: true,
  focusMode: true,
  important: true,
};

// The label the parent gave the device (for example "Aarav's phone").
const getDeviceTitle = (device) =>
  (device?.deviceName || "").trim() || "Android device";

// What the phone itself reports (for example "OPPO CPH2251").
const getDeviceSubtitle = (device) => {
  const manufacturer = (device?.manufacturer || "").trim();
  const model = (device?.model || "").trim();

  if (!manufacturer && !model) return "";

  if (
    manufacturer &&
    model.toLowerCase().startsWith(manufacturer.toLowerCase())
  ) {
    return model;
  }

  return [manufacturer, model].filter(Boolean).join(" ");
};

const formatLastSeen = (timestamp, now) => {
  if (!timestamp) return "Never";

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours} h ago`;

  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

const PermissionRow = ({ icon, tone, title, description, granted, onAllow }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
    >
      {icon}
    </div>

    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>

    {granted ? (
      <span className="flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircleFilled /> Enabled
      </span>
    ) : onAllow ? (
      <Button size="small" type="primary" onClick={onAllow}>
        Allow
      </Button>
    ) : (
      <span className="flex items-center gap-1 text-xs font-medium text-red-500">
        <CloseCircleFilled /> Off
      </span>
    )}
  </div>
);

const NotificationRow = ({
  icon,
  tone,
  title,
  description,
  checked,
  saving,
  onChange,
}) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
    >
      {icon}
    </div>

    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>

    <Switch
      size="small"
      checked={checked}
      loading={saving}
      onChange={onChange}
    />
  </div>
);

// --------------------------------------------------
// PAGE
// --------------------------------------------------

const UserProfileDashboard = () => {
  const [activeTab, setActiveTab] = useState("profile");

  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Device (live from Firestore)
  const [deviceId, setDeviceId] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [deviceError, setDeviceError] = useState("");

  // Real Android permission state
  const [permissions, setPermissions] = useState({
    checked: false,
    usage: false,
    overlay: false,
  });

  // Ticks so "online / last seen" stays fresh
  const [clock, setClock] = useState(Date.now());

  // Modals
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);

  // Notification preferences (saved per user in Firestore)
  const [notificationSettings, setNotificationSettings] =
    useState(DEFAULT_NOTIFICATIONS);
  const [savingKey, setSavingKey] = useState(null);

  const unsubscribeDeviceRef = useRef(null);

  // --------------------------------------------------
  // PERMISSIONS (real status, not hard-coded)
  // --------------------------------------------------

  const checkPermissions = useCallback(async () => {
    const [usage, overlay] = await Promise.all([
      hasUsageAccess(),
      hasOverlayPermission(),
    ]);

    setPermissions({
      checked: true,
      usage: Boolean(usage.success && usage.hasAccess),
      overlay: Boolean(overlay.success && overlay.granted),
    });
  }, []);

  // --------------------------------------------------
  // DEVICE: auto-register, then follow the backend document live
  // --------------------------------------------------

  const loadDevice = useCallback(async (userId) => {
    setDeviceLoading(true);
    setDeviceError("");

    const registration = await ensureDeviceRegistered(userId);

    if (!registration.success) {
      setDeviceData(null);
      setDeviceError(registration.error || "Unable to register this device.");
      setDeviceLoading(false);
      return;
    }

    setDeviceId(registration.deviceId);

    if (unsubscribeDeviceRef.current) {
      unsubscribeDeviceRef.current();
    }

    unsubscribeDeviceRef.current = subscribeToDevice(
      registration.deviceId,
      (data) => {
        setDeviceData(data);
        setDeviceLoading(false);
      },
      () => {
        setDeviceError("Unable to read the device from the server.");
        setDeviceLoading(false);
      }
    );

    // Update device status and report any failure.
    const syncResult = await syncDeviceStatus(
      registration.deviceId,
      { includeUsage: true }
    );

    if (syncResult.success) {
      console.log("Device status sync successful.");
    } else {
      console.error(
        "Device status sync failed:",
        syncResult.error
      );
    }
  }, []);

  // --------------------------------------------------
  // LOAD PROFILE + DEVICE
  // --------------------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUserData(null);
        setCurrentUserId(null);
        setLoading(false);
        setDeviceLoading(false);
        return;
      }

      setCurrentUserId(currentUser.uid);

      // Fallback keeps the page usable if the Firestore profile is missing.
      const fallbackProfile = {
        fullName: currentUser.displayName || "User",
        email: currentUser.email || "",
        phone: currentUser.phoneNumber || "",
        status: "active",
      };

      try {
        const snapshot = await getDoc(doc(db, "users", currentUser.uid));

        if (snapshot.exists()) {
          const data = snapshot.data();

          setUserData({ ...fallbackProfile, ...data });

          setNotificationSettings({
            ...DEFAULT_NOTIFICATIONS,
            ...(data.notificationSettings || {}),
          });
        } else {
          setUserData(fallbackProfile);
          message.warning(
            "Profile document not found. Showing account information."
          );
        }
      } catch (error) {
        console.error("Firestore profile loading error:", error);
        setUserData(fallbackProfile);

        message.error(
          error.code === "permission-denied"
            ? "Firestore permission denied. Check your security rules."
            : "Could not load the saved profile. Showing account information."
        );
      } finally {
        // Show the page now; the device section loads on its own.
        setLoading(false);
      }

      loadDevice(currentUser.uid);
      checkPermissions();
    });

    return () => {
      unsubscribe();

      if (unsubscribeDeviceRef.current) {
        unsubscribeDeviceRef.current();
      }
    };
  }, [loadDevice, checkPermissions]);

  // Re-check permissions after returning from Android settings.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        checkPermissions();
        setClock(Date.now());
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [checkPermissions]);

  // Keep "last seen" and online state fresh.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);

    return () => clearInterval(timer);
  }, []);

  // --------------------------------------------------
  // ACTIONS
  // --------------------------------------------------

  const handleRefreshDevice = async () => {
    if (!currentUserId) return;

    await Promise.all([loadDevice(currentUserId), checkPermissions()]);
  };

  const handleLogout = async () => {
    // Tell the backend this phone is going offline while we still can.
    await markDeviceOffline(deviceId);

    if (unsubscribeDeviceRef.current) {
      unsubscribeDeviceRef.current();
      unsubscribeDeviceRef.current = null;
    }

    const success = await logoutUser();

    if (success) {
      message.success("Logged out successfully");
    } else {
      message.error("Logout failed. Please try again.");
    }
  };

  const handleCopyUID = async () => {
    if (!currentUserId) {
      message.error("User UID is not available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentUserId);
      message.success("User UID copied successfully!");
    } catch (error) {
      console.error("Copy UID Error:", error);

      Modal.info({
        title: "Your Firebase User UID",
        content: currentUserId,
      });
    }
  };

  const handleNotificationChange = async (settingName, checked) => {
    if (!currentUserId) {
      message.error("User session not found.");
      return;
    }

    setNotificationSettings((previous) => ({
      ...previous,
      [settingName]: checked,
    }));

    setSavingKey(settingName);

    try {
      await setDoc(
        doc(db, "users", currentUserId),
        { notificationSettings: { [settingName]: checked } },
        { merge: true }
      );

      message.success(
        checked ? "Notification enabled" : "Notification disabled"
      );
    } catch (error) {
      console.error("Notification Preference Error:", error);

      setNotificationSettings((previous) => ({
        ...previous,
        [settingName]: !checked,
      }));

      message.error("Unable to update notification preference.");
    } finally {
      setSavingKey(null);
    }
  };

  // --------------------------------------------------
  // LOADING / ERROR
  // --------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spin size="large" />
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
        <p className="text-center text-sm text-slate-500">
          Unable to load your profile.
        </p>
      </div>
    );
  }

  // --------------------------------------------------
  // DERIVED VALUES
  // --------------------------------------------------

  const fullName = userData.fullName || "User";
  const nameParts = fullName.trim().split(/\s+/);

  let initials = nameParts[0]?.charAt(0).toUpperCase() || "U";

  if (nameParts.length > 1) {
    initials += nameParts[nameParts.length - 1]?.charAt(0).toUpperCase();
  }

  const lastSeenMs = toMillis(deviceData?.lastSyncAt);

  const isOnline =
    deviceData?.status === "connected" &&
    lastSeenMs > 0 &&
    clock - lastSeenMs < ONLINE_WINDOW_MS;

  const focusActive =
    Boolean(deviceData?.focus?.active) &&
    Number(deviceData?.focus?.endTime || 0) > clock;

  const missingPermission =
    permissions.checked && (!permissions.usage || !permissions.overlay);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* HEADER */}
      <div className="rounded-b-[32px] bg-blue-900 px-5 pb-10 pt-8">
        <h1 className="text-2xl font-bold text-white">Profile</h1>

        <p className="mt-1 text-sm text-blue-200">
          Manage your Smart Shield account
        </p>
      </div>

      {/* PROFILE CARD */}
      <div className="-mt-6 px-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
              <span className="text-xl font-bold text-blue-600">
                {initials}
              </span>
            </div>

            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">
                {fullName}
              </h2>

              <p className="truncate text-sm text-slate-500">
                {userData.email || "Email not available"}
              </p>

              <span
                className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${userData.status === "active"
                    ? "bg-green-50 text-green-700"
                    : "bg-slate-100 text-slate-600"
                  }`}
              >
                {userData.status === "active"
                  ? "Active Account"
                  : "Inactive Account"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ACCOUNT INFORMATION */}
      <div className="mt-6 px-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Account Information
        </h2>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-4 border-b border-slate-100 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <UserOutlined className="text-slate-600" />
            </div>

            <div>
              <p className="text-xs text-slate-400">Full Name</p>
              <p className="text-sm font-medium text-slate-800">{fullName}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 border-b border-slate-100 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <MailOutlined className="text-slate-600" />
            </div>

            <div className="min-w-0">
              <p className="text-xs text-slate-400">Email</p>
              <p className="truncate text-sm font-medium text-slate-800">
                {userData.email || "Not available"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 border-b border-slate-100 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
              <PhoneOutlined className="text-slate-600" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">Phone</p>
              <p className="text-sm font-medium text-slate-800">
                {userData.phone || "Not added"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
              <SafetyOutlined className="text-blue-600" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">Firebase User UID</p>

              <p className="mt-1 break-all text-sm font-medium text-slate-800">
                {currentUserId || "UID unavailable"}
              </p>

              <button
                type="button"
                onClick={handleCopyUID}
                disabled={!currentUserId}
                className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Copy UID
              </button>

              <p className="mt-2 text-xs text-slate-500">
                Share this ID with your parent only when linking your device.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CONNECTED DEVICE */}
      <div className="mt-6 px-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Connected Device
          </h3>

          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefreshDevice}
            loading={deviceLoading}
          >
            Refresh
          </Button>
        </div>

        {deviceLoading && !deviceData ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Spin size="small" />

            <div>
              <p className="text-sm font-medium text-slate-900">
                Registering this device...
              </p>
              <p className="text-xs text-slate-500">
                Checking the connection with Smart Shield
              </p>
            </div>
          </div>
        ) : deviceData ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <MobileOutlined className="text-xl text-blue-600" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {getDeviceTitle(deviceData)}
                </p>

                {getDeviceSubtitle(deviceData) && (
                  <p className="truncate text-xs text-slate-400">
                    {getDeviceSubtitle(deviceData)}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-slate-400"
                      }`}
                  />

                  <span className="text-xs text-slate-500">
                    {isOnline ? "Device connected" : "Device offline"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-400">Android</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {deviceData.androidVersion || "Unknown"}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-400">Last seen</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {formatLastSeen(lastSeenMs, clock)}
                </p>
              </div>
            </div>

            {focusActive && (
              <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">
                Focus Mode is on until{" "}
                {new Date(deviceData.focus.endTime).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </div>
            )}

            {missingPermission && (
              <button
                type="button"
                onClick={() => setSecurityModalOpen(true)}
                className="mt-3 flex w-full items-start gap-2 rounded-xl bg-amber-50 p-3 text-left text-xs text-amber-800"
              >
                <WarningOutlined className="mt-0.5" />
                <span>
                  Some permissions are off. Usage reports and Focus Mode can't
                  work fully until you allow them. Tap to fix.
                </span>
              </button>
            )}
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
                  {deviceError ||
                    "Connect an Android device to start monitoring."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Transparency note */}
        {deviceData && (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Remote management is on: your Smart Shield admin can see this
            device's status and today's app usage summary, and can start or
            stop Focus Mode.
          </p>
        )}
      </div>

      {/* SETTINGS */}
      <div className="mt-6 px-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Settings
        </h3>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => {
              checkPermissions();
              setSecurityModalOpen(true);
            }}
            className="flex w-full items-center gap-4 border-b border-slate-100 p-4 text-left"
          >
            <SafetyOutlined className="text-xl text-blue-600" />

            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Security & Permissions
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Manage app permissions and security settings
              </p>
            </div>

            <RightOutlined className="text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => setNotificationModalOpen(true)}
            className="flex w-full items-center gap-4 p-4 text-left"
          >
            <BellOutlined className="text-xl text-blue-600" />

            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Notifications
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Manage notification preferences
              </p>
            </div>

            <RightOutlined className="text-slate-400" />
          </button>
        </div>
      </div>

      {/* LOGOUT */}
      <div className="mt-6 px-5">
        <button
          type="button"
          onClick={handleLogout}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 font-medium text-red-600 transition hover:bg-red-100"
        >
          <LogoutOutlined />
          Logout
        </button>
      </div>

      {/* SECURITY & PERMISSIONS MODAL */}
      <Modal
        title={
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Security & Permissions
            </h2>

            <p className="mt-1 text-xs font-normal text-slate-500">
              Live status of what Smart Shield needs on this phone
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
          <PermissionRow
            icon={<MobileOutlined className="text-lg text-blue-600" />}
            tone="bg-blue-50"
            title="Usage Access"
            description="Required to monitor application usage"
            granted={permissions.usage}
            onAllow={openUsageAccessSettings}
          />

          <PermissionRow
            icon={<SafetyOutlined className="text-lg text-orange-600" />}
            tone="bg-orange-50"
            title="Display over other apps"
            description="Required to show the Focus Mode screen"
            granted={permissions.overlay}
            onAllow={openOverlaySettings}
          />

          <PermissionRow
            icon={<CheckCircleFilled className="text-lg text-purple-600" />}
            tone="bg-purple-50"
            title="Device registration"
            description="This phone is linked to your account"
            granted={Boolean(deviceData)}
          />

          <Button block onClick={checkPermissions}>
            I've changed a permission
          </Button>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs leading-5 text-slate-500">
              On OPPO / ColorOS also allow auto-launch and set battery usage
              to "Unrestricted" so Android doesn't stop Smart Shield in the
              background.
            </p>
          </div>
        </div>
      </Modal>

      {/* NOTIFICATIONS MODAL */}
      <Modal
        title={
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Notifications
            </h2>

            <p className="mt-1 text-xs font-normal text-slate-500">
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
          <NotificationRow
            icon={<BellOutlined className="text-lg text-blue-600" />}
            tone="bg-blue-50"
            title="General Notifications"
            description="Receive important Smart Shield notifications"
            checked={notificationSettings.general}
            saving={savingKey === "general"}
            onChange={(checked) =>
              handleNotificationChange("general", checked)
            }
          />

          <NotificationRow
            icon={<MobileOutlined className="text-lg text-orange-600" />}
            tone="bg-orange-50"
            title="Usage Limit Alerts"
            description="Get notified when an app reaches its usage limit"
            checked={notificationSettings.usageLimit}
            saving={savingKey === "usageLimit"}
            onChange={(checked) =>
              handleNotificationChange("usageLimit", checked)
            }
          />

          <NotificationRow
            icon={<SafetyOutlined className="text-lg text-purple-600" />}
            tone="bg-purple-50"
            title="Focus Mode Alerts"
            description="Receive updates when Focus Mode starts or ends"
            checked={notificationSettings.focusMode}
            saving={savingKey === "focusMode"}
            onChange={(checked) =>
              handleNotificationChange("focusMode", checked)
            }
          />

          <NotificationRow
            icon={<BellOutlined className="text-lg text-red-600" />}
            tone="border border-red-100 bg-red-50"
            title="Important Alerts"
            description="Security and important account notifications"
            checked={notificationSettings.important}
            saving={savingKey === "important"}
            onChange={(checked) =>
              handleNotificationChange("important", checked)
            }
          />

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs leading-5 text-slate-500">
              Notification preferences are saved to your Smart Shield account
              and will remain active when you sign in again.
            </p>
          </div>
        </div>
      </Modal>

      <BottomNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
};

export default UserProfileDashboard;