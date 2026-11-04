import { useEffect } from "react";
import {
  startBackgroundSync,
  stopBackgroundSync,
} from "../services/backgroundSyncService";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Network } from "@capacitor/network";

import { auth, db } from "../config/firebase";

import {
  HEARTBEAT_MS,
  LINK_ERRORS,
  ensureDeviceRegistered,
  subscribeToDeviceCommands,
  syncDeviceHeartbeat,
  syncDeviceStatus,
} from "../services/deviceControlService";

import {
  startDevicePresence,
  updateFirestoreHeartbeat,
} from "../services/devicePresenceService";

import { hasUsageAccess } from "../services/usageStatsService";

const DeviceSync = () => {
  useEffect(() => {
    let session = 0;

    let heartbeatTimer = null;
    let retryTimer = null;
    let fullSyncTimer = null;

    let networkListener = null;
    let stopCommands = null;
    let stopPresence = null;

    let activeDeviceId = null;
    let networkConnected = false;
    let heartbeatRunning = false;
    let fullSyncRunning = false;

    // -----------------------------------------------
    // STOP ALL MONITORING
    // -----------------------------------------------

    const stopMonitoring = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (fullSyncTimer) {
        clearInterval(fullSyncTimer);
        fullSyncTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (stopCommands) {
        stopCommands();
        stopCommands = null;
      }
      if (networkListener) {
        networkListener.remove().catch(() => { });
        networkListener = null;
      }
      if (stopPresence) {
        const cleanup = stopPresence();
        Promise.resolve(cleanup).catch(() => { });
        stopPresence = null;
      }

      activeDeviceId = null;
      networkConnected = false;
      heartbeatRunning = false;
      fullSyncRunning = false;

      console.log("SMART SHIELD: Monitoring stopped");
    };

    // -----------------------------------------------
    // HEARTBEAT (Firestore + Device Status)
    // -----------------------------------------------

    const sendHeartbeat = async (deviceId, currentSession) => {
      if (!deviceId || currentSession !== session) return;
      if (heartbeatRunning) return;

      heartbeatRunning = true;

      try {
        // 1. Update Firestore lastSyncAt (survives app being killed briefly)
        await updateFirestoreHeartbeat(deviceId);

        // 2. Update device status in Firestore
        await syncDeviceHeartbeat(deviceId);

        if (currentSession !== session) return;

        console.log("SMART SHIELD: Heartbeat sent", deviceId);
      } catch (error) {
        console.error("SMART SHIELD HEARTBEAT ERROR:", error);
      } finally {
        if (currentSession === session) {
          heartbeatRunning = false;
        }
      }
    };

    // -----------------------------------------------
    // FULL DEVICE STATUS & USAGE SYNC
    // -----------------------------------------------

    const sendFullSync = async (deviceId, currentSession) => {
      if (
        !deviceId ||
        !networkConnected ||
        fullSyncRunning ||
        currentSession !== session
      ) {
        return;
      }

      fullSyncRunning = true;

      try {
        const access = await hasUsageAccess();
        const canIncludeUsage = Boolean(access.success && access.hasAccess);

        const result = await syncDeviceStatus(deviceId, {
          includeUsage: canIncludeUsage,
        });

        if (currentSession !== session) return;

        if (result?.success) {
          console.log("SMART SHIELD FULL SYNC SUCCESS:", deviceId);
        } else {
          console.error("SMART SHIELD FULL SYNC FAILED:", result);
        }
      } catch (error) {
        console.error("SMART SHIELD FULL SYNC ERROR:", error);
      } finally {
        fullSyncRunning = false;
      }
    };

    // -----------------------------------------------
    // REALTIME DATABASE PRESENCE
    // -----------------------------------------------

    const setupPresence = (userId, deviceId, currentSession) => {
      try {
        stopPresence = startDevicePresence(
          userId,
          deviceId,

          (connected) => {
            if (currentSession !== session) return;
            console.log(
              "SMART SHIELD LIVE PRESENCE:",
              connected ? "CONNECTED" : "DISCONNECTED",
              deviceId
            );
          },

          (error) => {
            console.error("SMART SHIELD PRESENCE ERROR:", error);
          }
        );
      } catch (error) {
        console.error("SMART SHIELD PRESENCE START ERROR:", error);
      }
    };

    // -----------------------------------------------
    // CAPACITOR NETWORK MONITORING
    // -----------------------------------------------

    const setupNetwork = async (deviceId, currentSession) => {
      try {
        const initialStatus = await Network.getStatus();
        if (currentSession !== session) return;

        networkConnected = Boolean(initialStatus.connected);

        networkListener = await Network.addListener(
          "networkStatusChange",
          async (status) => {
            if (currentSession !== session) return;
            networkConnected = Boolean(status.connected);

            if (networkConnected) {
              console.log("SMART SHIELD: Network restored");
              await sendHeartbeat(deviceId, currentSession);
              await sendFullSync(deviceId, currentSession);
            } else {
              console.log("SMART SHIELD: Network unavailable");
            }
          }
        );

        if (networkConnected) {
          await sendHeartbeat(deviceId, currentSession);
          await sendFullSync(deviceId, currentSession);
        }
      } catch (error) {
        console.error("SMART SHIELD NETWORK MONITOR ERROR:", error);
        if (currentSession !== session) return;
        networkConnected = navigator.onLine !== false;
        if (networkConnected) {
          await sendHeartbeat(deviceId, currentSession);
          await sendFullSync(deviceId, currentSession);
        }
      }
    };

    // -----------------------------------------------
    // START MONITORING FOR SIGNED-IN USER
    // -----------------------------------------------

    const startMonitoring = async (user, currentSession) => {
      try {
        const profileSnapshot = await getDoc(doc(db, "users", user.uid));
        if (currentSession !== session) return;

        if (!profileSnapshot.exists()) {
          return;
        }

        const profile = profileSnapshot.data();

        if (profile.role !== "user" || profile.status !== "active") {
          return;
        }

        const registration = await ensureDeviceRegistered(user.uid);
        if (currentSession !== session) return;

        if (!registration?.success) {
          if (registration?.code === LINK_ERRORS.NOT_LINKED) {
            retryTimer = setTimeout(() => {
              if (currentSession !== session) return;
              startMonitoring(user, currentSession);
            }, HEARTBEAT_MS);
          }
          return;
        }

        const deviceId = registration.deviceId;
        if (!deviceId) return;

        activeDeviceId = deviceId;

        // Start native Android background synchronization.
        const backgroundResult = await startBackgroundSync(user, deviceId);

        if (currentSession !== session) return;

        if (backgroundResult.success) {
          console.log(
            "SMART SHIELD: Native background service started",
            deviceId
          );
        } else {
          console.error(
            "SMART SHIELD: Native background service failed to start:",
            backgroundResult.error
          );
        }

        // Start RTDB presence
        setupPresence(user.uid, deviceId, currentSession);

        // Subscribe to remote admin commands
        stopCommands = subscribeToDeviceCommands(deviceId);

        // Start network monitoring + initial sync
        await setupNetwork(deviceId, currentSession);
        if (currentSession !== session) return;

        // Periodic heartbeat every 60 seconds
        heartbeatTimer = setInterval(() => {
          sendHeartbeat(deviceId, currentSession);
        }, HEARTBEAT_MS);

        // Periodic full sync every 5 minutes (usage + permissions + focus)
        fullSyncTimer = setInterval(() => {
          if (networkConnected) {
            sendFullSync(deviceId, currentSession);
          }
        }, 5 * 60 * 1000);

        console.log("SMART SHIELD BACKGROUND MONITORING STARTED:", deviceId);
      } catch (error) {
        console.error("SMART SHIELD STARTUP ERROR:", error);
      }
    };

    // -----------------------------------------------
    // AUTHENTICATION LISTENER
    // -----------------------------------------------

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      session += 1;
      stopMonitoring();

      const currentSession = session;

      if (user) {
        startMonitoring(user, currentSession);
      } else {
        // Stop native synchronization when the user signs out.
        stopBackgroundSync().then((result) => {
          if (!result.success) {
            console.error("SMART SHIELD: Unable to stop native service:", result.error);
          }
        });
      }
    });

    // -----------------------------------------------
    // APP RETURNS TO FOREGROUND
    // -----------------------------------------------

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible" || !activeDeviceId) {
        return;
      }

      const currentSession = session;
      const deviceId = activeDeviceId;

      try {
        const status = await Network.getStatus();
        if (currentSession !== session) return;

        networkConnected = Boolean(status.connected);

        if (networkConnected) {
          await sendHeartbeat(deviceId, currentSession);
          await sendFullSync(deviceId, currentSession);
        }
      } catch (error) {
        console.error("SMART SHIELD FOREGROUND SYNC ERROR:", error);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // -----------------------------------------------
    // COMPONENT CLEANUP
    // -----------------------------------------------

    return () => {
      session += 1;
      unsubscribeAuth();
      stopMonitoring();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      console.log("SMART SHIELD: DeviceSync cleaned up");
    };
  }, []);

  return null;
};

export default DeviceSync;