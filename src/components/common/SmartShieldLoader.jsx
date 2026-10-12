import { GoShieldLock } from "react-icons/go";

const SmartShieldLoader = () => {
  return (
    <div className="fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-50">
      
      <div className="flex flex-col items-center">

        {/* Animated Logo */}
        <div className="relative flex h-24 w-24 items-center justify-center">

          {/* Outer rotating ring */}
          <div className="absolute inset-0 rounded-[28px] border-4 border-slate-200 border-t-blue-600 animate-spin" />

          {/* Logo container */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/20 animate-pulse">
            <GoShieldLock className="text-4xl text-white" />
          </div>

        </div>

        {/* App Name */}
        <h1 className="mt-7 text-2xl font-bold tracking-tight text-slate-900">
          Smart Shield
        </h1>

        {/* Loading message */}
        <p className="mt-2 text-sm text-slate-500">
          Securing your digital wellbeing
        </p>

        {/* Loading dots */}
        <div className="mt-5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce" />
        </div>

      </div>
    </div>
  );
};

export default SmartShieldLoader;