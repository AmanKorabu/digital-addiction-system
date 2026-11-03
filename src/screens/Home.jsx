import { GoShieldLock } from "react-icons/go";
import { NavLink } from "react-router-dom";
import { FaUser, FaUserShield } from "react-icons/fa";

const Home = () => {
  const roles = [
    {
      title: "Continue as User",
      description: "Track screen time and manage your digital habits.",
      icon: <FaUser />,
      loginPath: "/login",
      registerPath: "/register",
      color: "blue",
    },
    {
      title: "Admin Login",
      description:
        "Manage assigned devices, invite users, and monitor usage reports.",
      icon: <FaUserShield />,
      loginPath: "/admin/login",
      color: "emerald",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-900 flex items-center justify-center shadow-sm mb-5">
            <GoShieldLock className="text-3xl text-white" />
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Smart Shield
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-500 max-w-xs">
            Take control of your digital habits with simple,
            mindful screen-time management.
          </p>
        </div>

        {/* Role Selection */}
        <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm">
          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Welcome to Smart Shield
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Choose how you want to continue.
            </p>
          </div>

          <div className="space-y-3">
            {roles.map((role) => (
              <div
                key={role.title}
                className="rounded-xl border border-slate-200 p-4 transition hover:border-blue-300 hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${
                      role.color === "blue"
                        ? "bg-blue-50 text-blue-900"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {role.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">
                      {role.title}
                    </h3>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {role.description}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <NavLink
                    to={role.loginPath}
                    className={`flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium text-white transition ${
                      role.color === "blue"
                        ? "bg-blue-900 hover:bg-blue-700"
                        : "bg-emerald-700 hover:bg-emerald-600"
                    }`}
                  >
                    {role.title}
                  </NavLink>

                  {role.registerPath && (
                    <NavLink
                      to={role.registerPath}
                      className="mt-2 flex h-10 w-full items-center justify-center rounded-lg border border-slate-300 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Create User Account
                    </NavLink>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs font-semibold text-slate-700">Track</p>
            <p className="mt-1 text-[11px] text-slate-400">Usage</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700">Focus</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Better habits
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700">Insights</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Usage reports
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-400">
          Smart Shield · Digital Wellbeing . Shreya Wasade
        </p>
      </div>
    </main>
  );
};

export default Home;
