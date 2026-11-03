import { Route, Routes } from "react-router-dom";

import Register from "./pages/Register";
import AuthRedirect from "./components/AuthRedirect";
import Login from "./pages/auth/Login";

import UserDasahboard from "./pages/user/UserDasahboard";
import UserFocusDashboard from "./pages/user/UserFocusDashboard";
import UserProfileDashboard from "./pages/user/UserProfileDashboard";
import UserSecurityDashboard from "./pages/user/UserSecurityDashboard";
import UserUsageDashboard from "./pages/user/UserUsageDashboard";

import ProtectedRoute from "./routes/ProtectedRoute";
import AdminRoute from "./routes/AdminRoute";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminRegister from "./pages/admin/AdminRegister";
import DeviceSync from "./components/DeviceSync";
import UserSecurityPermissions from "./pages/user/UserSecurityPermissions";

const App = () => {
  return (
    <>
      {/* Renders nothing. Links this phone, sends heartbeats and runs
          admin commands while an active child account is signed in. */}
      <DeviceSync />

      <Routes>
        <Route path="/" element={<AuthRedirect />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />

        {/* Existing user routes — preserved */}
        <Route element={<ProtectedRoute />}>
          <Route
            path="/user/security-permissions"
            element={<UserSecurityPermissions />}
          />
          <Route path="/user/dashboard" element={<UserDasahboard />} />
          <Route path="/user/usage" element={<UserUsageDashboard />} />
          <Route path="/user/focus" element={<UserFocusDashboard />} />
          <Route path="/user/profile" element={<UserProfileDashboard />} />
          <Route
            path="/user/security"
            element={<UserSecurityDashboard />}
          />
        </Route>

        {/* New admin routes */}
        <Route path="/admin/register" element={<AdminRegister />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<AdminRoute />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
        </Route>
      </Routes>
    </>
  );
};

export default App;