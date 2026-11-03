
import {
  ref,
  onValue,
  onDisconnect,
  set,
  update,
  remove,
  push,
  serverTimestamp,
} from "firebase/database";

import { rtdb } from "../config/firebase";

export const PRESENCE_HEARTBEAT_MS = 10000;
export const PRESENCE_TIMEOUT_MS = 30000;
const DASHBOARD_CHECK_MS = 5000;

// =============================================
// START DEVICE PRESENCE
// =============================================

export const startDevicePresence = (
  userId,
  deviceId,
  onConnectionChange,
  onError
) => {
  if (!userId || !deviceId) {
    throw new Error("User ID and Device ID are required.");
  }

  const connectionInfoRef = ref(rtdb, ".info/connected");
  const devicePresenceRef = ref(
    rtdb,
    `presence/${userId}/${deviceId}`
  );

  let stopped = false;
  let registering = false;
  let databaseConnected = false;
  let activeConnectionRef = null;
  let heartbeatTimer = null;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = (connectionRef) => {
    stopHeartbeat();

    heartbeatTimer = setInterval(async () => {
      if (
        stopped ||
        !databaseConnected ||
        activeConnectionRef !== connectionRef
      ) {
        return;
      }

      try {
        await update(connectionRef, {
          lastSeen: serverTimestamp(),
        });

        console.log("SMART SHIELD PRESENCE HEARTBEAT:", deviceId);
      } catch (error) {
        console.error(
          "SMART SHIELD PRESENCE HEARTBEAT ERROR:",
          error
        );
        onError?.(error);
      }
    }, PRESENCE_HEARTBEAT_MS);
  };

  const registerConnection = async () => {
    if (
      stopped ||
      !databaseConnected ||
      registering ||
      activeConnectionRef
    ) {
      return;
    }

    registering = true;

    const connectionRef = push(devicePresenceRef);

    try {
      // Register server-side cleanup BEFORE writing presence.
      await onDisconnect(connectionRef).remove();

      if (stopped || !databaseConnected) {
        await onDisconnect(connectionRef).cancel();
        return;
      }

      await set(connectionRef, {
        state: "connected",
        userId,
        deviceId,
        connectedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      });

      if (stopped || !databaseConnected) {
        await remove(connectionRef);
        await onDisconnect(connectionRef).cancel();
        return;
      }

      activeConnectionRef = connectionRef;

      startHeartbeat(connectionRef);

      onConnectionChange?.(true);

      console.log(
        "SMART SHIELD PRESENCE CONNECTED:",
        userId,
        deviceId,
        connectionRef.key
      );
    } catch (error) {
      console.error(
        "SMART SHIELD PRESENCE REGISTRATION ERROR:",
        error
      );
      onError?.(error);
    } finally {
      registering = false;
    }
  };

  const unsubscribe = onValue(
    connectionInfoRef,
    (snapshot) => {
      databaseConnected = snapshot.val() === true;

      console.log(
        "SMART SHIELD RTDB CONNECTION:",
        databaseConnected
      );

      if (!databaseConnected) {
        stopHeartbeat();
        activeConnectionRef = null;
        onConnectionChange?.(false);
        return;
      }

      registerConnection();
    },
    (error) => {
      console.error(
        "SMART SHIELD RTDB LISTENER ERROR:",
        error
      );

      stopHeartbeat();
      activeConnectionRef = null;
      onConnectionChange?.(false);
      onError?.(error);
    }
  );

  // =============================================
  // CLEANUP
  // =============================================

  const stop = async () => {
    stopped = true;
    stopHeartbeat();
    unsubscribe();

    const connectionRef = activeConnectionRef;
    activeConnectionRef = null;

    if (connectionRef) {
      try {
        await remove(connectionRef);
        await onDisconnect(connectionRef).cancel();

        console.log(
          "SMART SHIELD PRESENCE STOPPED:",
          userId,
          deviceId
        );
      } catch (error) {
        console.error(
          "SMART SHIELD PRESENCE CLEANUP ERROR:",
          error
        );
      }
    }
  };

  return stop;
};

// =============================================
// ADMIN DASHBOARD PRESENCE SUBSCRIPTION
// =============================================

export const subscribeToDevicePresence = (
  userId,
  deviceId,
  onData,
  onError
) => {
  const presenceRef = ref(
    rtdb,
    `presence/${userId}/${deviceId}`
  );

  let latestConnections = {};

  const calculatePresence = () => {
    const now = Date.now();

    const connections = Object.entries(latestConnections).reduce(
      (result, [connectionId, connection]) => {
        if (
          connection &&
          typeof connection === "object"
        ) {
          result[connectionId] = connection;
        }

        return result;
      },
      {}
    );

    const connected = Object.values(connections).some(
      (connection) => {
        const lastSeen = Number(connection.lastSeen);

        return (
          connection.state === "connected" &&
          Number.isFinite(lastSeen) &&
          now - lastSeen <= PRESENCE_TIMEOUT_MS
        );
      }
    );

    onData?.({
      connected,
      connections,
    });
  };

  const unsubscribe = onValue(
    presenceRef,
    (snapshot) => {
      latestConnections = snapshot.val() || {};
      calculatePresence();
    },
    (error) => {
      console.error(
        "SMART SHIELD PRESENCE SUBSCRIPTION ERROR:",
        error
      );
      onError?.(error);
    }
  );

  // Recalculate even if no new Firebase event arrives.
  const checkTimer = setInterval(
    calculatePresence,
    DASHBOARD_CHECK_MS
  );

  return () => {
    unsubscribe();
    clearInterval(checkTimer);
  };
};
