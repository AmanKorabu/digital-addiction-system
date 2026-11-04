
import {
  ref,
  onValue,
  set,
  remove,
  push,
  onDisconnect,
  serverTimestamp,
} from "firebase/database";

import {
  doc,
  updateDoc,
  serverTimestamp as fsServerTimestamp,
} from "firebase/firestore";

import { rtdb, db } from "../config/firebase";

/* =========================================
   START DEVICE PRESENCE
========================================= */

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
  let activeConnectionRef = null;
  let lastReportedState = null;
  let generation = 0;

  const notify = (connected) => {
    if (lastReportedState === connected) return;

    lastReportedState = connected;
    onConnectionChange?.(connected);
  };

  /* =========================================
     REGISTER CONNECTION
  ========================================= */

  const registerConnection = async () => {
    if (stopped || !databaseConnected || activeConnectionRef) {
      return;
    }

    const currentGeneration = generation;
    const connectionRef = push(devicePresenceRef);

    try {
      // Register automatic cleanup BEFORE setting online.
      const disconnectOperation = onDisconnect(connectionRef);

      await disconnectOperation.remove();

      // Check whether connection is still valid.
      if (
        stopped ||
        !databaseConnected ||
        currentGeneration !== generation
      ) {
        return;
      }

      // Write connected status.
      await set(connectionRef, {
        state: "connected",
        userId,
        deviceId,
        connectedAt: serverTimestamp(),
      });

      // Check again after Firebase write.
      if (
        stopped ||
        !databaseConnected ||
        currentGeneration !== generation
      ) {
        await remove(connectionRef);
        return;
      }

      activeConnectionRef = connectionRef;

      notify(true);

      console.log("SMART SHIELD: Device presence connected.");

    } catch (error) {
      console.error(
        "SMART SHIELD: Presence registration failed:",
        error
      );

      onError?.(error);
    }
  };

  /* =========================================
     MONITOR FIREBASE CONNECTION
  ========================================= */

  const unsubscribe = onValue(
    connectionInfoRef,
    (snapshot) => {
      if (stopped) return;

      const connected = snapshot.val() === true;

      databaseConnected = connected;

      if (connected) {
        void registerConnection();
      } else {
        generation++;
        activeConnectionRef = null;

        notify(false);

        console.log("SMART SHIELD: RTDB disconnected.");
      }
    },
    (error) => {
      if (stopped) return;

      databaseConnected = false;
      generation++;
      activeConnectionRef = null;

      notify(false);

      console.error(
        "SMART SHIELD: Connection listener failed:",
        error
      );

      onError?.(error);
    }
  );

  /* =========================================
     STOP DEVICE PRESENCE
  ========================================= */

  return async () => {
    if (stopped) return;

    stopped = true;
    generation++;

    unsubscribe();

    const connectionRef = activeConnectionRef;
    activeConnectionRef = null;

    if (connectionRef) {
      try {
        await remove(connectionRef);

        console.log(
          "SMART SHIELD: Device presence cleaned up."
        );

      } catch (error) {
        console.error(
          "SMART SHIELD: Presence cleanup failed:",
          error
        );
      }
    }
  };
};

/* =========================================
   ADMIN: SUBSCRIBE TO DEVICE PRESENCE
========================================= */

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
        (connection) =>
          connection?.state === "connected"
      );

      onData?.({
        connected,
        connections,
      });
    },
    (error) => {
      console.error(
        "SMART SHIELD: Presence subscription error:",
        error
      );

      onError?.(error);
    }
  );
};

/* =========================================
   UPDATE FIRESTORE HEARTBEAT
========================================= */

export const updateFirestoreHeartbeat = async (deviceId) => {
  if (!deviceId) {
    return {
      success: false,
      error: "Device ID is required.",
    };
  }

  try {
    await updateDoc(doc(db, "devices", deviceId), {
      status: "connected",
      lastSyncAt: fsServerTimestamp(),
    });

    return {
      success: true,
    };

  } catch (error) {
    console.error(
      "SMART SHIELD: Firestore heartbeat failed:",
      error
    );

    return {
      success: false,
      error: error?.message || "Heartbeat update failed.",
    };
  }
};
