
import {
  HomeOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  UserOutlined,
  LockOutlined,
} from "@ant-design/icons";

import { useNavigate } from "react-router-dom";

const BottomNavigation = ({ activeTab }) => {
  const navigate = useNavigate();

  const navigationItems = [
    {
      key: "home",
      label: "Home",
      path: "/user/dashboard",
      icon: <HomeOutlined />,
    },
    {
      key: "usage",
      label: "Usage",
      path: "/user/usage",
      icon: <BarChartOutlined />,
    },
    {
      key: "focus",
      label: "Focus",
      path: "/user/focus",
      icon: <ClockCircleOutlined />,
    },
    {
      key: "time-capsule",
      label: "Capsule",
      path: "/user/time-capsule",
      icon: <LockOutlined />,
    },
    {
      key: "profile",
      label: "Profile",
      path: "/user/profile",
      icon: <UserOutlined />,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white">
      <div className="mx-auto flex h-[72px] max-w-2xl items-center justify-around px-1">
        {navigationItems.map((item) => {
          const isActive = activeTab === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition ${
                isActive
                  ? "text-blue-600"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-medium">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNavigation;
