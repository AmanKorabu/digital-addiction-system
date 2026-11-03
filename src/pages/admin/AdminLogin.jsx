import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    signInWithEmailAndPassword,
    signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { GoShieldLock } from "react-icons/go";

import { auth, db } from "../../config/firebase";

const AdminLogin = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        setError("");
        setLoading(true);

        let signedInUser = null;

        try {
            const credential = await signInWithEmailAndPassword(
                auth,
                email.trim().toLowerCase(),
                password
            );

            signedInUser = credential.user;

            const profileRef = doc(
                db,
                "admins",
                signedInUser.uid
            );

            const profileSnapshot = await getDoc(profileRef);

            if (!profileSnapshot.exists()) {
                await signOut(auth);
                signedInUser = null;

                localStorage.removeItem("smartShieldAdminLoggedIn");
                localStorage.removeItem("smartShieldAdminId");

                setError("Parent profile not found.");
                return;
            }

            const profile = profileSnapshot.data();

            if (
                profile.role !== "parent" ||
                profile.status !== "active"
            ) {
                await signOut(auth);
                signedInUser = null;

                localStorage.removeItem("smartShieldAdminLoggedIn");
                localStorage.removeItem("smartShieldAdminId");

                setError(
                    "This parent account is not active or authorized."
                );
                return;
            }

            // Save admin session information.
            localStorage.setItem(
                "smartShieldAdminLoggedIn",
                "true"
            );

            localStorage.setItem(
                "smartShieldAdminId",
                signedInUser.uid
            );

            console.log("ADMIN SESSION SAVED:", signedInUser.uid);

            navigate("/admin/dashboard", {
                replace: true,
            });

        } catch (err) {
            console.error("Admin login failed:", err);

            localStorage.removeItem("smartShieldAdminLoggedIn");
            localStorage.removeItem("smartShieldAdminId");

            if (signedInUser) {
                try {
                    await signOut(auth);
                } catch (signOutError) {
                    console.error(
                        "Unable to clear unauthorized session:",
                        signOutError
                    );
                }
            }

            if (
                err.code === "auth/invalid-credential" ||
                err.code === "auth/user-not-found" ||
                err.code === "auth/wrong-password"
            ) {
                setError("Incorrect email or password.");
            } else if (err.code === "auth/too-many-requests") {
                setError(
                    "Too many attempts. Please try again later."
                );
            } else if (
                err.code === "permission-denied" ||
                err.code === "firestore/permission-denied"
            ) {
                setError(
                    "Unable to read your parent profile. Check Firestore Rules."
                );
            } else {
                setError(
                    "Login failed. Please check your connection and try again."
                );
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center px-5 py-8">
            <div className="w-full max-w-md">

                <div className="text-center">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-700 shadow-sm">
                        <GoShieldLock className="text-3xl text-white" />
                    </div>

                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                        Smart Shield
                    </h1>

                    <p className="mt-2 text-sm text-slate-500">
                        Secure Administrator Portal
                    </p>
                </div>

                <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">

                    <h2 className="text-xl font-semibold text-slate-900">
                        Admin Login
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                        Sign in to manage your assigned users and devices.
                    </p>

                    <form onSubmit={handleSubmit} className="mt-6 space-y-5">

                        <div>
                            <label
                                htmlFor="admin-email"
                                className="mb-2 block text-sm font-medium text-slate-700"
                            >
                                Email address
                            </label>

                            <input
                                id="admin-email"
                                type="email"
                                autoComplete="username"
                                placeholder="Enter your admin email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="admin-password"
                                className="mb-2 block text-sm font-medium text-slate-700"
                            >
                                Password
                            </label>

                            <div className="relative">
                                <input
                                    id="admin-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="current-password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="h-12 w-full rounded-xl border border-slate-300 px-4 pr-20 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                                />

                                <button
                                    type="button"
                                    onClick={() => setShowPassword((previous) => !previous)}
                                    className="absolute inset-y-0 right-3 text-xs font-semibold text-slate-500 hover:text-emerald-700"
                                >
                                    {showPassword ? "Hide" : "Show"}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <p
                                role="alert"
                                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                            >
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="h-12 w-full rounded-xl bg-emerald-700 font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? "Verifying..." : "Login as Admin"}
                        </button>

                    </form>

                    <div className="mt-6 border-t border-slate-100 pt-5 text-center">

                        <p className="mt-5 text-center text-sm text-slate-400">
                            New parent to Smart Shield?{" "}
                            <Link
                                to="/admin/register"
                                className="font-semibold text-teal-400 hover:text-teal-300"
                            >
                                Register here
                            </Link>
                        </p>

                        <Link
                            to="/"
                            className="mt-3 inline-block text-sm text-slate-500 hover:text-slate-800"
                        >
                            ← Back to Home
                        </Link>

                    </div>
                </section>

                <p className="mt-6 text-center text-xs text-slate-400">
                    Smart Shield · Authorized Access Only
                </p>

            </div>
        </main>
    );
};

export default AdminLogin;