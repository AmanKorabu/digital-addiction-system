import { Route, Routes } from "react-router-dom"
import Register from "./pages/Register"
import AuthRedirect from "./components/AuthRedirect"
import Login from "./pages/auth/Login"
import UserDasahboard from "./pages/user/UserDasahboard"
// import UserUsageDashboard from "./pages/user/UserUsageDashboard"
import UserFocusDashboard from "./pages/user/UserFocusDashboard"
import UserProfileDashboard from "./pages/user/UserProfileDashboard"
import ProtectedRoute from "./routes/ProtectedRoute"
import UserSecurityDashboard from "./pages/user/UserSecurityDashboard"
import UsageTest from "./components/user/UsageTest"

const App = () => {
  return (
    <>
      <Routes>
        <Route path="/" element={<AuthRedirect />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />


        <Route element={<ProtectedRoute />}>
          <Route path="/user/dashboard" element={<UserDasahboard />} />
          {/* <Route path="/user/usage" element={<UserUsageDashboard />} /> */}
          <Route path="/user/usage" element={<UsageTest />} />
          <Route path="/user/focus" element={<UserFocusDashboard />} />
          <Route path="/user/profile" element={<UserProfileDashboard />} />
          <Route
            path="/user/security"
            element={<UserSecurityDashboard />}
          />
         
        </Route>
      </Routes>
    </>
  )
}

export default App