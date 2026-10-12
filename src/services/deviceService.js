import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../config/firebase";

/**
 * Register or update a device for a user
 */
export const registerDevice = async (deviceData) => {
  try {
    const {
      deviceId,
      userId,
      deviceName = "Android Device",
      platform = "Android",
      model = "Unknown",
      manufacturer = "Unknown",
      androidVersion = "Unknown",
    } = deviceData;

    if (!deviceId) {
      throw new Error("Device ID is required.");
    }

    if (!userId) {
      throw new Error("User ID is required.");
    }

    const deviceRef = doc(db, "devices", deviceId);

    await setDoc(
      deviceRef,
      {
        deviceId,
        userId,
        deviceName,
        platform,
        model,
        manufacturer,
        androidVersion,
        status: "connected",
        lastActive: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    // Keep the user's deviceId linked to the device
    const userRef = doc(db, "users", userId);

    await updateDoc(userRef, {
      deviceId,
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
      deviceId,
    };
  } catch (error) {
    console.error("Register Device Error:", error);

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Get a device by its device ID
 */
export const getDeviceById = async (deviceId) => {
  try {
    if (!deviceId) {
      throw new Error("Device ID is required.");
    }

    const deviceRef = doc(db, "devices", deviceId);
    const deviceSnapshot = await getDoc(deviceRef);

    if (!deviceSnapshot.exists()) {
      return null;
    }

    return {
      id: deviceSnapshot.id,
      ...deviceSnapshot.data(),
    };
  } catch (error) {
    console.error("Get Device Error:", error);

    throw error;
  }
};

/**
 * Get the device connected to a specific user
 */
export const getUserDevice = async (userId) => {
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }

    const devicesRef = collection(db, "devices");

    const deviceQuery = query(
      devicesRef,
      where("userId", "==", userId)
    );

    const querySnapshot = await getDocs(deviceQuery);

    if (querySnapshot.empty) {
      return null;
    }

    const deviceDocument = querySnapshot.docs[0];

    return {
      id: deviceDocument.id,
      ...deviceDocument.data(),
    };
  } catch (error) {
    console.error("Get User Device Error:", error);

    throw error;
  }
};

/**
 * Update device information
 */
export const updateDevice = async (deviceId, deviceData) => {
  try {
    if (!deviceId) {
      throw new Error("Device ID is required.");
    }

    const deviceRef = doc(db, "devices", deviceId);

    await updateDoc(deviceRef, {
      ...deviceData,
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
    };
  } catch (error) {
    console.error("Update Device Error:", error);

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Update device connection status
 */
export const updateDeviceStatus = async (deviceId, status) => {
  try {
    if (!deviceId) {
      throw new Error("Device ID is required.");
    }

    const deviceRef = doc(db, "devices", deviceId);

    await updateDoc(deviceRef, {
      status,
      lastActive: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
    };
  } catch (error) {
    console.error("Update Device Status Error:", error);

    return {
      success: false,
      error: error.message,
    };
  }
};