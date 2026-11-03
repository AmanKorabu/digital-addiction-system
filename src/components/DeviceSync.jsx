
import { useEffect } from "react";
import { Network } from "@capacitor/network";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../config/firebase";

import {
  LINK_ERRORS,
  ensureDeviceRegistered,
  subscribeToDeviceCommands,
  syncDeviceStatus,
} from "../services/deviceControlService";

import { startDevicePresence } from "../services/devicePresenceService";

const DeviceSync = () => {
  useEffect(() => {
    let stopped = false;
    let session = 0;

    let networkListener = null;
    let presenceCleanup = null;
    let commandCleanup = null;
    let authCleanup = null;
    let retryTimeout = null;

    let activeDeviceId = null;
    let activeUserId = null;
    let syncInProgress = false;

    const clearMonitoring = async () => {
      if (networkListener) {
        await networkListener.remove();
        networkListener = null;
      }

      if (presenceCleanup) {
        await presenceCleanup();
        presenceCleanup = null;
      }

      if (commandCleanup) {
        commandCleanup();
        commandCleanup = null;
      }

      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }

      activeDeviceId = null;
      activeUserId = null;
      syncInProgress = false;
    };

    const fullSync = async (deviceId) => {
      if (stopped || syncInProgress) return;

      syncInProgress = true;

      try {
        await syncDeviceStatus(deviceId, {
          includeUsage: false,
        });

        console.log("SMART SHIELD SYNC COMPLETED");
      } catch (error) {
        console.error("SMART SHIELD SYNC ERROR:", error);
      } finally {
        syncInProgress = false;
      }
    };

    const startMonitoring = async (user) => {
      const currentSession = ++session;

      await clearMonitoring();

      if (stopped || currentSession !== session) return;

      activeUserId = user.uid;

      const setupDevice = async () => {
        try {
          const registration = await ensureDeviceRegistered(user.uid);

          if (stopped || currentSession !== session) return;

          if (!registration.success) {
            console.error("DEVICE REGISTRATION:", registration.error);

            if (registration.code === LINK_ERRORS.NOT_LINKED) {
              retryTimeout = setTimeout(() => {
                if (!stopped && currentSession === session) {
                  setupDevice();
                }
              }, 10000);
            }

            return;
          }

          activeDeviceId = registration.deviceId;

          console.log("SMART SHIELD DEVICE:", activeDeviceId);

          presenceCleanup = startDevicePresence(
            user.uid,
            activeDeviceId,
            async (connected) => {
              console.log("FIREBASE PRESENCE:", connected);

              if (
                connected &&
                !stopped &&
                currentSession === session
              ) {
                await fullSync(activeDeviceId);
              }
            },
            (error) => {
              console.error("PRESENCE ERROR:", error);
            }
          );

          commandCleanup = subscribeToDeviceCommands(activeDeviceId);

          await fullSync(activeDeviceId);
        } catch (error) {
          console.error("DEVICE SETUP ERROR:", error);
        }
      };

      try {
        networkListener = await Network.addListener(
          "networkStatusChange",
          async (status) => {
            if (stopped || currentSession !== session) return;

            console.log("NETWORK STATUS:", status.connected);

            if (status.connected && activeDeviceId) {
              await fullSync(activeDeviceId);
            }
          }
        );
      } catch (error) {
        console.error("NETWORK LISTENER ERROR:", error);
      }

      await setupDevice();
    };

    const handleVisibilityChange = async () => {
      if (
        document.visibilityState !== "visible" ||
        stopped ||
        !activeDeviceId ||
        !activeUserId
      ) {
        return;
      }

      try {
        const status = await Network.getStatus();

        if (status.connected) {
          await fullSync(activeDeviceId);
        }
      } catch (error) {
        console.error("FOREGROUND SYNC ERROR:", error);
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    authCleanup = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        session++;
        await clearMonitoring();
        return;
      }

      try {
        const profileSnapshot = await getDoc(
          doc(db, "users", user.uid)
        );

        if (stopped) return;

        if (!profileSnapshot.exists()) {
          await clearMonitoring();
          return;
        }

        const profile = profileSnapshot.data();

        if (
          profile.role !== "user" ||
          profile.status !== "active"
        ) {
          await clearMonitoring();
          return;
        }

        await startMonitoring(user);
      } catch (error) {
        console.error("USER PROFILE CHECK ERROR:", error);
      }
    });

    return () => {
      stopped = true;
      session++;

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      authCleanup?.();
      clearMonitoring();
    };
  }, []);

  return null;
};

export default DeviceSync;
