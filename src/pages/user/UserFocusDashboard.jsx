import { useState } from "react";
import BottomNavigation from "../../components/user/BottomNavigation";

const UserFocusDashboard = () => {
    const [activeTab, setActiveTab] = useState("focus");
  return (
    <div>UserFocusDashboard
        <BottomNavigation activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  )
}

export default UserFocusDashboard