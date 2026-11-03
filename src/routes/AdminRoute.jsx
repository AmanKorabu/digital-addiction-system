
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import {
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../config/firebase";
import SmartShieldLoader from "../components/common/SmartShieldLoader";

const AdminRoute = () => {
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      setChecking(true);
      setAuthorized(false);
      setError("");

      if (!user) {
        localStorage.removeItem("smartShieldAdminLoggedIn");
        localStorage.removeItem("smartShieldAdminId");

        if (active) setChecking(false);
        return;
      }

      try {
        const adminRef = doc(db, "admins", user.uid);
        const adminSnapshot = await getDoc(adminRef);

        if (!active) return;

        if (!adminSnapshot.exists()) {
          localStorage.removeItem("smartShieldAdminLoggedIn");
          localStorage.removeItem("smartShieldAdminId");

          await signOut(auth);
          return;
        }

        const adminData = adminSnapshot.data();

        const isAuthorized =
          adminData.role === "parent" &&
          adminData.status === "active";

        if (!isAuthorized) {
          localStorage.removeItem("smartShieldAdminLoggedIn");
          localStorage.removeItem("smartShieldAdminId");

          await signOut(auth);
          return;
        }

        localStorage.setItem("smartShieldAdminLoggedIn", "true");
        localStorage.setItem("smartShieldAdminId", user.uid);

        if (active) {
          setAuthorized(true);
        }
      } catch (err) {
        console.error("Admin authorization failed:", err);

        if (active) {
          setError(
            "Unable to verify your admin account. Please check your internet connection and try again."
          );
        }
      } finally {
        if (active) {
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

  if (!auth.currentUser) {
    return <Navigate to="/admin/login" replace />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!authorized) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
};

export default AdminRoute;
