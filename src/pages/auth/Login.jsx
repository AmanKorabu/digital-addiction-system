import { useState } from "react";
import { Form, Input, Button, message } from "antd";
import {
  MailOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { GoShieldLock } from "react-icons/go";
import { NavLink, useNavigate } from "react-router-dom";

import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../config/firebase";

const Login = () => {
  const [loading, setLoading] = useState(false);

  const [form] = Form.useForm();

  const navigate = useNavigate();

  const handleLogin = async (values) => {
    try {
      setLoading(true);

      const { email, password } = values;

      // 1. Authenticate user with Firebase Authentication
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      // 2. Get authenticated Firebase user
      const user = userCredential.user;

      // 3. Get Firebase UID
      const uid = user.uid;

      console.log("Firebase User:", user);
      console.log("Firebase UID:", uid);

      // 4. Read user's Firestore profile
      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);

      // 5. Check whether Firestore profile exists
      if (!userDoc.exists()) {
        message.error(
          "Your account profile was not found. Please contact support."
        );

        return;
      }

      // 6. Get profile data
      const userData = userDoc.data();

      console.log("Firestore User Data:", userData);

      // 7. Check account status
      if (userData.status !== "active") {
        message.error(
          "Your account is currently inactive. Please contact the administrator."
        );

        return;
      }

      // 8. Get user role
      const role = userData.role;

      console.log("User Role:", role);
      
      // 9. Save login session locally
      localStorage.setItem("smartShieldLoggedIn", "true");
      localStorage.setItem("smartShieldUserId", uid);
      localStorage.setItem("smartShieldRole", role);

      // 10. Login success
      message.success("Login successful!");

      // 11. Redirect according to role
      if (role === "user") {
        navigate("/user/dashboard", { replace: true });
      } else if (role === "admin") {
        navigate("/admin/dashboard", { replace: true });
      } else if (role === "master_admin") {
        navigate("/master-admin/dashboard", { replace: true });
      } else {
        // Invalid role → remove saved session
        localStorage.removeItem("smartShieldLoggedIn");
        localStorage.removeItem("smartShieldUserId");
        localStorage.removeItem("smartShieldRole");

        message.error("Invalid account role.");
      }
    } catch (error) {
      console.error("Login Error:", error);

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
