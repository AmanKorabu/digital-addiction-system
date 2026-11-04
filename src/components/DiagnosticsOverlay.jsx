import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { get, onValue, ref, remove, set } from "firebase/database";

import app, { auth, rtdb } from "../config/firebase";
import { errorText, subscribeDiag } from "../services/diagnosticsStore";
import { getBackgroundSyncStatus } from "../services/backgroundSyncService";

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `No answer from Firebase in ${ms / 1000}s (not connected, blocked, or wrong database URL)`
            )
          ),
        ms
      )
    ),
  ]);

const time = (ms) => (ms ? new Date(ms).toLocaleTimeString() : "-");

const DiagnosticsOverlay = () => {
  const { pathname } = useLocation();

  const [diag, setDiagState] = useState(null);
  const [open, setOpen] = useState(false);
  const [rtdbConnected, setRtdbConnected] = useState("unknown");
  const [testResult, setTestResult] = useState("not run");
  const [background, setBackground] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeDiag(setDiagState), []);

  // Own RTDB connection listener, independent from the presence service.
  useEffect(() => {
    if (!open) return undefined;

    return onValue(
      ref(rtdb, ".info/connected"),
      (snapshot) =>
        setRtdbConnected(
          snapshot.val() === true ? "CONNECTED" : "NOT CONNECTED"
        ),
      (error) => setRtdbConnected(`ERROR ${errorText(error)}`)
    );
  }, [open]);

  // Native background service status, refreshed while the panel is open.
  useEffect(() => {
    if (!open) return undefined;

    let active = true;

    const load = async () => {
      const result = await getBackgroundSyncStatus();

      if (active) {
        setBackground(
          result.success ? result : { error: result.error || "unavailable" }
        );
      }
    };

    load();
    const timer = setInterval(load, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open]);

  if (pathname.startsWith("/admin") || !diag?.uid) return null;

  const runTest = async () => {
    const uid = auth.currentUser?.uid;

    if (!uid) {
      setTestResult("FAILED: not signed in");
      return;
    }

    setTestResult("running...");

    const testRef = ref(rtdb, `presence/${uid}/_diag`);

    try {
      await withTimeout(set(testRef, { time: Date.now() }), 8000);
      const snapshot = await withTimeout(get(testRef), 8000);
      await withTimeout(remove(testRef), 8000);

      setTestResult(
        `OK: wrote, read back (${snapshot.exists() ? "found" : "missing"}) and removed`
      );
    } catch (error) {
      setTestResult(`FAILED: ${errorText(error)}`);
    }
  };

  const rows = [
    ["Auth UID", diag.uid],
    ["Profile role / status", `${diag.role || "-"} / ${diag.status || "-"}`],
    ["Network", diag.network],
    ["Monitoring", diag.monitoring],
    ["Registration", diag.registration],
    ["Registration error", diag.registrationError || "-"],
    ["Device ID", diag.deviceId || "-"],
    ["Database URL", app.options.databaseURL || "MISSING"],
    ["RTDB connection (live)", rtdbConnected],
    ["Presence service", diag.presence],
    ["Presence write", diag.presenceWrite],
    ["Presence error", diag.presenceError || "-"],
    ["Heartbeat (app)", diag.heartbeat],
    ["Last heartbeat (app)", time(diag.heartbeatAt)],
    ["Heartbeat error (app)", diag.heartbeatError || "-"],
    ["Background start", diag.background || "not tried"],
    [
      "Background service",
      background
        ? background.error
          ? `ERROR ${background.error}`
          : `enabled=${background.enabled}, running=${background.running}`
        : "loading...",
    ],
    ["Battery unrestricted", background ? String(background.unrestricted) : "-"],
    ["Last background sync OK", time(background?.lastSuccessAt)],
    ["Last background attempt", time(background?.lastAttemptAt)],
    ["Last usage upload (background)", time(background?.lastUsageAt)],
    ["Last admin command (background)", background?.lastCommand || "-"],
    ["Background error", background?.lastError || "-"],
    ["RTDB write test", testResult],
  ];

  const reportText = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Recent events:",
    ...diag.logs,
  ].join("\n");

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-3 z-[9998] rounded-full bg-slate-800 px-3 py-2 text-xs font-semibold text-white opacity-80"
      >
        Diag
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                Smart Shield Diagnostics
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="space-y-2">
              {rows.map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold text-slate-500">
                    {label}
                  </p>
                  <p className="break-all text-xs text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={runTest}
                className="flex-1 rounded-lg bg-blue-900 px-3 py-2 text-sm font-medium text-white"
              >
                Test RTDB write
              </button>
              <button
                onClick={copyReport}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
              >
                {copied ? "Copied" : "Copy report"}
              </button>
            </div>

            <p className="mt-4 text-[11px] font-semibold text-slate-500">
              Recent events
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 text-[11px] text-slate-800">
              {diag.logs.join("\n") || "No events yet."}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

export default DiagnosticsOverlay;