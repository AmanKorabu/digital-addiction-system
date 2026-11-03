
import { useEffect, useState } from "react";

import {
  collection,
  addDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot,
  getDocs,
} from "firebase/firestore";

import { onValue, ref } from "firebase/database";

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
} from "react-icons/fi";

import { auth, db, rtdb } from "../../config/firebase";

// -------------------------------------------------------
// PRESENCE CONFIGURATION
// -------------------------------------------------------

const PRESENCE_TIMEOUT_MS = 30000;
const PRESENCE_CHECK_INTERVAL_MS = 5000;

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

const getTimestampMillis = (timestamp) => {
  if (!timestamp) return 0;

  if (typeof timestamp.toMillis === "function") {
    return timestamp.toMillis();
  }

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().getTime();
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === "number") {
    return timestamp;
  }

  return 0;
};

// Only consider a connection active if its heartbeat is fresh.
const hasFreshPresence = (presence) => {
  if (!presence || typeof presence !== "object") {
    return false;
  }

  const now = Date.now();

  return Object.values(presence).some((connection) => {
    if (
      !connection ||
      connection.state !== "connected"
    ) {
      return false;
    }

    const lastSeen = Number(connection.lastSeen);

    if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
      return false;
    }

    return now - lastSeen <= PRESENCE_TIMEOUT_MS;
  });
};

// -------------------------------------------------------
// STYLES
// -------------------------------------------------------

const css = `
* { box-sizing: border-box; }

.ss-layout {
  min-height: 100vh;
  background: #f5f7fb;
  color: #18243b;
  font-family: Inter, Arial, sans-serif;
}

.ss-sidebar {
  width: 248px;
  background: #17233b;
  color: #fff;
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 30;
  padding: 25px 17px;
  display: flex;
  flex-direction: column;
}

.ss-main {
  margin-left: 248px;
  min-width: 0;
}

.ss-brand {
  display:flex;
  align-items:center;
  gap:11px;
  padding: 0 10px 29px;
}

.ss-logo {
  width:40px;
  height:40px;
  display:grid;
  place-items:center;
  border-radius:13px;
  background:#ff7043;
  font-size:22px;
}

.ss-nav {
  display:flex;
  flex-direction:column;
  gap:7px;
}

.ss-nav button {
  width:100%;
  display:flex;
  align-items:center;
  gap:12px;
  padding:13px 14px;
  border:0;
  border-radius:10px;
  background:transparent;
  color:#c4ccdc;
  text-align:left;
  cursor:pointer;
  font-size:14px;
}

.ss-nav button.active,
.ss-nav button:hover {
  background:#293853;
  color:#fff;
}

.ss-nav button.active {
  box-shadow:inset 3px 0 #ff7043;
}

.ss-topbar {
  min-height:78px;
  padding:17px 30px;
  background:#fff;
  border-bottom:1px solid #e9edf4;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
}

.ss-content {
  max-width:1450px;
  margin:auto;
  padding:30px;
}

.ss-card {
  background:#fff;
  border:1px solid #e8edf4;
  border-radius:17px;
  padding:21px;
  box-shadow:0 4px 18px rgba(25,42,72,.025);
  min-width:0;
}

.ss-stats {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:16px;
  margin:24px 0;
}

.ss-stat-top {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  color:#68758c;
  font-size:13px;
}

.ss-stat-icon {
  width:40px;
  height:40px;
  border-radius:12px;
  display:grid;
  place-items:center;
  font-size:19px;
}

.ss-stat-value {
  font-size:31px;
  font-weight:750;
  margin:14px 0 5px;
  letter-spacing:-1px;
}

.ss-muted {
  color:#78849a;
  font-size:13px;
  line-height:1.6;
}

.ss-primary {
  display:inline-flex;
  justify-content:center;
  align-items:center;
  gap:8px;
  padding:11px 15px;
  background:#ff7043;
  color:white;
  border:0;
  border-radius:10px;
  font-weight:650;
  font-size:13px;
  cursor:pointer;
}

.ss-primary:hover {
  background:#f15d30;
}

.ss-primary:disabled,
.ss-secondary:disabled {
  opacity:.6;
  cursor:not-allowed;
}

.ss-secondary {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  padding:10px 13px;
  background:#fff;
  color:#25344e;
  border:1px solid #dfe5ef;
  border-radius:10px;
  cursor:pointer;
  font-weight:600;
  font-size:13px;
}

.ss-device-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:15px;
  margin-top:20px;
}

.ss-device {
  padding:18px;
  border:1px solid #e8edf4;
  border-radius:14px;
  background:#fff;
  min-width:0;
}

.ss-device-head {
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}

.ss-phone {
  width:46px;
  height:46px;
  flex-shrink:0;
  display:grid;
  place-items:center;
  background:#eef2ff;
  color:#5365bb;
  border-radius:13px;
  font-size:22px;
}

.ss-status {
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:6px 9px;
  border-radius:30px;
  font-size:11px;
  font-weight:700;
  white-space:nowrap;
}

.ss-status.online {
  background:#e5f8ed;
  color:#18794e;
}

.ss-status.offline {
  background:#fff0eb;
  color:#b8492d;
}

.ss-input {
  width:100%;
  padding:12px 13px;
  margin:7px 0 15px;
  border:1px solid #dfe5ef;
  border-radius:10px;
  outline:none;
  background:#fff;
  color:#18243b;
  font-size:14px;
}

.ss-input:focus {
  border-color:#ff7043;
  box-shadow:0 0 0 3px #ff70431a;
}

.ss-empty {
  text-align:center;
  padding:42px 18px;
  background:#fafbfe;
  border:1px dashed #d9e0eb;
  border-radius:14px;
  margin-top:20px;
}

.ss-error {
  background:#fff0ed;
  color:#a83220;
  padding:13px 15px;
  border-radius:10px;
  margin:16px 0;
  font-size:13px;
  overflow-wrap:anywhere;
}

.ss-overlay {
  display:none;
}

.ss-mobile-menu {
  display:none;
}

.ss-bottom {
  display:none;
}

@media(max-width:1050px) {
  .ss-stats {
    grid-template-columns:repeat(2,minmax(0,1fr));
  }

  .ss-content {
    padding:24px;
  }
}

@media(max-width:700px) {
  .ss-sidebar {
    transform:translateX(-105%);
    transition:transform .25s ease;
    width:270px;
    box-shadow:none;
  }

  .ss-sidebar.open {
    transform:translateX(0);
    box-shadow:10px 0 40px #101c3230;
  }

  .ss-overlay.show {
    display:block;
    position:fixed;
    inset:0;
    z-index:25;
    background:#10182770;
  }

  .ss-main {
    margin-left:0;
    padding-bottom:72px;
  }

  .ss-topbar {
    min-height:65px;
    padding:12px 16px;
  }

  .ss-content {
    padding:22px 15px;
  }

  .ss-mobile-menu {
    display:grid;
    place-items:center;
    width:39px;
    height:39px;
    border:1px solid #e5e9f1;
    background:#fff;
    border-radius:10px;
    color:#18243b;
  }

  .ss-stats {
    gap:10px;
    margin:19px 0;
  }

  .ss-card {
    padding:16px;
    border-radius:14px;
  }

  .ss-stat-value {
    font-size:27px;
  }

  .ss-stat-icon {
    width:34px;
    height:34px;
  }

  .ss-device-grid {
    grid-template-columns:1fr;
  }

  .ss-bottom {
    position:fixed;
    bottom:0;
    left:0;
    right:0;
    z-index:20;
    background:#fff;
    border-top:1px solid #e7ebf3;
    display:grid;
    grid-template-columns:repeat(4,1fr);
    padding:7px 4px max(7px,env(safe-area-inset-bottom));
  }

  .ss-bottom button {
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:4px;
    border:0;
    background:transparent;
    color:#77839a;
    font-size:10px;
    padding:6px 2px;
  }

  .ss-bottom button.active {
    color:#ff7043;
    font-weight:700;
  }

  .ss-page-title {
    font-size:25px !important;
  }

  .ss-hide-mobile {
    display:none !important;
  }
}

@media(max-width:370px) {
  .ss-stats {
    grid-template-columns:1fr 1fr;
    gap:8px;
  }

  .ss-stat-value {
    font-size:24px;
  }

  .ss-stat-top {
    font-size:11px;
  }
}
`;

// -------------------------------------------------------
// ADMIN DASHBOARD
// -------------------------------------------------------

const AdminDashboard = () => {
  const navigate = useNavigate();

  const [devices, setDevices] = useState([]);
  const [presenceByDevice, setPresenceByDevice] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [deviceName, setDeviceName] = useState("");
  const [childUid, setChildUid] = useState("");

  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // -------------------------------------------------------
  // REALTIME DEVICE AND PRESENCE LISTENERS
  // -------------------------------------------------------

  useEffect(() => {
    let unsubscribeDevices = null;
    let authSession = 0;

    // Each map entry contains a Firebase listener cleanup.
    const presenceListeners = new Map();

    const clearPresenceListeners = () => {
      presenceListeners.forEach((cleanup) => {
        cleanup();
      });

      presenceListeners.clear();
    };

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (parent) => {
        authSession += 1;

        const currentSession = authSession;

        if (unsubscribeDevices) {
          unsubscribeDevices();
          unsubscribeDevices = null;
        }

        clearPresenceListeners();

        setDevices([]);
        setPresenceByDevice({});

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

            const activeDevices = updatedDevices
              .map((device) => {
                const userId = device.userId;
                const deviceId = device.deviceId || device.id;

                if (!userId || !deviceId) return null;

                return {
                  userId,
                  deviceId,
                  key: `${userId}_${deviceId}`,
                };
              })
              .filter(Boolean);

            const activeKeys = new Set(
              activeDevices.map((device) => device.key)
            );

            // Remove listeners for deleted devices.
            presenceListeners.forEach((cleanup, key) => {
              if (!activeKeys.has(key)) {
                cleanup();
                presenceListeners.delete(key);

                setPresenceByDevice((previous) => {
                  const updated = { ...previous };
                  delete updated[key];
                  return updated;
                });
              }
            });

            // Subscribe to every device.
            activeDevices.forEach(
              ({ userId, deviceId, key }) => {
                if (presenceListeners.has(key)) return;

                const devicePresenceRef = ref(
                  rtdb,
                  `presence/${userId}/${deviceId}`
                );

                let latestPresence = null;

                // Calculate presence using lastSeen.
                const evaluatePresence = () => {
                  const isConnected = hasFreshPresence(
                    latestPresence
                  );

                  setPresenceByDevice((previous) => {
                    const nextStatus = isConnected
                      ? "connected"
                      : "disconnected";

                    if (previous[key] === nextStatus) {
                      return previous;
                    }

                    return {
                      ...previous,
                      [key]: nextStatus,
                    };
                  });
                };

                // Firebase realtime listener.
                const unsubscribePresence = onValue(
                  devicePresenceRef,
                  (presenceSnapshot) => {
                    if (currentSession !== authSession) return;

                    latestPresence = presenceSnapshot.val();

                    evaluatePresence();

                    console.log(
                      "ADMIN DEVICE PRESENCE:",
                      {
                        userId,
                        deviceId,
                        state: hasFreshPresence(latestPresence)
                          ? "connected"
                          : "disconnected",
                        data: latestPresence,
                      }
                    );
                  },
                  (presenceError) => {
                    if (currentSession !== authSession) return;

                    console.error(
                      "ADMIN PRESENCE LISTENER ERROR:",
                      {
                        userId,
                        deviceId,
                        error: presenceError,
                      }
                    );

                    setPresenceByDevice((previous) => ({
                      ...previous,
                      [key]: "disconnected",
                    }));

                    setError(
                      `Presence error: ${
                        presenceError.code ||
                        presenceError.message
                      }`
                    );
                  }
                );

                // Recheck stale timestamps every 5 seconds.
                const checkTimer = setInterval(() => {
                  if (currentSession !== authSession) return;

                  evaluatePresence();
                }, PRESENCE_CHECK_INTERVAL_MS);

                // Save both cleanup operations.
                presenceListeners.set(key, () => {
                  unsubscribePresence();
                  clearInterval(checkTimer);
                });
              }
            );

            console.log(
              "ADMIN: Live devices loaded:",
              updatedDevices
            );
          },
          (err) => {
            if (currentSession !== authSession) return;

            console.error(
              "ADMIN DEVICE LISTENER ERROR:",
              err
            );

            setError(
              `Unable to receive live device updates: ${
                err.code || err.message
              }`
            );

            setLoading(false);
          }
        );
      }
    );

    return () => {
      authSession += 1;

      unsubscribeAuth();

      if (unsubscribeDevices) {
        unsubscribeDevices();
      }

      clearPresenceListeners();
    };
  }, [navigate]);

  // -------------------------------------------------------
  // MANUAL REFRESH
  // -------------------------------------------------------

  const loadDevices = async () => {
    const parent = auth.currentUser;

    if (!parent) {
      navigate("/admin/login", { replace: true });
      return;
    }

    setLoading(true);
    setError("");

    try {
      const devicesQuery = query(
        collection(db, "devices"),
        where("parentId", "==", parent.uid)
      );

      const snapshot = await getDocs(devicesQuery);

      setDevices(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (err) {
      console.error("Device loading failed:", err);

      setError(
        `Could not load devices (${
          err.code || "unknown error"
        }).`
      );
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------
  // ADD DEVICE
  // -------------------------------------------------------

  const handleAddDevice = async (e) => {
    e.preventDefault();

    const parent = auth.currentUser;

    if (!parent) {
      navigate("/admin/login", { replace: true });
      return;
    }

    if (!deviceName.trim() || !childUid.trim()) {
      setError(
        "Please enter both the device name and user's Firebase UID."
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      await addDoc(collection(db, "devices"), {
        deviceName: deviceName.trim(),
        parentId: parent.uid,
        userId: childUid.trim(),
        status: "disconnected",
        createdAt: serverTimestamp(),
      });

      setDeviceName("");
      setChildUid("");
      setShowAdd(false);
    } catch (err) {
      console.error("Device creation failed:", err);

      setError(
        `Could not add device (${
          err.code || "unknown error"
        }). Check Firestore Rules.`
      );
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // LOGOUT
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // DEVICE COUNTS
  // -------------------------------------------------------

  const getDevicePresenceKey = (device) => {
    const deviceId = device.deviceId || device.id;
    return `${device.userId}_${deviceId}`;
  };

  const connected = devices.filter((device) => {
    const key = getDevicePresenceKey(device);
    return presenceByDevice[key] === "connected";
  }).length;

  const disconnected = devices.length - connected;

  const filteredDevices = devices.filter((device) =>
    `${device.deviceName || ""} ${device.userId || ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  // -------------------------------------------------------
  // NAVIGATION
  // -------------------------------------------------------

  const navItems = [
    {
      label: "Overview",
      icon: <FiGrid />,
      action: () =>
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        }),
    },
    {
      label: "My Devices",
      icon: <FiSmartphone />,
      action: () =>
        document.getElementById("devices")?.scrollIntoView({
          behavior: "smooth",
        }),
    },
    {
      label: "Usage Analytics",
      icon: <FiActivity />,
      action: () =>
        document.getElementById("analytics")?.scrollIntoView({
          behavior: "smooth",
        }),
    },
    {
      label: "Settings",
      icon: <FiSettings />,
      action: () =>
        setError("Settings are not connected yet."),
    },
  ];

  const closeMenuAndRun = (action) => {
    setMenuOpen(false);
    action();
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------

  return (
    <div className="ss-layout">
      <style>{css}</style>

      <div
        className={`ss-overlay ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* SIDEBAR */}

      <aside className={`ss-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="ss-brand">
          <div className="ss-logo">
            <FiShield />
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>
              Smart Shield
            </div>

            <div
              style={{
                fontSize: 11,
                color: "#aebbd0",
                marginTop: 4,
              }}
            >
              DIGITAL WELLBEING
            </div>
          </div>

          <button
            className="ss-mobile-menu"
            style={{
              marginLeft: "auto",
              background: "transparent",
              color: "#fff",
              borderColor: "#43506a",
            }}
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <FiX />
          </button>
        </div>

        <div
          style={{
            padding: "0 12px 12px",
            color: "#8795ad",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.3,
          }}
        >
          WORKSPACE
        </div>

        <nav className="ss-nav">
          {navItems.map((item, index) => (
            <button
              key={item.label}
              className={index === 0 ? "active" : ""}
              onClick={() => closeMenuAndRun(item.action)}
            >
              <span style={{ fontSize: 18 }}>
                {item.icon}
              </span>

              {item.label}

              {index === 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    color: "#ff956f",
                  }}
                >
                  •
                </span>
              )}
            </button>
          ))}
        </nav>

        <div
          style={{
            marginTop: "auto",
            padding: 14,
            background: "#202f49",
            borderRadius: 13,
          }}
        >
          <FiShield size={21} color="#ff916d" />

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              marginTop: 10,
            }}
          >
            Family protection
          </div>

          <div
            style={{
              color: "#aebbd0",
              fontSize: 11,
              lineHeight: 1.6,
              marginTop: 5,
            }}
          >
            Manage linked devices and monitor synchronized activity.
          </div>
        </div>

        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
            background: "transparent",
            border: 0,
            color: "#c4ccdc",
            padding: 13,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <FiLogOut /> Sign out
        </button>
      </aside>

      {/* MAIN CONTENT */}

      <div className="ss-main">
        <header className="ss-topbar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <button
              className="ss-mobile-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <FiMenu />
            </button>

            <div>
              <div style={{ fontWeight: 750, fontSize: 15 }}>
                Parent Portal
              </div>

              <div className="ss-muted" style={{ fontSize: 11 }}>
                Smart Shield / Overview
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              className="ss-hide-mobile"
              style={{ textAlign: "right" }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                Parent Account
              </div>

              <div
                style={{
                  color: "#78849a",
                  fontSize: 11,
                  marginTop: 3,
                }}
              >
                {auth.currentUser?.email || "Signed in"}
              </div>
            </div>

            <div
              style={{
                width: 39,
                height: 39,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "#fff0e9",
                color: "#d95a32",
                fontWeight: 800,
              }}
            >
              {(auth.currentUser?.email || "P")
                .charAt(0)
                .toUpperCase()}
            </div>
          </div>
        </header>

        <main className="ss-content">
          {/* PAGE HEADING */}

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 15,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: "#ff7043",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.5,
                }}
              >
                YOUR FAMILY SPACE
              </div>

              <h1
                className="ss-page-title"
                style={{
                  fontSize: 30,
                  margin: "9px 0 7px",
                  letterSpacing: "-.8px",
                }}
              >
                Dashboard overview
              </h1>

              <p className="ss-muted" style={{ margin: 0 }}>
                Keep track of your linked devices in one place.
              </p>
            </div>

            <button
              className="ss-primary"
              onClick={() => setShowAdd(true)}
            >
              <FiPlus size={17} /> Add Device
            </button>
          </div>

          {error && (
            <div className="ss-error" role="alert">
              {error}

              <button
                className="ss-secondary"
                style={{ marginLeft: 10 }}
                onClick={() => {
                  setError("");
                  loadDevices();
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* STATISTICS */}

          <section className="ss-stats">
            <div className="ss-card">
              <div className="ss-stat-top">
                Total devices

                <span
                  className="ss-stat-icon"
                  style={{
                    background: "#fff0e9",
                    color: "#ed6a3c",
                  }}
                >
                  <FiSmartphone />
                </span>
              </div>

              <div className="ss-stat-value">
                {loading ? "—" : devices.length}
              </div>

              <div className="ss-muted">
                Registered device records
              </div>
            </div>

            <div className="ss-card">
              <div className="ss-stat-top">
                Connected

                <span
                  className="ss-stat-icon"
                  style={{
                    background: "#e5f8ed",
                    color: "#168451",
                  }}
                >
                  <FiWifi />
                </span>
              </div>

              <div className="ss-stat-value">
                {loading ? "—" : connected}
              </div>

              <div className="ss-muted">
                Devices reporting within 30 seconds
              </div>
            </div>

            <div className="ss-card">
              <div className="ss-stat-top">
                Disconnected

                <span
                  className="ss-stat-icon"
                  style={{
                    background: "#fff0eb",
                    color: "#c45234",
                  }}
                >
                  <FiWifiOff />
                </span>
              </div>

              <div className="ss-stat-value">
                {loading ? "—" : disconnected}
              </div>

              <div className="ss-muted">
                No recent presence heartbeat
              </div>
            </div>

            <div className="ss-card">
              <div className="ss-stat-top">
                Usage analytics

                <span
                  className="ss-stat-icon"
                  style={{
                    background: "#eef1ff",
                    color: "#5969bd",
                  }}
                >
                  <FiActivity />
                </span>
              </div>

              <div
                className="ss-stat-value"
                style={{
                  fontSize: 22,
                  letterSpacing: 0,
                }}
              >
                {devices.length ? "In progress" : "Not linked"}
              </div>

              <div className="ss-muted">
                Requires device usage sync
              </div>
            </div>
          </section>

          {/* DEVICES */}

          <section className="ss-card" id="devices">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 19,
                    letterSpacing: "-.3px",
                  }}
                >
                  My Devices
                </h2>

                <p className="ss-muted" style={{ margin: "6px 0 0" }}>
                  Manage devices associated with your account.
                </p>
              </div>

              <button
                className="ss-secondary"
                onClick={loadDevices}
                disabled={loading}
              >
                <FiRefreshCw /> Refresh
              </button>
            </div>

            <div style={{ position: "relative", marginTop: 19 }}>
              <FiSearch
                style={{
                  position: "absolute",
                  left: 13,
                  top: 13,
                  color: "#8a95a9",
                }}
              />

              <input
                className="ss-input"
                style={{
                  paddingLeft: 39,
                  margin: 0,
                }}
                placeholder="Search device name or user UID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search devices"
              />
            </div>

            {loading ? (
              <div className="ss-empty">
                <FiRefreshCw size={25} />

                <p className="ss-muted">
                  Loading your devices...
                </p>
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="ss-empty">
                <div
                  style={{
                    width: 65,
                    height: 65,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 20,
                    background: "#fff0e9",
                    color: "#f06d40",
                    margin: "0 auto 15px",
                    fontSize: 29,
                  }}
                >
                  <FiSmartphone />
                </div>

                <h3
                  style={{
                    fontSize: 17,
                    margin: "0 0 7px",
                  }}
                >
                  {search
                    ? "No matching devices"
                    : "No devices connected yet"}
                </h3>

                <p
                  className="ss-muted"
                  style={{
                    maxWidth: 340,
                    margin: "0 auto 18px",
                  }}
                >
                  {search
                    ? "Try a different device name or UID."
                    : "Add a device record to get started. Your child's phone must complete the pairing and sync process before it can report real activity."}
                </p>

                {!search && (
                  <button
                    className="ss-primary"
                    onClick={() => setShowAdd(true)}
                  >
                    <FiPlus /> Add your first device
                  </button>
                )}
              </div>
            ) : (
              <div className="ss-device-grid">
                {filteredDevices.map((device) => {
                  const presenceKey =
                    getDevicePresenceKey(device);

                  const deviceOnline =
                    presenceByDevice[presenceKey] === "connected";

                  const lastSync = getTimestampMillis(
                    device.lastSyncAt
                  );

                  return (
                    <article
                      className="ss-device"
                      key={device.id}
                    >
                      <div className="ss-device-head">
                        <div className="ss-phone">
                          <FiSmartphone />
                        </div>

                        <div
                          style={{
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 750,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {device.deviceName || "Android Device"}
                          </div>

                          <div
                            className="ss-muted"
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                            }}
                          >
                            {device.model || "Smart Shield device"}
                          </div>
                        </div>

                        <span
                          className={`ss-status ${
                            deviceOnline ? "online" : "offline"
                          }`}
                        >
                          {deviceOnline ? <FiWifi /> : <FiWifiOff />}

                          {deviceOnline
                            ? "Connected"
                            : "Disconnected"}
                        </span>
                      </div>

                      <div
                        style={{
                          borderTop: "1px solid #edf0f5",
                          marginTop: 17,
                          paddingTop: 14,
                        }}
                      >
                        <div
                          className="ss-muted"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          User UID: {device.userId || "Not assigned"}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            marginTop: 10,
                            color: "#78849a",
                            fontSize: 11,
                          }}
                        >
                          <FiClock />

                          {lastSync
                            ? `Last sync: ${new Date(
                                lastSync
                              ).toLocaleString()}`
                            : "No sync time recorded"}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* USAGE ANALYTICS */}

          <section
            className="ss-card"
            id="analytics"
            style={{ marginTop: 20 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                className="ss-stat-icon"
                style={{
                  background: "#eef1ff",
                  color: "#5969bd",
                }}
              >
                <FiActivity />
              </div>

              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  Usage Analytics
                </h2>

                <p className="ss-muted" style={{ margin: "5px 0 0" }}>
                  Screen-time reports will appear here after your Android app synchronizes usage data.
                </p>
              </div>
            </div>
          </section>

          <footer
            className="ss-muted"
            style={{
              textAlign: "center",
              marginTop: 25,
              fontSize: 11,
            }}
          >
            Smart Shield · Family digital wellbeing
          </footer>
        </main>
      </div>

      {/* MOBILE NAVIGATION */}

      <nav className="ss-bottom" aria-label="Mobile navigation">
        {navItems.map((item, index) => (
          <button
            key={item.label}
            className={index === 0 ? "active" : ""}
            onClick={item.action}
          >
            <span style={{ fontSize: 19 }}>
              {item.icon}
            </span>

            {index === 0
              ? "Home"
              : index === 1
                ? "Devices"
                : index === 2
                  ? "Usage"
                  : "Settings"}
          </button>
        ))}
      </nav>

      {/* ADD DEVICE MODAL */}

      {showAdd && (
        <div
          onClick={() => !saving && setShowAdd(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "#111b2e99",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            overflowY: "auto",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-device-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "#fff",
              borderRadius: 19,
              padding: 23,
              boxShadow: "0 25px 80px #0003",
              margin: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    color: "#ff7043",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 1.2,
                  }}
                >
                  DEVICE MANAGEMENT
                </div>

                <h2
                  id="add-device-title"
                  style={{
                    margin: "7px 0 0",
                    fontSize: 22,
                  }}
                >
                  Add a device
                </h2>
              </div>

              <button
                className="ss-secondary"
                onClick={() => setShowAdd(false)}
                disabled={saving}
                aria-label="Close dialog"
              >
                <FiX />
              </button>
            </div>

            <p className="ss-muted" style={{ margin: "12px 0 20px" }}>
              Enter the device name and an existing user's Firebase UID.
            </p>

            <form onSubmit={handleAddDevice}>
              <label style={{ fontSize: 13, fontWeight: 650 }}>
                Device name

                <input
                  className="ss-input"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. Child's Android Phone"
                  required
                />
              </label>

              <label style={{ fontSize: 13, fontWeight: 650 }}>
                User's Firebase UID

                <input
                  className="ss-input"
                  value={childUid}
                  onChange={(e) => setChildUid(e.target.value)}
                  placeholder="Paste the existing user's UID"
                  required
                />
              </label>

              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "#fff6ef",
                  color: "#94502f",
                  fontSize: 12,
                  lineHeight: 1.6,
                  marginBottom: 17,
                }}
              >
                Saving this record does not pair the physical phone. The phone must sign in with the assigned user account to complete pairing.
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="ss-primary"
                  type="submit"
                  disabled={saving}
                >
                  <FiPlus />
                  {saving ? "Saving..." : "Save device record"}
                </button>

                <button
                  className="ss-secondary"
                  type="button"
                  onClick={() => setShowAdd(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
