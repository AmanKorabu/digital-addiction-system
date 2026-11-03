
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../config/firebase";
import Home from "../screens/Home";
import SmartShieldLoader from "./common/SmartShieldLoader";

const AuthRedirect = () => {
  const [checking, setChecking] = useState(true);
  const [destination, setDestination] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      setChecking(true);
      setDestination(null);
      setError(false);

      if (!user) {
        localStorage.removeItem("smartShieldAdminLoggedIn");
        localStorage.removeItem("smartShieldAdminId");

        if (active) {
          setDestination("home");
          setChecking(false);
        }
        return;
      }

      try {
        // First check whether the signed-in account is an admin.
        const adminRef = doc(db, "admins", user.uid);
        const adminSnapshot = await getDoc(adminRef);

        if (!active) return;

        if (adminSnapshot.exists()) {
          const adminData = adminSnapshot.data();

          if (
            adminData.role === "parent" &&
            adminData.status === "active"
          ) {
            localStorage.setItem("smartShieldAdminLoggedIn", "true");
            localStorage.setItem("smartShieldAdminId", user.uid);

            setDestination("admin");
            setChecking(false);
            return;
          }
        }

        // Otherwise check whether this is a normal user.
        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);

        if (!active) return;

        if (userSnapshot.exists()) {
          const userData = userSnapshot.data();

          if (
            userData.role === "user" &&
            userData.status === "active"
          ) {
            localStorage.setItem("smartShieldLoggedIn", "true");
            localStorage.setItem("smartShieldUserId", user.uid);

            setDestination("user");
            setChecking(false);
            return;
          }
        }

        // Account exists but is not an active admin or user.
        setDestination("home");
        setChecking(false);
      } catch (err) {
        console.error("Auth redirect error:", err);

        if (active) {
          setError(true);
          setChecking(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (checking) {
    return <SmartShieldLoader />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p>Unable to verify your account. Please check your internet connection.</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (destination === "admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (destination === "user") {
    return <Navigate to="/user/dashboard" replace />;
  }

  return <Home />;
};

export default AuthRedirect;
