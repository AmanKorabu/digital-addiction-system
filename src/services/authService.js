import { signOut } from "firebase/auth";
import { auth } from "../config/firebase";

export const logoutUser = async () => {
  try {
    // Logout from Firebase Authentication
    await signOut(auth);

    // Clear Smart Shield local session
    localStorage.removeItem("smartShieldLoggedIn");
    localStorage.removeItem("smartShieldUserId");
    localStorage.removeItem("smartShieldRole");

    return true;
  } catch (error) {
    console.error("Logout Error:", error);
    return false;
  }
};