import {
  ref,
  onValue,
  onDisconnect,
  set,
  remove,
  push,
  serverTimestamp,
} from "firebase/database";

import { rtdb } from "../config/firebase";

// --------------------------------------------------
// START DEVICE PRESENCE
// --------------------------------------------------

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
  let databaseConnected = false;
  let registering = false;
  let activeConnectionRef = null;
  let lastReportedState = null;
  let connectionGeneration = 0;

  const notifyConnection = (connected) => {
    if (lastReportedState === connected) return;

    lastReportedState = connected;
    onConnectionChange?.(connected);
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

    const generation = connectionGeneration;
    const connectionRef = push(devicePresenceRef);

    let disconnectHandlerRegistered = false;
    let connectionWritten = false;

    try {
      // Register server-side cleanup first.
      await onDisconnect(connectionRef).remove();

      disconnectHandlerRegistered = true;

      if (
        stopped ||
        !databaseConnected ||
        generation !== connectionGeneration
      ) {
        await onDisconnect(connectionRef).cancel();
        return;
      }

      await set(connectionRef, {
        state: "connected",
        userId,
        deviceId,
        connectedAt: serverTimestamp(),
      });

      connectionWritten = true;

      if (
        stopped ||
        !databaseConnected ||
        generation !== connectionGeneration
      ) {
        await remove(connectionRef);

        if (disconnectHandlerRegistered) {
          await onDisconnect(connectionRef).cancel();
        }

        return;
      }

      activeConnectionRef = connectionRef;

      notifyConnection(true);

      console.log("SMART SHIELD: Firebase presence connected");
    } catch (error) {
      console.error("Presence registration error:", error);

      if (connectionWritten) {
        try {
          await remove(connectionRef);
        } catch (cleanupError) {
          console.error("Presence cleanup error:", cleanupError);
        }
      }

      if (disconnectHandlerRegistered) {
        try {
          await onDisconnect(connectionRef).cancel();
        } catch (cleanupError) {
          console.error("Disconnect cancellation error:", cleanupError);
        }
      }

      onError?.(error);
    } finally {
      registering = false;

      // If Firebase reconnected while registration was running,
      // attempt registration again.
      if (
        !stopped &&
        databaseConnected &&
        !activeConnectionRef &&
        generation !== connectionGeneration
      ) {
        registerConnection();
      }
    }
  };

  const unsubscribe = onValue(
    connectionInfoRef,
    (snapshot) => {
      if (stopped) return;

      const connected = snapshot.val() === true;

      databaseConnected = connected;

      if (!connected) {
        connectionGeneration++;
        activeConnectionRef = null;

        notifyConnection(false);
        return;
      }

      registerConnection();
    },
    (error) => {
      if (stopped) return;

      databaseConnected = false;
      connectionGeneration++;
      activeConnectionRef = null;

      notifyConnection(false);
      onError?.(error);
    }
  );

  // CLEANUP

  return async () => {
    stopped = true;
    databaseConnected = false;
    connectionGeneration++;

    unsubscribe();

    const connectionRef = activeConnectionRef;
    activeConnectionRef = null;

    if (connectionRef) {
      try {
        await remove(connectionRef);
        await onDisconnect(connectionRef).cancel();
      } catch (error) {
        console.error("Presence cleanup error:", error);
      }
    }
  };
};

// --------------------------------------------------
// SUBSCRIBE TO DEVICE PRESENCE
// --------------------------------------------------

export const subscribeToDevicePresence = (
  userId,
  deviceId,
  onData,
  onError
) => {
  if (!userId || !deviceId) {
    throw new Error("User ID and Device ID are required.");
  }

  const presenceRef = ref(
    rtdb,
    `presence/${userId}/${deviceId}`
  );

  return onValue(
    presenceRef,
    (snapshot) => {
      const connections = snapshot.val() || {};

      const connected = Object.values(connections).some(
        (connection) => connection?.state === "connected"
      );

      onData?.({
        connected,
        connections,
      });
    },
    (error) => {
      console.error("Presence subscription error:", error);
      onError?.(error);
    }
  );
};