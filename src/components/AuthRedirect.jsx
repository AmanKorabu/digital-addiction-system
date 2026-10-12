import { Navigate } from "react-router-dom";
import Home from "../screens/Home";

const AuthRedirect = () => {
  const loggedIn = localStorage.getItem("smartShieldLoggedIn");
  const userId = localStorage.getItem("smartShieldUserId");

  // User is already logged in
  if (loggedIn === "true" && userId) {
    return <Navigate to="/user/dashboard" replace />;
  }

  // User is not logged in
  return <Home />;
};

export default AuthRedirect;