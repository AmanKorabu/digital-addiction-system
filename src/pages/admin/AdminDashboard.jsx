import { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  FiShield,
  FiGrid,
  FiSmartphone,
  FiActivity,
  FiSettings,
  FiLogOut,
  FiMenu,
  FiX,
  FiPlus,
  FiRefreshCw,
  FiWifi,
  FiWifiOff,
  FiClock,
  FiSearch,
  FiMonitor,
} from "react-icons/fi";

import { auth, db } from "../../config/firebase";
import {
  sendDeviceCommand,
  COMMAND_TYPES,
  ONLINE_WINDOW_MS,
} from "../../services/deviceControlService";

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

const getTimestampMillis = (timestamp) => {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (typeof timestamp.toDate === "function") return timestamp.toDate().getTime();
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const formatDuration = (milliseconds = 0) => {
  const totalMinutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
};

const formatDate = (value) => {
  const ms = getTimestampMillis(value);
  return ms ? new Date(ms).toLocaleString() : "Not synced yet";
};

const styles = `
* { box-sizing: border-box; }
.ss-layout { min-height:100vh; background:#f4f6fa; color:#17243b; font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.ss-sidebar { width:250px; position:fixed; inset:0 auto 0 0; z-index:40; display:flex; flex-direction:column; padding:24px 17px; color:#fff; background:#17243b; transition:transform .25s ease; }
.ss-brand { display:flex; align-items:center; gap:11px; padding:0 9px 30px; }
.ss-logo { width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:#ff7043;font-size:22px; }
.ss-nav { display:grid; gap:7px; }
.ss-nav button { width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;border:0;border-radius:11px;background:transparent;color:#c5cede;text-align:left;cursor:pointer;font-size:14px; }
.ss-nav button:hover,.ss-nav button.active { background:#293853;color:#fff; }
.ss-nav button.active { box-shadow:inset 3px 0 #ff7043; }
.ss-main { margin-left:250px;min-width:0; }
.ss-topbar { min-height:76px;padding:15px 30px;background:#fff;border-bottom:1px solid #e8edf4;display:flex;align-items:center;justify-content:space-between;gap:14px; }
.ss-content { max-width:1500px;margin:auto;padding:30px; }
.ss-card { background:#fff;border:1px solid #e7ecf3;border-radius:17px;padding:21px;box-shadow:0 5px 20px rgba(24,42,72,.035);min-width:0; }
.ss-stats { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin:23px 0; }
.ss-stat-top { display:flex;align-items:center;justify-content:space-between;gap:8px;color:#69768c;font-size:13px; }
.ss-stat-icon { width:40px;height:40px;display:grid;place-items:center;border-radius:12px;font-size:19px;flex-shrink:0; }
.ss-stat-value { margin:13px 0 4px;font-size:30px;font-weight:800;letter-spacing:-1px; }
.ss-muted { color:#78849a;font-size:13px;line-height:1.6; }
.ss-primary,.ss-secondary { display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 15px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s; }
.ss-primary { border:0;background:#ff7043;color:#fff; }
.ss-primary:hover { background:#f15d30; }
.ss-secondary { border:1px solid #dfe5ef;background:#fff;color:#263650; }
.ss-secondary:hover { background:#f7f8fb; }
.ss-primary:disabled,.ss-secondary:disabled { opacity:.55;cursor:not-allowed; }
.ss-device-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px; }
.ss-device { border:1px solid #e7ecf3;border-radius:15px;background:#fff;padding:18px;min-width:0; }
.ss-device-head { display:flex;align-items:center;gap:12px;min-width:0; }
.ss-phone { width:46px;height:46px;display:grid;place-items:center;flex-shrink:0;border-radius:13px;background:#eef1ff;color:#5969bd;font-size:22px; }
.ss-status { display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:30px;font-size:11px;font-weight:750;white-space:nowrap; }
.ss-status.online { background:#e5f8ed;color:#18794e; }
.ss-status.offline { background:#fff0eb;color:#b8492d; }
.ss-status.pending { background:#fff6df;color:#936516; }
.ss-input { width:100%;padding:12px 13px;margin:7px 0 14px;border:1px solid #dfe5ef;border-radius:10px;outline:none;background:#fff;color:#18243b;font-size:14px; }
.ss-input:focus { border-color:#ff7043;box-shadow:0 0 0 3px #ff70431a; }
.ss-empty { text-align:center;padding:40px 18px;background:#fafbfe;border:1px dashed #d9e0eb;border-radius:14px;margin-top:20px; }
.ss-error { background:#fff0ed;color:#a83220;padding:13px 15px;border-radius:10px;margin:16px 0;font-size:13px;overflow-wrap:anywhere; }
.ss-overlay { display:none; }
.ss-mobile-menu { display:none; }
.ss-bottom { display:none; }
.ss-usage-card { border:1px solid #e7ecf3;border-radius:14px;padding:18px;background:#fff; }
.ss-usage-stats { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:17px; }
.ss-usage-stat { background:#f5f7ff;padding:14px;border-radius:11px; }
.ss-app-row { display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;margin-bottom:7px; }
.ss-progress { height:7px;background:#edf0f5;border-radius:10px;overflow:hidden; }
.ss-progress-fill { height:100%;background:#ff7043;border-radius:10px; }
.ss-section-heading { display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap; }
.ss-focus-box { margin-top:16px;padding-top:16px;border-top:1px solid #edf0f5; }
.ss-focus-note { margin-top:12px;padding:11px 12px;border-radius:10px;font-size:12px;line-height:1.6; }
.ss-app-list { max-height:190px;overflow-y:auto;border:1px solid #e8edf4;border-radius:10px;padding:11px;display:grid;gap:10px; }
.ss-app-option { display:flex;align-items:center;gap:9px;font-size:12px;cursor:pointer;overflow-wrap:anywhere; }
.ss-app-option input { accent-color:#ff7043;width:15px;height:15px; }
.ss-overlay.show { display:block;position:fixed;inset:0;z-index:35;background:#10182770; }
@media(max-width:1050px) { .ss-stats{grid-template-columns:repeat(2,minmax(0,1fr));}.ss-content{padding:24px;} }
@media(max-width:760px) {
 .ss-sidebar{transform:translateX(-105%);width:270px;box-shadow:none;}
 .ss-sidebar.open{transform:translateX(0);box-shadow:10px 0 40px #101c3230;}
 .ss-main{margin-left:0;padding-bottom:72px;}
 .ss-topbar{min-height:65px;padding:12px 16px;}
 .ss-content{padding:21px 15px;}
 .ss-mobile-menu{display:grid;place-items:center;width:39px;height:39px;border:1px solid #e5e9f1;background:#fff;border-radius:10px;color:#18243b;}
 .ss-device-grid{grid-template-columns:1fr;}
 .ss-bottom{position:fixed;bottom:0;left:0;right:0;z-index:30;background:#fff;border-top:1px solid #e7ebf3;display:grid;grid-template-columns:repeat(4,1fr);padding:7px 4px max(7px,env(safe-area-inset-bottom));}
 .ss-bottom button{display:flex;flex-direction:column;align-items:center;gap:4px;border:0;background:transparent;color:#77839a;font-size:10px;padding:6px 2px;}
 .ss-bottom button.active{color:#ff7043;font-weight:750;}
 .ss-page-title{font-size:25px!important;}
 .ss-hide-mobile{display:none!important;}
}
@media(max-width:380px) { .ss-stats{gap:8px;}.ss-stat-value{font-size:24px;}.ss-stat-top{font-size:11px;} }
`;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [childUid, setChildUid] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedAppsByDevice, setSelectedAppsByDevice] = useState({});
  const [durationByDevice, setDurationByDevice] = useState({});
  const [commandLoadingByDevice, setCommandLoadingByDevice] = useState({});
  const [focusMessages, setFocusMessages] = useState({});
  const [activeNav, setActiveNav] = useState("Overview");
  const [now, setNow] = useState(() => Date.now());

  // Re-check every 30 seconds so a silent phone turns Offline by itself.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Online status based ONLY on Firestore heartbeat (survives app kill)
  const isDeviceOnline = (device) => {
    const lastSync = getTimestampMillis(device.lastSyncAt);
    return lastSync > 0 && now - lastSync < ONLINE_WINDOW_MS;
  };

  // Realtime Firestore devices listener
  useEffect(() => {
    let unsubscribeDevices = null;
    let authSession = 0;

    const unsubscribeAuth = onAuthStateChanged(auth, (parent) => {
      authSession += 1;
      const currentSession = authSession;

      if (unsubscribeDevices) {
        unsubscribeDevices();
        unsubscribeDevices = null;
      }

      if (!parent) {
        setLoading(false);
        navigate("/admin/login", { replace: true });
        return;
      }

      setLoading(true);
      setError("");
      const devicesQuery = query(
        collection(db, "devices"),
        where("parentId", "==", parent.uid)
      );

      unsubscribeDevices = onSnapshot(
        devicesQuery,
        (snapshot) => {
          if (currentSession !== authSession) return;
          const updatedDevices = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }));
          setDevices(updatedDevices);
          setLoading(false);
        },
        (err) => {
          if (currentSession !== authSession) return;
          console.error("ADMIN DEVICE LISTENER ERROR:", err);
          setError(`Unable to receive device updates: ${err.code || err.message}`);
          setLoading(false);
        }
      );
    });

    return () => {
      authSession += 1;
      unsubscribeAuth();
      if (unsubscribeDevices) unsubscribeDevices();
    };
  }, [navigate, refreshTick]);

  const loadDevices = () => {
    if (!auth.currentUser) {
      navigate("/admin/login", { replace: true });
      return;
    }
    setError("");
    setRefreshTick((value) => value + 1);
  };

  const handleAddDevice = async (event) => {
    event.preventDefault();
    const parent = auth.currentUser;

    if (!parent) {
      navigate("/admin/login", { replace: true });
      return;
    }

    const uid = childUid.trim();
    const name = deviceName.trim();

    if (!name || !uid) {
      setError("Enter both a device name and the existing user's Firebase UID.");
      return;
    }

    if (uid === parent.uid) {
      setError("You cannot add your own admin account as a user device.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const userRef = doc(db, "users", uid);
      let userSnapshot;

      try {
        await updateDoc(userRef, {
          parentId: parent.uid,
          updatedAt: serverTimestamp(),
        });
        userSnapshot = await getDoc(userRef);
      } catch (assignmentError) {
        try {
          userSnapshot = await getDoc(userRef);
          if (!userSnapshot.exists()) {
            throw new Error("No user profile exists for this UID. Ask the user to register first.");
          }
          if (userSnapshot.data().parentId !== parent.uid) {
            throw new Error("This user is already assigned to another parent, or is not eligible for assignment.");
          }
        } catch (readError) {
          if (readError?.message?.includes("No user profile") ||
              readError?.message?.includes("already assigned")) {
            throw readError;
          }
          throw new Error("Could not assign this UID. Check that it belongs to an existing user account and that its parentId is null or already belongs to you.");
        }
      }

      if (!userSnapshot?.exists()) {
        throw new Error("No user profile exists for this UID. Ask the user to register first.");
      }

      const userData = userSnapshot.data();
      if (userData.role !== "user" || userData.status !== "active") {
        throw new Error("This account is not an active Smart Shield user account.");
      }
      if (userData.parentId !== parent.uid) {
        throw new Error("The user profile was not assigned to your admin account.");
      }

      const existingDevicesQuery = query(
        collection(db, "devices"),
        where("userId", "==", uid)
      );
      const existingDevicesSnapshot = await getDocs(existingDevicesQuery);

      if (!existingDevicesSnapshot.empty) {
        const unlinkedDevice = existingDevicesSnapshot.docs.find(
          (item) => !item.data().parentId
        );

        if (unlinkedDevice) {
          await updateDoc(unlinkedDevice.ref, {
            parentId: parent.uid,
          });
        } else {
          const alreadyLinked = existingDevicesSnapshot.docs.some(
            (item) => item.data().parentId === parent.uid
          );

          if (!alreadyLinked) {
            throw new Error("A device for this user exists but cannot be linked. Check its parentId and Firestore rules.");
          }
        }
      } else {
        await addDoc(collection(db, "devices"), {
          deviceName: name,
          parentId: parent.uid,
          userId: uid,
          status: "disconnected",
          createdAt: serverTimestamp(),
        });
      }

      setDeviceName("");
      setChildUid("");
      setShowAdd(false);
      setError("");
    } catch (err) {
      console.error("USER / DEVICE ASSIGNMENT ERROR:", err);
      setError(`Could not assign user/device: ${err.code || err.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem("smartShieldAdminLoggedIn");
      localStorage.removeItem("smartShieldAdminId");
      navigate("/admin/login", { replace: true });
    } catch (err) {
      console.error("Logout failed:", err);
      setError("Logout failed. Please try again.");
    }
  };

  const handleFocusAppSelection = (deviceId, packageName, checked) => {
    setSelectedAppsByDevice((previous) => {
      const current = previous[deviceId] || [];
      return {
        ...previous,
        [deviceId]: checked
          ? [...new Set([...current, packageName])]
          : current.filter((item) => item !== packageName),
      };
    });
  };

  const setFocusMessage = (deviceId, message, kind = "info") => {
    setFocusMessages((previous) => ({
      ...previous,
      [deviceId]: { text: message, kind },
    }));
  };

  const handleStartRemoteFocus = async (device) => {
    const packages = selectedAppsByDevice[device.id] || [];
    const durationMinutes = Number(durationByDevice[device.id] || 30);

    if (!device.userId) {
      setFocusMessage(device.id, "This device has not been linked to a user.", "error");
      return;
    }
    if (!packages.length) {
      setFocusMessage(device.id, "Select at least one app first.", "error");
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      setFocusMessage(device.id, "Choose a duration between 1 and 1,440 minutes.", "error");
      return;
    }

    setCommandLoadingByDevice((previous) => ({ ...previous, [device.id]: true }));
    setFocusMessage(device.id, "");
    try {
      const result = await sendDeviceCommand(
        device.id,
        COMMAND_TYPES.START_FOCUS,
        { packages, durationMinutes }
      );
      if (!result?.success) {
        throw new Error(result?.error || "The command could not be saved.");
      }
      const online = isDeviceOnline(device);
      setFocusMessage(
        device.id,
        online
          ? "Request saved. The phone will confirm when Focus Mode starts."
          : "Request saved. This phone is offline, so Focus Mode will start only after it reconnects and receives the command.",
        "success"
      );
    } catch (err) {
      console.error("REMOTE START FOCUS ERROR:", err);
      setFocusMessage(device.id, err?.message || "Unable to save the Focus Mode request.", "error");
    } finally {
      setCommandLoadingByDevice((previous) => ({ ...previous, [device.id]: false }));
    }
  };

  const handleStopRemoteFocus = async (device) => {
    if (!device.userId) {
      setFocusMessage(device.id, "This device has not been linked to a user.", "error");
      return;
    }
    setCommandLoadingByDevice((previous) => ({ ...previous, [device.id]: true }));
    setFocusMessage(device.id, "");
    try {
      const result = await sendDeviceCommand(device.id, COMMAND_TYPES.STOP_FOCUS);
      if (!result?.success) throw new Error(result?.error || "The command could not be saved.");
      const online = isDeviceOnline(device);
      setFocusMessage(
        device.id,
        online
          ? "Stop request saved. Waiting for the phone to confirm."
          : "Stop request saved. It will be processed when the phone reconnects.",
        "success"
      );
    } catch (err) {
      console.error("REMOTE STOP FOCUS ERROR:", err);
      setFocusMessage(device.id, err?.message || "Unable to save the Stop request.", "error");
    } finally {
      setCommandLoadingByDevice((previous) => ({ ...previous, [device.id]: false }));
    }
  };

  const connected = devices.filter((device) => isDeviceOnline(device)).length;
  const disconnected = devices.length - connected;
  const devicesWithUsage = devices.filter((device) => device.usageSummary);
  const filteredDevices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((device) =>
      `${device.deviceName || ""} ${device.userId || ""} ${device.model || ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [devices, search]);

  const navItems = [
    { label: "Overview", icon: <FiGrid />, target: "overview" },
    { label: "My Devices", icon: <FiSmartphone />, target: "devices" },
    { label: "Usage Reports", icon: <FiActivity />, target: "analytics" },
    { label: "Settings", icon: <FiSettings />, target: "settings" },
  ];

  const navigateSection = (item) => {
    setActiveNav(item.label);
    setMenuOpen(false);
    if (item.target === "settings") {
      setError("Account settings are not available yet.");
      return;
    }
    document.getElementById(item.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderDeviceCard = (device) => {
    const online = isDeviceOnline(device);
    const lastSeen = getTimestampMillis(device.lastSyncAt);
    const usage = device.usageSummary || {};
    const apps = Array.isArray(usage.apps)
      ? usage.apps
      : Array.isArray(usage.topApps)
        ? usage.topApps
        : [];
    const selectedPackages = selectedAppsByDevice[device.id] || [];
    const focusActive = Boolean(device.focus?.active);
    const adminControlled = Boolean(device.focus?.adminControlled);
    const busy = Boolean(commandLoadingByDevice[device.id]);
    const message = focusMessages[device.id];

    return (
      <article className="ss-device" key={device.id}>
        <div className="ss-device-head">
          <div className="ss-phone"><FiSmartphone /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, overflowWrap: "anywhere" }}>
              {device.deviceName || "Android Device"}
            </div>
            <div className="ss-muted" style={{ marginTop: 4, fontSize: 11 }}>
              {device.model || "Smart Shield device"}
            </div>
          </div>
          <span className={`ss-status ${online ? "online" : "offline"}`}>
            {online ? <FiWifi /> : <FiWifiOff />}
            {online ? "Online" : "Offline"}
          </span>
        </div>

        <div style={{ borderTop: "1px solid #edf0f5", marginTop: 15, paddingTop: 13 }}>
          <div className="ss-muted" style={{ overflowWrap: "anywhere" }}>
            Linked user: {device.userId || "Not assigned"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, color: "#78849a", fontSize: 11 }}>
            <FiClock />
            {online ? "Connected to Smart Shield" : lastSeen ? `Last sync: ${new Date(lastSeen).toLocaleString()}` : "No sync recorded yet"}
          </div>
        </div>

        <div className="ss-focus-box">
          <div className="ss-section-heading">
            <h3 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
              <FiShield color="#f06b42" /> Focus Mode
            </h3>
            <span className={`ss-status ${focusActive ? "online" : "offline"}`}>
              {focusActive ? (adminControlled ? "Parent managed" : "Active") : "Inactive"}
            </span>
          </div>

          {focusActive ? (
            <div className="ss-focus-note" style={{ background: "#fff6ef", color: "#94502f" }}>
              <strong>Focus Mode is currently active.</strong>
              <div style={{ marginTop: 5 }}>
                {adminControlled
                  ? "This session was started by the parent account."
                  : "This session was started on the phone."}
              </div>
              {device.focus?.endTime && (
                <div style={{ marginTop: 5 }}>
                  Ends: {formatDate(device.focus.endTime)}
                </div>
              )}
              {adminControlled && (
                <button
                  className="ss-primary"
                  style={{ marginTop: 12, width: "100%" }}
                  disabled={busy}
                  onClick={() => handleStopRemoteFocus(device)}
                >
                  {busy ? "Saving request..." : "Stop Focus Mode"}
                </button>
              )}
              {!adminControlled && (
                <div style={{ marginTop: 9, fontSize: 11 }}>
                  Parent stop control is available only for parent-managed sessions.
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="ss-muted" style={{ margin: "9px 0 12px" }}>
                Choose the apps and duration for this phone.
              </p>
              <label style={{ display: "block", fontSize: 12, fontWeight: 750, marginBottom: 7 }}>
                Apps to restrict
              </label>
              {apps.length === 0 ? (
                <div className="ss-focus-note" style={{ background: "#f5f7fb", color: "#66738a" }}>
                  No app list has synced yet. The phone needs to send its app usage list before you can select apps.
                </div>
              ) : (
                <div className="ss-app-list">
                  {apps.map((app) => {
                    const packageName = app.packageName;
                    if (!packageName) return null;
                    return (
                      <label className="ss-app-option" key={packageName}>
                        <input
                          type="checkbox"
                          checked={selectedPackages.includes(packageName)}
                          onChange={(event) =>
                            handleFocusAppSelection(device.id, packageName, event.target.checked)
                          }
                        />
                        <span>{app.appName || packageName}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <label style={{ display: "block", fontSize: 12, fontWeight: 750, marginTop: 13 }}>
                Duration
              </label>
              <select
                className="ss-input"
                style={{ marginBottom: 12 }}
                value={durationByDevice[device.id] || 30}
                onChange={(event) =>
                  setDurationByDevice((previous) => ({
                    ...previous,
                    [device.id]: Number(event.target.value),
                  }))
                }
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
                <option value={360}>6 hours</option>
                <option value={720}>12 hours</option>
                <option value={1440}>24 hours</option>
              </select>

              <button
                className="ss-primary"
                style={{ width: "100%" }}
                disabled={!device.userId || !apps.length || !selectedPackages.length || busy}
                onClick={() => handleStartRemoteFocus(device)}
              >
                <FiShield />
                {busy ? "Saving request..." : online ? "Start Focus Mode" : "Queue Focus Request"}
              </button>

              {!online && (
                <div className="ss-focus-note" style={{ background: "#fff7e8", color: "#8a5b17" }}>
                  <strong>Phone currently offline</strong>
                  <div>
                    You can save a request now. It will only take effect after the phone reconnects and receives and processes it.
                  </div>
                </div>
              )}
              {!device.userId && (
                <div className="ss-muted" style={{ marginTop: 8 }}>
                  Link a user account to enable device controls.
                </div>
              )}
            </>
          )}

          {message?.text && (
            <div
              role="status"
              className="ss-focus-note"
              style={{
                background: message.kind === "error" ? "#fff0ed" : message.kind === "success" ? "#eaf8ef" : "#f2f5fb",
                color: message.kind === "error" ? "#a83220" : message.kind === "success" ? "#176b43" : "#45536b",
              }}
            >
              {message.text}
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="ss-layout">
      <style>{styles}</style>

      <div className={`ss-overlay ${menuOpen ? "show" : ""}`} onClick={() => setMenuOpen(false)} />

      <aside className={`ss-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="ss-brand">
          <div className="ss-logo"><FiShield /></div>
          <div>
            <div style={{ fontWeight: 850, fontSize: 19 }}>Smart Shield</div>
            <div style={{ fontSize: 10, color: "#aebbd0", marginTop: 4, letterSpacing: 1.2 }}>PARENT PORTAL</div>
          </div>
          <button
            className="ss-mobile-menu"
            style={{ marginLeft: "auto", background: "transparent", color: "#fff", borderColor: "#43506a" }}
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <FiX />
          </button>
        </div>

        <div style={{ padding: "0 12px 12px", color: "#8795ad", fontSize: 10, fontWeight: 800, letterSpacing: 1.3 }}>
          WORKSPACE
        </div>
        <nav className="ss-nav">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={activeNav === item.label ? "active" : ""}
              onClick={() => navigateSection(item)}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
              {activeNav === item.label && <span style={{ marginLeft: "auto", color: "#ff956f" }}>•</span>}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: "auto", padding: 14, background: "#202f49", borderRadius: 13 }}>
          <FiShield size={21} color="#ff916d" />
          <div style={{ fontSize: 13, fontWeight: 750, marginTop: 10 }}>Family wellbeing</div>
          <div style={{ color: "#aebbd0", fontSize: 11, lineHeight: 1.6, marginTop: 5 }}>
            Manage linked devices and review shared digital wellbeing activity.
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, background: "transparent", border: 0, color: "#c4ccdc", padding: 13, cursor: "pointer", textAlign: "left" }}
        >
          <FiLogOut /> Sign out
        </button>
      </aside>

      <div className="ss-main">
        <header className="ss-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="ss-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <FiMenu />
            </button>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Parent Portal</div>
              <div className="ss-muted" style={{ fontSize: 11 }}>Smart Shield / {activeNav}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="ss-hide-mobile" style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 750 }}>Parent Account</div>
              <div style={{ color: "#78849a", fontSize: 11, marginTop: 3 }}>
                {auth.currentUser?.email || "Signed in"}
              </div>
            </div>
            <div style={{ width: 39, height: 39, borderRadius: "50%", display: "grid", placeItems: "center", background: "#fff0e9", color: "#d95a32", fontWeight: 850 }}>
              {(auth.currentUser?.email || "P").charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="ss-content" id="overview">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 15, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "#ff7043", fontSize: 11, fontWeight: 850, letterSpacing: 1.5 }}>YOUR FAMILY SPACE</div>
              <h1 className="ss-page-title" style={{ fontSize: 30, margin: "9px 0 7px", letterSpacing: "-.8px" }}>
                Family overview
              </h1>
              <p className="ss-muted" style={{ margin: 0 }}>
                See your linked phones, manage Focus Mode, and review screen-time reports.
              </p>
            </div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              <button className="ss-secondary" onClick={loadDevices} disabled={loading}>
                <FiRefreshCw /> Refresh
              </button>
              <button className="ss-primary" onClick={() => setShowAdd(true)}>
                <FiPlus /> Add device
              </button>
            </div>
          </div>

          {error && (
            <div className="ss-error" role="alert">
              {error}
              <button className="ss-secondary" style={{ marginLeft: 10 }} onClick={loadDevices}>Retry</button>
            </div>
          )}

          <section className="ss-stats" aria-label="Device summary">
            <div className="ss-card">
              <div className="ss-stat-top">Total devices <span className="ss-stat-icon" style={{ background: "#fff0e9", color: "#ed6a3c" }}><FiSmartphone /></span></div>
              <div className="ss-stat-value">{loading ? "—" : devices.length}</div>
              <div className="ss-muted">Linked device records</div>
            </div>
            <div className="ss-card">
              <div className="ss-stat-top">Online now <span className="ss-stat-icon" style={{ background: "#e5f8ed", color: "#168451" }}><FiWifi /></span></div>
              <div className="ss-stat-value">{loading ? "—" : connected}</div>
              <div className="ss-muted">Live app connections</div>
            </div>
            <div className="ss-card">
              <div className="ss-stat-top">Offline <span className="ss-stat-icon" style={{ background: "#fff0eb", color: "#c45234" }}><FiWifiOff /></span></div>
              <div className="ss-stat-value">{loading ? "—" : disconnected}</div>
              <div className="ss-muted">No live connection detected</div>
            </div>
            <div className="ss-card">
              <div className="ss-stat-top">Usage reports <span className="ss-stat-icon" style={{ background: "#eef1ff", color: "#5969bd" }}><FiActivity /></span></div>
              <div className="ss-stat-value">{loading ? "—" : devicesWithUsage.length}</div>
              <div className="ss-muted">Devices with usage data</div>
            </div>
          </section>

          <section className="ss-card" id="devices">
            <div className="ss-section-heading">
              <div>
                <h2 style={{ margin: 0, fontSize: 19 }}>My devices</h2>
                <p className="ss-muted" style={{ margin: "6px 0 0" }}>
                  Select a phone below to manage its Focus Mode and view its sync status.
                </p>
              </div>
              <span className="ss-muted">{devices.length} linked</span>
            </div>

            <div style={{ position: "relative", marginTop: 19 }}>
              <FiSearch style={{ position: "absolute", left: 13, top: 13, color: "#8a95a9" }} />
              <input
                className="ss-input"
                style={{ paddingLeft: 39, margin: 0 }}
                placeholder="Search by device name, model, or user ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search devices"
              />
            </div>

            {loading ? (
              <div className="ss-empty"><FiRefreshCw size={25} /><p className="ss-muted">Loading your devices…</p></div>
            ) : filteredDevices.length === 0 ? (
              <div className="ss-empty">
                <FiMonitor size={32} color="#ed7048" />
                <h3 style={{ fontSize: 17, margin: "12px 0 7px" }}>{search ? "No matching devices" : "No devices added yet"}</h3>
                <p className="ss-muted" style={{ maxWidth: 370, margin: "0 auto 18px" }}>
                  {search ? "Try another search term." : "Add the existing user's account UID. The phone must sign in and complete the pairing process before it can send data."}
                </p>
                {!search && <button className="ss-primary" onClick={() => setShowAdd(true)}><FiPlus /> Add your first device</button>}
              </div>
            ) : (
              <div className="ss-device-grid">{filteredDevices.map(renderDeviceCard)}</div>
            )}
          </section>

          <section className="ss-card" id="analytics" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div className="ss-stat-icon" style={{ background: "#eef1ff", color: "#5969bd" }}><FiActivity /></div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Usage reports</h2>
                <p className="ss-muted" style={{ margin: "5px 0 0" }}>Screen-time information last synchronized by each phone.</p>
              </div>
            </div>

            {loading ? <div className="ss-empty">Loading usage reports…</div> : devices.length === 0 ? (
              <div className="ss-empty">Add a linked phone to see usage reports here.</div>
            ) : (
              <div style={{ display: "grid", gap: 17 }}>
                {devices.map((device) => {
                  const usage = device.usageSummary || {};
                  const apps = Array.isArray(usage.apps) ? usage.apps : Array.isArray(usage.topApps) ? usage.topApps : [];
                  const total = Math.max(0, Number(usage.totalScreenTime) || 0);
                  return (
                    <div className="ss-usage-card" key={device.id}>
                      <div className="ss-section-heading">
                        <div>
                          <h3 style={{ margin: 0, fontSize: 15 }}>{device.deviceName || "Android Device"}</h3>
                          <p className="ss-muted" style={{ margin: "5px 0 0" }}>User ID: {device.userId || "Not assigned"}</p>
                        </div>
                        <span className={`ss-status ${total > 0 ? "online" : "offline"}`}>
                          <FiActivity /> {total > 0 ? "Usage available" : "Waiting for data"}
                        </span>
                      </div>
                      <div className="ss-usage-stats">
                        <div className="ss-usage-stat">
                          <div className="ss-muted">Total screen time</div>
                          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 7 }}>{formatDuration(total)}</div>
                        </div>
                        <div className="ss-usage-stat" style={{ background: "#f1fbf5" }}>
                          <div className="ss-muted">Apps recorded</div>
                          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 7 }}>{usage.appCount ?? apps.length}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 18 }}>
                        <h4 style={{ fontSize: 14, margin: "0 0 13px" }}>Most-used apps</h4>
                        {!apps.length ? <p className="ss-muted">No app-wise usage data available yet.</p> : (
                          <div style={{ display: "grid", gap: 13 }}>
                            {apps.slice(0, 8).map((app, index) => {
                              const time = Math.max(0, Number(app.timeMs ?? app.totalTimeInForeground) || 0);
                              const percent = total > 0 ? Math.min(100, (time / total) * 100) : 0;
                              return (
                                <div key={app.packageName || index}>
                                  <div className="ss-app-row">
                                    <span style={{ fontWeight: 650, overflowWrap: "anywhere" }}>{app.appName || app.packageName || "Unknown app"}</span>
                                    <span style={{ color: "#68758c", whiteSpace: "nowrap" }}>{formatDuration(time)}</span>
                                  </div>
                                  <div className="ss-progress"><div className="ss-progress-fill" style={{ width: `${percent}%` }} /></div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="ss-muted" style={{ borderTop: "1px solid #edf0f5", marginTop: 16, paddingTop: 11 }}>
                        Last usage sync: {formatDate(usage.updatedAt || device.lastSyncAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <footer className="ss-muted" style={{ textAlign: "center", marginTop: 25, fontSize: 11 }}>
            Smart Shield · Family digital wellbeing
          </footer>
        </main>
      </div>

      <nav className="ss-bottom" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <button key={item.label} className={activeNav === item.label ? "active" : ""} onClick={() => navigateSection(item)}>
            <span style={{ fontSize: 19 }}>{item.icon}</span>
            {item.label === "Overview" ? "Home" : item.label === "My Devices" ? "Devices" : item.label === "Usage Reports" ? "Usage" : "Settings"}
          </button>
        ))}
      </nav>

      {showAdd && (
        <div
          onClick={() => !saving && setShowAdd(false)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "#111b2e99", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-device-title"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 19, padding: 23, boxShadow: "0 25px 80px #0003", margin: "auto" }}
          >
            <div className="ss-section-heading">
              <div>
                <div style={{ color: "#ff7043", fontSize: 11, fontWeight: 850, letterSpacing: 1.2 }}>DEVICE MANAGEMENT</div>
                <h2 id="add-device-title" style={{ margin: "7px 0 0", fontSize: 22 }}>Add a device</h2>
              </div>
              <button className="ss-secondary" onClick={() => setShowAdd(false)} disabled={saving} aria-label="Close dialog"><FiX /></button>
            </div>
            <p className="ss-muted" style={{ margin: "12px 0 20px" }}>Enter a name and the Firebase UID of the existing user account.</p>
            <form onSubmit={handleAddDevice}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>
                Device name
                <input className="ss-input" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="e.g. Child's Android phone" required />
              </label>
              <label style={{ fontSize: 13, fontWeight: 700 }}>
                User's Firebase UID
                <input className="ss-input" value={childUid} onChange={(event) => setChildUid(event.target.value)} placeholder="Paste the existing user's UID" required />
              </label>
              <div style={{ padding: 12, borderRadius: 10, background: "#fff6ef", color: "#94502f", fontSize: 12, lineHeight: 1.6, marginBottom: 17 }}>
                Adding this record does not install or pair the app. The user must sign in to Smart Shield, complete device linking, and grant the permissions needed for the enabled features.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="ss-primary" type="submit" disabled={saving}><FiPlus /> {saving ? "Saving…" : "Save device"}</button>
                <button className="ss-secondary" type="button" onClick={() => setShowAdd(false)} disabled={saving}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}