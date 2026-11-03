import { useState } from "react";
import { Form, Input, Button, message } from "antd";
import {
  MailOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { GoShieldLock } from "react-icons/go";
import { NavLink, useNavigate } from "react-router-dom";
import { ensureDeviceRegistered } from "../../services/deviceControlService";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../config/firebase";

// Where each app role goes after login.
const ROLE_ROUTES = {
  user: "/user/security-permissions",
  admin: "/admin/dashboard",
  master_admin: "/master-admin/dashboard",
};

const SESSION_KEYS = [
  "smartShieldLoggedIn",
  "smartShieldUserId",
  "smartShieldRole",
];

const clearSession = () => {
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
};

/**
 * Finds the signed-in person's profile.
 *   users/{uid}   -> the child (role "user")
 *   admins/{uid}  -> the parent (role "parent"), used by the admin panel
 */
const resolveAccount = async (uid) => {
  const userSnapshot = await getDoc(doc(db, "users", uid));

  if (userSnapshot.exists()) {
    return { source: "users", data: userSnapshot.data() };
  }

  const adminSnapshot = await getDoc(doc(db, "admins", uid));

  if (adminSnapshot.exists()) {
    return { source: "admins", data: adminSnapshot.data() };
  }

  return null;
};

/** Parents are stored as role "parent" but use the "admin" app role/route. */
const getAppRole = (account) => {
  const role = account.data.role;

  if (account.source === "admins" && role === "parent") {
    return "admin";
  }

  return role;
};

const Login = () => {
  const [loading, setLoading] = useState(false);

  const [form] = Form.useForm();

  const navigate = useNavigate();

  // Show an error AND end the Firebase session so nothing else in the app
  // (device sync, route guards) treats this person as signed in.
  const rejectLogin = async (text) => {
    clearSession();

    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Sign out after rejected login failed:", error);
    }

    message.error(text);
  };

  const handleLogin = async (values) => {
    try {
      setLoading(true);

      const { email, password } = values;

      // 1. Authenticate with Firebase Authentication
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      const uid = credential.user.uid;

      // 2. Load the profile (child in "users", parent in "admins")
      const account = await resolveAccount(uid);

      if (!account) {
        await rejectLogin(
          "Your account profile was not found. Please contact support."
        );
        return;
      }

      // 3. Account must be active
      if (account.data.status !== "active") {
        await rejectLogin(
          "Your account is currently inactive. Please contact the administrator."
        );
        return;
      }

      // 4. Work out where this role should go
      const role = getAppRole(account);
      const route = ROLE_ROUTES[role];

      if (!route) {
        await rejectLogin("Invalid account role.");
        return;
      }
      // 5. Register the current device for a regular user
      if (role === "user") {
        try {
          const registration = await ensureDeviceRegistered(uid);

          if (registration?.success && registration?.deviceId) {
            console.log(
              "Device registered successfully:",
              registration.deviceId
            );
          } else {
            console.error(
              "Device registration failed:",
              registration?.error || "Unknown error"
            );

            message.warning(
              "Login successful, but device registration failed."
            );
          }
        } catch (deviceError) {
          console.error("Device registration error:", deviceError);

          message.warning(
            "Login successful, but the device could not be registered."
          );
        }
      }

      // 5. Save the login session locally
      localStorage.setItem("smartShieldLoggedIn", "true");
      localStorage.setItem("smartShieldUserId", uid);
      localStorage.setItem("smartShieldRole", role);

      message.success("Login successful!");

      navigate(route, { replace: true });
    } catch (error) {
      console.error("Login Error:", error?.code || error);

      clearSession();

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        message.error("Invalid email or password.");
      } else if (error.code === "auth/invalid-email") {
        message.error("Please enter a valid email address.");
      } else if (error.code === "auth/user-disabled") {
        message.error(
          "This account has been disabled. Please contact the administrator."
        );
      } else if (error.code === "auth/too-many-requests") {
        message.error(
          "Too many login attempts. Please try again later."
        );
      } else if (error.code === "auth/network-request-failed") {
        message.error(
          "No internet connection. Please check your network and try again."
        );
      } else if (error.code === "permission-denied") {
        message.error(
          "Access to your profile was denied. Please contact the administrator."
        );
        signOut(auth).catch(() => { });
      } else {
        message.error("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="w-full text-center border-b-0 p-5 bg-blue-900 rounded-b-3xl shadow-sm sticky top-0 z-10">

        <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center shadow-sm">
          <GoShieldLock className="text-3xl text-white" />
        </div>

        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
          Welcome back
        </h1>

        <p className="mt-2 text-sm text-slate-400">
          Login to continue using Smart Shield.
        </p>

      </div>

      {/* Login Form */}
      <div className="w-full max-w-md mx-auto px-5 py-8">

        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm">

          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={handleLogin}
            autoComplete="off"
          >

            {/* Email */}
            <Form.Item
              label={
                <span className="text-sm font-medium text-slate-700">
                  Email Address
                </span>
              }
              name="email"
              rules={[
                {
                  required: true,
                  message: "Please enter your email",
                },
                {
                  type: "email",
                  message: "Please enter a valid email address",
                },
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder="Enter your email"
              />
            </Form.Item>

            {/* Password */}
            <Form.Item
              label={
                <span className="text-sm font-medium text-slate-700">
                  Password
                </span>
              }
              name="password"
              rules={[
                {
                  required: true,
                  message: "Please enter your password",
                },
              ]}
              hasFeedback
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Enter your password"
              />
            </Form.Item>

            {/* Login Button */}
            <Form.Item className="mb-2">
              <Button
                htmlType="submit"
                type="primary"
                size="large"
                loading={loading}
                className="!h-12 !rounded-xl !w-full !bg-blue-900 hover:!bg-blue-700"
              >
                Login
              </Button>
            </Form.Item>

          </Form>

          {/* Register Link */}
          <div className="text-center mt-5 pt-5 border-t border-slate-100">

            <span className="text-sm text-slate-500">
              Don't have an account?{" "}
            </span>

            <NavLink
              to="/register"
              className="text-sm font-medium text-blue-900 hover:text-blue-700"
            >
              Create Account
            </NavLink>

          </div>

        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Smart Shield · Digital Wellbeing
        </p>

      </div>

    </main>
  );
};

export default Login;