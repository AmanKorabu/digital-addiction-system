
import { useEffect } from "react";

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
} from "../services/devicePresenceService";

const DeviceSync = () => {
  useEffect(() => {
    let session = 0;

    let heartbeatTimer = null;
    let retryTimer = null;

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

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      if (stopCommands) {
        stopCommands();
        stopCommands = null;
      }

      if (networkListener) {
        networkListener.remove().catch((error) => {
          console.error(
            "NETWORK LISTENER CLEANUP ERROR:",
            error
          );
        });

        networkListener = null;
      }

      if (stopPresence) {
        const cleanup = stopPresence();

        Promise.resolve(cleanup).catch((error) => {
          console.error(
            "PRESENCE CLEANUP ERROR:",
            error
          );
        });

        stopPresence = null;
      }

      activeDeviceId = null;
      networkConnected = false;

      heartbeatRunning = false;
      fullSyncRunning = false;

      console.log("SMART SHIELD: Monitoring stopped");
    };

    // -----------------------------------------------
    // HEARTBEAT
    // -----------------------------------------------

    const sendHeartbeat = async (
      deviceId,
      currentSession
    ) => {
      if (
        !deviceId ||
        !networkConnected ||
        heartbeatRunning ||
        currentSession !== session
      ) {
        return;
      }

      heartbeatRunning = true;

      try {
        const result = await syncDeviceHeartbeat(deviceId);

        if (currentSession !== session) return;

        if (result?.success) {
          console.log(
            "SMART SHIELD HEARTBEAT SUCCESS:",
            deviceId
          );
        } else {
          console.error(
            "SMART SHIELD HEARTBEAT FAILED:",
            result
          );
        }
      } catch (error) {
        console.error(
          "SMART SHIELD HEARTBEAT ERROR:",
          error
        );
      } finally {
        heartbeatRunning = false;
      }
    };

    // -----------------------------------------------
    // FULL DEVICE STATUS SYNC
    // -----------------------------------------------

    const sendFullSync = async (
      deviceId,
      currentSession
    ) => {
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
        const result = await syncDeviceStatus(deviceId, {
          includeUsage: false,
        });

        if (currentSession !== session) return;

        if (result?.success) {
          console.log(
            "SMART SHIELD DEVICE STATUS SYNC SUCCESS:",
            deviceId
          );
        } else {
          console.error(
            "SMART SHIELD DEVICE STATUS SYNC FAILED:",
            result
          );
        }
      } catch (error) {
        console.error(
          "SMART SHIELD DEVICE STATUS SYNC ERROR:",
          error
        );
      } finally {
        fullSyncRunning = false;
      }
    };

    // -----------------------------------------------
    // DEVICE-SPECIFIC REALTIME DATABASE PRESENCE
    // -----------------------------------------------

    const setupPresence = (
      userId,
      deviceId,
      currentSession
    ) => {
      try {
        console.log(
          "SMART SHIELD: Starting device presence",
          {
            userId,
            deviceId,
          }
        );

        stopPresence = startDevicePresence(
          userId,
          deviceId,

          // Firebase connection status callback
          (connected) => {
            if (currentSession !== session) return;

            console.log(
              "SMART SHIELD LIVE PRESENCE:",
              connected ? "CONNECTED" : "DISCONNECTED",
              deviceId
            );
          },

          // Presence error callback
          (error) => {
            console.error(
              "SMART SHIELD PRESENCE ERROR:",
              error
            );
          }
        );
      } catch (error) {
        console.error(
          "SMART SHIELD PRESENCE START ERROR:",
          error
        );
      }
    };

    // -----------------------------------------------
    // CAPACITOR NETWORK MONITORING
    // -----------------------------------------------

    const setupNetwork = async (
      deviceId,
      currentSession
    ) => {
      try {
        const initialStatus = await Network.getStatus();

        if (currentSession !== session) return;

        networkConnected = Boolean(initialStatus.connected);

        console.log(
          "SMART SHIELD NETWORK INITIAL STATUS:",
          initialStatus
        );

        networkListener = await Network.addListener(
          "networkStatusChange",
          async (status) => {
            if (currentSession !== session) return;

            networkConnected = Boolean(status.connected);

            console.log(
              "SMART SHIELD NETWORK CHANGED:",
              status
            );

            if (networkConnected) {
              console.log(
                "SMART SHIELD: Network restored"
              );

              await sendHeartbeat(
                deviceId,
                currentSession
              );

              await sendFullSync(
                deviceId,
                currentSession
              );
            } else {
              console.log(
                "SMART SHIELD: Network unavailable"
              );
            }
          }
        );

        // Initial sync when internet is available.
        if (networkConnected) {
          await sendHeartbeat(
            deviceId,
            currentSession
          );

          await sendFullSync(
            deviceId,
            currentSession
          );
        }
      } catch (error) {
        console.error(
          "SMART SHIELD NETWORK MONITOR ERROR:",
          error
        );

        if (currentSession !== session) return;

        networkConnected = navigator.onLine !== false;

        if (networkConnected) {
          await sendHeartbeat(
            deviceId,
            currentSession
          );

          await sendFullSync(
            deviceId,
            currentSession
          );
        }
      }
    };

    // -----------------------------------------------
    // START MONITORING FOR SIGNED-IN USER
    // -----------------------------------------------

    const startMonitoring = async (
      user,
      currentSession
    ) => {
      try {
        console.log(
          "SMART SHIELD: Checking user profile:",
          user.uid
        );

        // 1. Load user profile.
        const profileSnapshot = await getDoc(
          doc(db, "users", user.uid)
        );

        if (currentSession !== session) return;

        if (!profileSnapshot.exists()) {
          console.warn(
            "SMART SHIELD: User profile not found"
          );

          return;
        }

        const profile = profileSnapshot.data();

        // 2. Check user eligibility.
        if (
          profile.role !== "user" ||
          profile.status !== "active"
        ) {
          console.log(
            "SMART SHIELD: User is not eligible for device sync",
            {
              role: profile.role,
              status: profile.status,
            }
          );

          return;
        }

        // 3. Register or retrieve device.
        console.log(
          "SMART SHIELD: Registering device..."
        );

        const registration = await ensureDeviceRegistered(
          user.uid
        );

        if (currentSession !== session) return;

        if (!registration?.success) {
          console.error(
            "SMART SHIELD DEVICE REGISTRATION FAILED:",
            registration?.error
          );

          // Retry if the user has not yet been linked.
          if (
            registration?.code === LINK_ERRORS.NOT_LINKED
          ) {
            console.log(
              "SMART SHIELD: Waiting for device linking..."
            );

            retryTimer = setTimeout(() => {
              if (currentSession !== session) return;

              startMonitoring(
                user,
                currentSession
              );
            }, HEARTBEAT_MS);
          }

          return;
        }

        // 4. Get the registered device ID.
        const deviceId = registration.deviceId;

        if (!deviceId) {
          console.error(
            "SMART SHIELD: Registration returned no device ID"
          );

          return;
        }

        activeDeviceId = deviceId;

        console.log(
          "SMART SHIELD: DEVICE REGISTERED",
          {
            userId: user.uid,
            deviceId,
          }
        );

        // 5. Start device-specific Firebase presence.
        setupPresence(
          user.uid,
          deviceId,
          currentSession
        );

        // 6. Subscribe to remote device commands.
        stopCommands = subscribeToDeviceCommands(
          deviceId
        );

        console.log(
          "SMART SHIELD: Remote commands listener started",
          deviceId
        );

        // 7. Start network monitoring and initial sync.
        await setupNetwork(
          deviceId,
          currentSession
        );

        if (currentSession !== session) return;

        // 8. Start periodic Firestore heartbeat.
        heartbeatTimer = setInterval(() => {
          sendHeartbeat(
            deviceId,
            currentSession
          );
        }, HEARTBEAT_MS);

        console.log(
          "SMART SHIELD DEVICE MONITORING STARTED:",
          deviceId
        );
      } catch (error) {
        console.error(
          "SMART SHIELD STARTUP ERROR:",
          error
        );
      }
    };

    // -----------------------------------------------
    // AUTHENTICATION LISTENER
    // -----------------------------------------------

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => {
        session += 1;

        stopMonitoring();

        const currentSession = session;

        if (user) {
          console.log(
            "SMART SHIELD: USER AUTHENTICATED",
            user.uid
          );

          startMonitoring(
            user,
            currentSession
          );
        } else {
          console.log(
            "SMART SHIELD: NO AUTHENTICATED USER"
          );
        }
      }
    );

    // -----------------------------------------------
    // APP RETURNS TO FOREGROUND
    // -----------------------------------------------

    const handleVisibilityChange = async () => {
      if (
        document.visibilityState !== "visible" ||
        !activeDeviceId
      ) {
        return;
      }

      const currentSession = session;
      const deviceId = activeDeviceId;

      try {
        console.log(
          "SMART SHIELD: App returned to foreground"
        );

        const status = await Network.getStatus();

        if (currentSession !== session) return;

        networkConnected = Boolean(status.connected);

        if (networkConnected) {
          await sendHeartbeat(
            deviceId,
            currentSession
          );

          await sendFullSync(
            deviceId,
            currentSession
          );
        }
      } catch (error) {
        console.error(
          "SMART SHIELD FOREGROUND SYNC ERROR:",
          error
        );
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    // -----------------------------------------------
    // COMPONENT CLEANUP
    // -----------------------------------------------

    return () => {
      session += 1;

      unsubscribeAuth();

      stopMonitoring();

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      console.log(
        "SMART SHIELD: DeviceSync component cleaned up"
      );
    };
  }, []);

  return null;
};

export default DeviceSync;
