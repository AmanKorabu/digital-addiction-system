import { GoShieldLock } from "react-icons/go";
import { NavLink } from "react-router-dom";

const Home = () => {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-md">

        {/* Logo / Brand */}
        <div className="flex flex-col items-center text-center">

          <div className="w-16 h-16 rounded-2xl bg-blue-900 flex items-center justify-center shadow-sm mb-6">
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

        {/* Main Card */}
        <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">

          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Get started
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Sign in to continue or create a new account.
            </p>
          </div>

          {/* Login */}
          <NavLink to="/login" className="block">
            <button
              className="
                w-full
                h-12
                rounded-xl
                bg-blue-900
                hover:bg-blue-700
                active:bg-blue-800
                text-white
                font-medium
                transition
                duration-200
              "
            >
              Login
            </button>
          </NavLink>

          {/* Register */}
          <NavLink to="/register" className="block mt-3">
            <button
              className="
                w-full
                h-12
                rounded-xl
                border
                border-slate-300
                bg-white
                hover:bg-slate-50
                active:bg-slate-100
                text-slate-700
                font-medium
                transition
                duration-200
              "
            >
              Create an account
            </button>
          </NavLink>

        </div>

        {/* Features */}
        <div className="mt-6 grid grid-cols-3 gap-3">

          <div className="text-center">
            <p className="text-xs font-medium text-slate-700">
              Track
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Usage
            </p>
          </div>

          <div className="text-center">
            <p className="text-xs font-medium text-slate-700">
              Focus
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Better habits
            </p>
          </div>

          <div className="text-center">
            <p className="text-xs font-medium text-slate-700">
              Insights
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Understand usage
            </p>
          </div>

        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-400">
          Smart Shield · Digital Wellbeing
        </p>

      </div>
    </main>
  );
};

export default Home;