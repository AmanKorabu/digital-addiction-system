import { useState } from "react";
import { Form, Input, Button, message, Checkbox } from "antd";
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { GoShieldLock } from "react-icons/go";
import { NavLink } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../config/firebase";
const Register = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleRegister = async (values) => {
    try {
      setLoading(true);

      const { fullName, email, phone, password } = values;

      // 1. Create Firebase Authentication account
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      // 2. Create user document in Firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        fullName: fullName,
        email: email,
        phone: phone,
        role: "user",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      console.log("Firebase User:", user);
      console.log("Firestore User ID:", user.uid);

      message.success("Registration successful!");

      // Clear form
      form.resetFields();

    } catch (error) {
      console.error("Registration Error:", error);

      if (error.code === "auth/email-already-in-use") {
        message.error("This email is already registered.");
      } else if (error.code === "auth/invalid-email") {
        message.error("Please enter a valid email address.");
      } else if (error.code === "auth/weak-password") {
        message.error("Password is too weak.");
      } else {
        message.error("Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">

      {/* ================= HEADER ================= */}
      <div className="w-full text-center border-b-0 p-5 bg-blue-900 rounded-b-3xl shadow-sm sticky top-0 z-10">

        <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center shadow-sm">
          <GoShieldLock className="text-3xl text-white" />
        </div>

        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
          Create your account
        </h1>

        <p className="mt-2 text-sm text-slate-400">
          Join Smart Shield and take control of your digital wellbeing.
        </p>

      </div>

      {/* ================= FORM SECTION ================= */}
      <div className="w-full max-w-md mx-auto px-5 py-8">

        {/* Form Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm">

          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={handleRegister}
            autoComplete="off"
          >

            {/* Full Name */}
            <Form.Item
              label={
                <span className="text-sm font-medium text-slate-700">
                  Full Name
                </span>
              }
              name="fullName"
              rules={[
                {
                  required: true,
                  message: "Please enter your full name",
                },
                {
                  min: 2,
                  message: "Name must contain at least 2 characters",
                },
              ]}
            >
              <Input
                size="large"
                prefix={<UserOutlined />}
                placeholder="Enter your full name"
              />
            </Form.Item>

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

            {/* Phone */}
            <Form.Item
              label={
                <span className="text-sm font-medium text-slate-700">
                  Phone Number
                </span>
              }
              name="phone"
              rules={[
                {
                  required: true,
                  message: "Please enter your phone number",
                },
                {
                  pattern: /^[6-9]\d{9}$/,
                  message: "Enter a valid 10-digit mobile number",
                },
              ]}
            >
              <Input
                size="large"
                prefix={<PhoneOutlined />}
                placeholder="Enter your mobile number"
                maxLength={10}
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
                  message: "Please enter a password",
                },
                {
                  min: 8,
                  message: "Password must contain at least 8 characters",
                },
              ]}
              hasFeedback
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Create a password"
              />
            </Form.Item>

            {/* Confirm Password */}
            <Form.Item
              label={
                <span className="text-sm font-medium text-slate-700">
                  Confirm Password
                </span>
              }
              name="confirmPassword"
              dependencies={["password"]}
              hasFeedback
              rules={[
                {
                  required: true,
                  message: "Please confirm your password",
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }

                    return Promise.reject(
                      new Error("Passwords do not match")
                    );
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Confirm your password"
              />
            </Form.Item>

            {/* Terms */}
            <Form.Item
              name="terms"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(
                        new Error(
                          "Please accept the terms and privacy policy"
                        )
                      ),
                },
              ]}
            >
              <Checkbox>
                <span className="text-xs leading-5 text-slate-500">
                  I agree to the Smart Shield Terms of Service and Privacy
                  Policy.
                </span>
              </Checkbox>
            </Form.Item>

            {/* Register Button */}
            <Form.Item className="mb-2">
              <Button
                htmlType="submit"
                type="primary"
                size="large"
                loading={loading}
                className="!h-12 !rounded-xl !w-full !bg-blue-900 hover:!bg-blue-700"
              >
                Create Account
              </Button>
            </Form.Item>

          </Form>

          {/* Login */}
          <div className="text-center mt-5 pt-5 border-t border-slate-100">

            <span className="text-sm text-slate-500">
              Already have an account?{" "}
            </span>

            <NavLink
              to="/login"
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Login
            </NavLink>

          </div>

        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Smart Shield · Digital Wellbeing
        </p>

      </div>

    </main>
  );
};

export default Register;