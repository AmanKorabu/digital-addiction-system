import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { auth, db } from "../../config/firebase";
import { onAuthStateChanged } from "firebase/auth";

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import {
  Button,
  Input,
  InputNumber,
  Spin,
  Switch,
  message,
} from "antd";

import {
  LockOutlined,
  UnlockOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CalendarOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  BarChartOutlined,
  TrophyOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";

import {
  hasAccessibilityPermission,
  openAccessibilitySettings,
  getLaunchableApps,
  getFocusStatus,
  startFocusSession,
} from "../../services/focusModeService";

import BottomNavigation from "../../components/user/BottomNavigation";

const { TextArea } = Input;

// How often the page re-checks "is this capsule unlocked yet?".
const CLOCK_TICK_MS = 30 * 1000;

// =====================================
// SOCIAL MEDIA APPS
// =====================================

const SOCIAL_APPS = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp Business",
  "com.instagram.android": "Instagram",
  "com.instagram.barcelona": "Threads",
  "com.facebook.katana": "Facebook",
  "com.facebook.lite": "Facebook Lite",
  "com.facebook.orca": "Messenger",
  "com.facebook.mlite": "Messenger Lite",
  "com.facebook.ml": "Facebook",
  "com.twitter.android": "X (Twitter)",
  "com.snapchat.android": "Snapchat",
  "com.zhiliaoapp.musically": "TikTok",
  "com.ss.android.ugc.trill": "TikTok",
  "com.linkedin.android": "LinkedIn",
  "com.pinterest": "Pinterest",
  "com.reddit.frontpage": "Reddit",
  "com.reddit.app": "Reddit",
  "org.telegram.messenger": "Telegram",
  "com.telegram.messenger": "Telegram",
  "org.thoughtcrime.securesms": "Signal",
  "com.discord": "Discord",
  "com.tumblr": "Tumblr",
  "com.google.android.youtube": "YouTube",
};

// =====================================
// HELPERS
// =====================================

const formatDate = (date) => {
  if (!date) return "Not available";

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toLocalDateTimeInput = (date) => {
  const offset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offset)
    .toISOString()
    .slice(0, 16);
};

const getRemainingTime = (unlockAt, now) => {
  if (!unlockAt?.toDate) return "Date unavailable";

  const difference =
    unlockAt.toDate().getTime() - now.getTime();

  if (difference <= 0) return "Ready to unlock";

  const days = Math.floor(difference / 86400000);
  const hours = Math.floor(
    (difference % 86400000) / 3600000
  );
  const minutes = Math.floor(
    (difference % 3600000) / 60000
  );

  if (days > 0) return `${days} days ${hours} hours`;
  if (hours > 0) return `${hours} hours ${minutes} minutes`;

  return `${minutes} minutes`;
};

const getAppInitial = (name) => {
  return (name || "A").trim().charAt(0).toUpperCase();
};

const startOfDay = (ms) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const addDays = (ms, days) => {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

const formatBlockedTime = (ms) => {
  const totalMinutes = Math.round(ms / 60000);

  if (totalMinutes <= 0) return ms > 0 ? "<1m" : "0m";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;

  return `${minutes}m`;
};

const getDayLabel = (dayStart, todayStart) => {
  if (dayStart === todayStart) return "Today";
  if (dayStart === addDays(todayStart, -1)) return "Yesterday";

  return new Date(dayStart).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
  });
};

/**
 * Time each app has been blocked per day, built from the Focus Mode
 * sessions started by the user's capsules.
 *
 * Returns { [dayStartMs]: { [packageName]: blockedMs } }.
 * Only time that has already passed is counted.
 */
const buildBlockedStats = (capsules, nowMs) => {
  const days = {};

  capsules.forEach((capsule) => {
    const focus = capsule.focusMode;

    if (!focus?.enabled) return;

    const created = capsule.createdAt?.toDate?.();

    if (!created) return; // still being saved

    const start = created.getTime();
    const plannedEnd =
      start + Number(focus.durationMinutes || 0) * 60000;
    const end = Math.min(plannedEnd, nowMs);

    if (end <= start) return;

    const packages = focus.selectedApps || [];

    if (packages.length === 0) return;

    let cursor = start;

    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const dayEnd = addDays(dayStart, 1);
      const sliceEnd = Math.min(end, dayEnd);
      const slice = sliceEnd - cursor;

      if (!days[dayStart]) days[dayStart] = {};

      packages.forEach((packageName) => {
        days[dayStart][packageName] =
          (days[dayStart][packageName] || 0) + slice;
      });

      cursor = sliceEnd;
    }
  });

  return days;
};

// =====================================
// BLOCKED APPS CARD (own component, keeps its own state)
// =====================================

const BlockedAppsCard = memo(function BlockedAppsCard({
  stats,
  appInfo,
  nowMs,
  focusActive,
  hasFocusCapsules,
}) {
  const [socialOnly, setSocialOnly] = useState(true);
  const [offset, setOffset] = useState(0);

  const todayStart = startOfDay(nowMs);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        addDays(todayStart, -index)
      ),
    [todayStart]
  );

  const getEntries = useCallback(
    (dayStart) =>
      Object.entries(stats[dayStart] || {})
        .filter(([packageName, ms]) => {
          if (ms <= 0) return false;
          return socialOnly ? Boolean(SOCIAL_APPS[packageName]) : true;
        })
        .sort((a, b) => b[1] - a[1]),
    [stats, socialOnly]
  );

  const dayTotals = days.map((dayStart) =>
    getEntries(dayStart).reduce((sum, [, ms]) => sum + ms, 0)
  );

  const selectedDay = days[offset];
  const entries = getEntries(selectedDay);
  const maxMs = entries.length ? entries[0][1] : 0;
  const selectedTotal = dayTotals[offset];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <StopOutlined className="text-xl" />
          </div>

          <div className="min-w-0">
            <h2 className="text-lg font-bold">
              Blocked apps
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Time blocked by Focus Mode each day
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Social media only
          </span>

          <Switch
            size="small"
            checked={socialOnly}
            onChange={setSocialOnly}
          />
        </div>
      </div>

      {focusActive && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          <ThunderboltOutlined />
          Focus Mode is active right now
        </div>
      )}

      {!hasFocusCapsules ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-center text-sm leading-6 text-slate-500">
          Nothing has been blocked yet. Turn on Focus Mode when you
          create a capsule to block social media apps.
        </p>
      ) : (
        <>
          {/* DAY SELECTOR */}

          <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((dayStart, index) => (
              <button
                key={dayStart}
                type="button"
                onClick={() => setOffset(index)}
                className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${
                  offset === index
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <p className="text-xs font-semibold">
                  {getDayLabel(dayStart, todayStart)}
                </p>

                <p
                  className={`mt-1 text-[11px] ${
                    offset === index
                      ? "text-blue-100"
                      : "text-slate-400"
                  }`}
                >
                  {dayTotals[index] > 0
                    ? formatBlockedTime(dayTotals[index])
                    : "—"}
                </p>
              </button>
            ))}
          </div>

          {/* APP LIST */}

          {entries.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500">
              No {socialOnly ? "social media " : ""}apps were
              blocked on this day.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {entries.map(([packageName, ms]) => {
                const info = appInfo[packageName];
                const name =
                  info?.name ||
                  SOCIAL_APPS[packageName] ||
                  packageName;

                return (
                  <div key={packageName}>
                    <div className="flex items-center gap-3">
                      {info?.icon ? (
                        <img
                          src={info.icon}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-xl object-contain"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
                          {getAppInitial(name)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {name}
                          </p>

                          <p className="shrink-0 text-sm font-bold text-rose-600">
                            {formatBlockedTime(ms)}
                          </p>
                        </div>

                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-rose-400"
                            style={{
                              width: `${
                                maxMs > 0
                                  ? Math.max(4, (ms / maxMs) * 100)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-600">
                  Total blocked time
                </span>

                <span className="font-bold text-slate-900">
                  {formatBlockedTime(selectedTotal)}
                </span>
              </div>
            </div>
          )}

          <p className="mt-4 text-[11px] leading-5 text-slate-400">
            Based on the Focus Mode sessions started from your
            capsules. If a session is stopped early, the real time may
            be shorter.
          </p>
        </>
      )}
    </section>
  );
});

// =====================================
// REVIEW (last 2 days / month)
// =====================================

const EVENT_STYLES = {
  sealed: {
    label: "Sealed a capsule",
    icon: <LockOutlined />,
    tone: "bg-slate-100 text-slate-600",
  },
  unlocked: {
    label: "Capsule unlocked",
    icon: <UnlockOutlined />,
    tone: "bg-blue-50 text-blue-600",
  },
  achieved: {
    label: "Goal achieved",
    icon: <TrophyOutlined />,
    tone: "bg-emerald-50 text-emerald-600",
  },
  missed: {
    label: "Marked not achieved",
    icon: <CloseCircleOutlined />,
    tone: "bg-amber-50 text-amber-600",
  },
};

/** Unique Focus Mode time per day (not multiplied by the number of apps). */
const buildFocusSessionTime = (capsules, nowMs) => {
  const days = {};

  capsules.forEach((capsule) => {
    const focus = capsule.focusMode;

    if (!focus?.enabled) return;

    const created = capsule.createdAt?.toDate?.();

    if (!created) return;

    const start = created.getTime();
    const end = Math.min(
      start + Number(focus.durationMinutes || 0) * 60000,
      nowMs
    );

    let cursor = start;

    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const sliceEnd = Math.min(end, addDays(dayStart, 1));

      days[dayStart] = (days[dayStart] || 0) + (sliceEnd - cursor);
      cursor = sliceEnd;
    }
  });

  return days;
};

const getReviewRange = (mode, offset, nowMs) => {
  if (mode === "recent") {
    return {
      start: startOfDay(addDays(nowMs, -1)),
      end: nowMs + 1,
      label: "Yesterday and today",
    };
  }

  const base = new Date(nowMs);
  const start = new Date(
    base.getFullYear(),
    base.getMonth() + offset,
    1
  ).getTime();
  const end = new Date(
    base.getFullYear(),
    base.getMonth() + offset + 1,
    1
  ).getTime();

  return {
    start,
    end,
    label: new Date(start).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    }),
  };
};

const listRangeDays = (range, nowMs) => {
  const days = [];
  const last = Math.min(range.end - 1, nowMs);
  let cursor = range.start;

  while (cursor <= last) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
};

const formatEventTime = (ms) =>
  new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const MonthlyReviewCard = memo(function MonthlyReviewCard({
  capsules,
  blockedStats,
  appInfo,
  nowMs,
}) {
  const [mode, setMode] = useState("recent"); // "recent" | "month"
  const [monthOffset, setMonthOffset] = useState(0);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const range = useMemo(
    () => getReviewRange(mode, monthOffset, nowMs),
    [mode, monthOffset, nowMs]
  );

  const sessionByDay = useMemo(
    () => buildFocusSessionTime(capsules, nowMs),
    [capsules, nowMs]
  );

  const review = useMemo(() => {
    const inRange = (date) =>
      Boolean(date) &&
      date.getTime() >= range.start &&
      date.getTime() < range.end;

    let sealed = 0;
    let achieved = 0;
    let notAchieved = 0;
    let focusSessions = 0;
    const events = [];

    capsules.forEach((capsule) => {
      const created = capsule.createdAt?.toDate?.();
      const unlock = capsule.unlockAt?.toDate?.();
      const completed = capsule.completedAt?.toDate?.();

      if (inRange(created)) {
        sealed += 1;

        if (capsule.focusMode?.enabled) focusSessions += 1;

        events.push({
          id: `${capsule.id}-sealed`,
          type: "sealed",
          at: created.getTime(),
          title: capsule.title,
          note: capsule.focusMode?.enabled
            ? `Focus Mode for ${formatBlockedTime(
                Number(capsule.focusMode.durationMinutes || 0) * 60000
              )}`
            : "",
        });
      }

      if (unlock && unlock.getTime() <= nowMs && inRange(unlock)) {
        events.push({
          id: `${capsule.id}-unlocked`,
          type: "unlocked",
          at: unlock.getTime(),
          title: capsule.title,
          note: "",
        });
      }

      if (inRange(completed)) {
        if (capsule.status === "completed") {
          achieved += 1;
          events.push({
            id: `${capsule.id}-done`,
            type: "achieved",
            at: completed.getTime(),
            title: capsule.title,
            note: "",
          });
        } else if (capsule.status === "not_completed") {
          notAchieved += 1;
          events.push({
            id: `${capsule.id}-missed`,
            type: "missed",
            at: completed.getTime(),
            title: capsule.title,
            note: "",
          });
        }
      }
    });

    events.sort((a, b) => b.at - a.at);

    const days = listRangeDays(range, nowMs);

    const perDay = days.map((dayStart) => ({
      dayStart,
      ms: sessionByDay[dayStart] || 0,
    }));

    const focusTotal = perDay.reduce((sum, item) => sum + item.ms, 0);
    const maxDay = perDay.reduce(
      (best, item) => (item.ms > best.ms ? item : best),
      { dayStart: 0, ms: 0 }
    );

    const perApp = {};

    days.forEach((dayStart) => {
      Object.entries(blockedStats[dayStart] || {}).forEach(
        ([packageName, ms]) => {
          perApp[packageName] = (perApp[packageName] || 0) + ms;
        }
      );
    });

    const topApps = Object.entries(perApp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const reviewed = achieved + notAchieved;

    return {
      sealed,
      achieved,
      notAchieved,
      focusSessions,
      focusTotal,
      perDay,
      maxDay,
      topApps,
      events,
      rate: reviewed > 0 ? Math.round((achieved / reviewed) * 100) : null,
    };
  }, [capsules, blockedStats, range, sessionByDay, nowMs]);

  // Capsules that are unlocked but still waiting for a review (right now).
  const waitingReview = useMemo(
    () =>
      capsules.filter((capsule) => {
        const unlock = capsule.unlockAt?.toDate?.();

        return (
          unlock &&
          unlock.getTime() <= nowMs &&
          capsule.status !== "completed" &&
          capsule.status !== "not_completed"
        );
      }).length,
    [capsules, nowMs]
  );

  // Focus streak: consecutive days (ending today, or yesterday) with Focus Mode.
  const streak = useMemo(() => {
    let cursor = startOfDay(nowMs);

    if (!sessionByDay[cursor]) cursor = addDays(cursor, -1);

    let count = 0;

    while (sessionByDay[cursor] > 0) {
      count += 1;
      cursor = addDays(cursor, -1);
    }

    return count;
  }, [sessionByDay, nowMs]);

  const maxBarMs = review.perDay.reduce(
    (max, item) => Math.max(max, item.ms),
    0
  );

  const isEmpty =
    review.sealed === 0 &&
    review.achieved === 0 &&
    review.notAchieved === 0 &&
    review.focusTotal === 0;

  const visibleEvents = showAllEvents
    ? review.events
    : review.events.slice(0, 5);

  const todayStart = startOfDay(nowMs);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* HEADER */}

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <BarChartOutlined className="text-xl" />
        </div>

        <div className="min-w-0">
          <h2 className="text-lg font-bold">Your review</h2>

          <p className="mt-1 text-xs text-slate-400">
            What you did and how it went
          </p>
        </div>
      </div>

      {/* MODE TABS */}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        {[
          { key: "recent", label: "Last 2 days" },
          { key: "month", label: "Month" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setMode(tab.key);
              setShowAllEvents(false);
            }}
            className={`rounded-xl py-2 text-sm font-semibold ${
              mode === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* MONTH NAVIGATION / RANGE LABEL */}

      <div className="mt-4 flex items-center justify-between gap-2">
        {mode === "month" ? (
          <button
            type="button"
            aria-label="Previous month"
            disabled={monthOffset <= -11}
            onClick={() => {
              setMonthOffset((value) => value - 1);
              setShowAllEvents(false);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 disabled:opacity-40"
          >
            <LeftOutlined />
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}

        <p className="text-sm font-bold text-slate-800">{range.label}</p>

        {mode === "month" ? (
          <button
            type="button"
            aria-label="Next month"
            disabled={monthOffset >= 0}
            onClick={() => {
              setMonthOffset((value) => value + 1);
              setShowAllEvents(false);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 disabled:opacity-40"
          >
            <RightOutlined />
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}
      </div>

      {/* STATS */}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">Capsules sealed</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {review.sealed}
          </p>
        </div>

        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="text-xs text-emerald-700">Goals achieved</p>
          <p className="mt-1 text-2xl font-bold text-emerald-800">
            {review.achieved}
          </p>
        </div>

        <div className="rounded-2xl bg-amber-50 p-4">
          <p className="text-xs text-amber-700">Not achieved</p>
          <p className="mt-1 text-2xl font-bold text-amber-800">
            {review.notAchieved}
          </p>
        </div>

        <div className="rounded-2xl bg-rose-50 p-4">
          <p className="text-xs text-rose-700">Focus time</p>
          <p className="mt-1 text-2xl font-bold text-rose-800">
            {formatBlockedTime(review.focusTotal)}
          </p>
        </div>
      </div>

      {review.rate !== null && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              Goal success rate
            </span>

            <span className="font-bold text-slate-900">
              {review.rate}%
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${review.rate}%` }}
            />
          </div>
        </div>
      )}

      {isEmpty ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-center text-sm leading-6 text-slate-500">
          Nothing happened in this period yet. Create a capsule or start
          a Focus Mode session to see your review here.
        </p>
      ) : (
        <>
          {/* FOCUS CHART */}

          <div className="mt-5">
            <p className="mb-3 text-sm font-semibold text-slate-700">
              Focus time per day
            </p>

            <div className="flex h-24 items-end gap-1">
              {review.perDay.map((item) => (
                <div
                  key={item.dayStart}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${getDayLabel(item.dayStart, todayStart)}: ${formatBlockedTime(item.ms)}`}
                >
                  <div
                    className={`w-full rounded-t-md ${
                      item.ms > 0 ? "bg-rose-400" : "bg-slate-100"
                    }`}
                    style={{
                      height: `${
                        item.ms > 0 && maxBarMs > 0
                          ? Math.max(6, (item.ms / maxBarMs) * 100)
                          : 4
                      }%`,
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-1 flex gap-1">
              {review.perDay.map((item, index) => (
                <p
                  key={item.dayStart}
                  className="min-w-0 flex-1 text-center text-[9px] text-slate-400"
                >
                  {review.perDay.length <= 7 ||
                  index === 0 ||
                  (index + 1) % 5 === 0
                    ? new Date(item.dayStart).getDate()
                    : ""}
                </p>
              ))}
            </div>
          </div>

          {/* INSIGHTS */}

          <div className="mt-5 space-y-2 rounded-2xl bg-indigo-50 p-4 text-xs leading-5 text-indigo-900">
            {review.maxDay.ms > 0 && (
              <p>
                Best focus day:{" "}
                <span className="font-semibold">
                  {getDayLabel(review.maxDay.dayStart, todayStart)}
                </span>{" "}
                with {formatBlockedTime(review.maxDay.ms)} of blocking.
              </p>
            )}

            {review.focusSessions > 0 && (
              <p>
                You started {review.focusSessions} Focus Mode{" "}
                {review.focusSessions === 1 ? "session" : "sessions"} in
                this period.
              </p>
            )}

            {streak > 0 && (
              <p>
                Focus streak:{" "}
                <span className="font-semibold">
                  {streak} {streak === 1 ? "day" : "days"}
                </span>{" "}
                in a row.
              </p>
            )}

            {waitingReview > 0 && (
              <p className="font-semibold">
                {waitingReview}{" "}
                {waitingReview === 1 ? "capsule is" : "capsules are"} ready
                for your review.
              </p>
            )}
          </div>

          {/* MOST BLOCKED APPS */}

          {review.topApps.length > 0 && (
            <div className="mt-5">
              <p className="mb-3 text-sm font-semibold text-slate-700">
                Most blocked apps
              </p>

              <div className="space-y-3">
                {review.topApps.map(([packageName, ms]) => {
                  const info = appInfo[packageName];
                  const name =
                    info?.name || SOCIAL_APPS[packageName] || packageName;

                  return (
                    <div
                      key={packageName}
                      className="flex items-center gap-3"
                    >
                      {info?.icon ? (
                        <img
                          src={info.icon}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-lg object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">
                          {getAppInitial(name)}
                        </div>
                      )}

                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                        {name}
                      </p>

                      <p className="shrink-0 text-sm font-bold text-rose-600">
                        {formatBlockedTime(ms)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ACTIVITY TIMELINE */}

          {review.events.length > 0 && (
            <div className="mt-5">
              <p className="mb-3 text-sm font-semibold text-slate-700">
                What you did
              </p>

              <div className="space-y-3">
                {visibleEvents.map((event) => {
                  const style = EVENT_STYLES[event.type];

                  return (
                    <div key={event.id} className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.tone}`}
                      >
                        {style.icon}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">
                          {style.label}
                        </p>

                        <p className="truncate text-xs text-slate-500">
                          {event.title}
                          {event.note ? ` · ${event.note}` : ""}
                        </p>

                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatEventTime(event.at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {review.events.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllEvents((value) => !value)}
                  className="mt-3 text-xs font-semibold text-blue-600"
                >
                  {showAllEvents
                    ? "Show less"
                    : `Show all (${review.events.length})`}
                </button>
              )}
            </div>
          )}

          <p className="mt-4 text-[11px] leading-5 text-slate-400">
            Focus time comes from the Focus Mode sessions started from your
            capsules. If a session is stopped early, the real time may be
            shorter.
          </p>
        </>
      )}
    </section>
  );
});

// =====================================
// REVIEW BOX (keeps its own text so typing never rebuilds the page)
// =====================================

const ReviewBox = memo(function ReviewBox({
  capsuleId,
  saving,
  onSubmit,
}) {
  const [text, setText] = useState("");

  return (
    <div className="mt-5 space-y-3">
      <h4 className="font-bold">How did you do?</h4>

      <TextArea
        rows={3}
        maxLength={2000}
        showCount
        placeholder="Write about your progress and what you learned..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="primary"
          className="h-11 rounded-xl"
          loading={saving}
          disabled={saving}
          onClick={() => onSubmit(capsuleId, "completed", text)}
        >
          <CheckCircleOutlined />
          Achieved
        </Button>

        <Button
          className="h-11 rounded-xl"
          loading={saving}
          disabled={saving}
          onClick={() => onSubmit(capsuleId, "not_completed", text)}
        >
          Not achieved
        </Button>
      </div>
    </div>
  );
});

// =====================================
// COMPONENT
// =====================================

const UserTimeCapsule = () => {
  // Authentication
  const [user, setUser] = useState(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(!auth.currentUser);

  // Capsule data
  const [capsules, setCapsules] = useState([]);
  const [goals, setGoals] = useState({});
  const goalsLoaded = useRef(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Current time
  const [now, setNow] = useState(new Date());

  // Form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [unlockAt, setUnlockAt] = useState("");

  // Focus Mode
  const [focusEnabled, setFocusEnabled] = useState(false);
  const [installedApps, setInstalledApps] = useState([]);
  const [selectedApps, setSelectedApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState("");

  const [focusHours, setFocusHours] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(25);

  const [focusPermission, setFocusPermission] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(false);

  // Blocked apps card
  const [appInfo, setAppInfo] = useState({});
  const appInfoRequested = useRef(false);
  const [focusActive, setFocusActive] = useState(false);

  // Capsule list: which cards are expanded
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const toggleCapsule = useCallback((capsuleId) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);

      if (next.has(capsuleId)) next.delete(capsuleId);
      else next.add(capsuleId);

      return next;
    });
  }, []);

  const userId = user?.uid || null;

  // =====================================
  // AUTH LISTENER
  // =====================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // =====================================
  // CURRENT TIME
  // =====================================

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, CLOCK_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  // =====================================
  // LOAD CAPSULES
  // =====================================

  useEffect(() => {
    if (authLoading) return undefined;

    if (!userId) {
      setCapsules([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const capsuleRef = collection(
      db,
      "users",
      userId,
      "timeCapsules"
    );

    const capsuleQuery = query(
      capsuleRef,
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      capsuleQuery,
      (snapshot) => {
        const data = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setCapsules(data);
        setLoading(false);
      },
      (error) => {
        console.error("Capsule loading error:", error);

        message.error(
          error.code === "permission-denied"
            ? "You do not have permission to load capsules."
            : "Unable to load your capsules."
        );

        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId, authLoading]);

  // =====================================
  // LOAD UNLOCKED GOALS
  // Each sealed goal is read once (not on every clock tick).
  // =====================================

  useEffect(() => {
    goalsLoaded.current = new Set();
    setGoals({});
  }, [userId]);

  const unlockedIdsKey = useMemo(
    () =>
      capsules
        .filter(
          (capsule) =>
            capsule.unlockAt?.toDate &&
            capsule.unlockAt.toDate().getTime() <= now.getTime()
        )
        .map((capsule) => capsule.id)
        .sort()
        .join(","),
    [capsules, now]
  );

  useEffect(() => {
    if (!userId || !unlockedIdsKey) return undefined;

    const missingIds = unlockedIdsKey
      .split(",")
      .filter((id) => id && !goalsLoaded.current.has(id));

    if (missingIds.length === 0) return undefined;

    let cancelled = false;

    const loadGoals = async () => {
      const loaded = {};

      await Promise.all(
        missingIds.map(async (capsuleId) => {
          try {
            const goalSnapshot = await getDoc(
              doc(
                db,
                "users",
                userId,
                "timeCapsules",
                capsuleId,
                "sealed",
                "goal"
              )
            );

            loaded[capsuleId] = goalSnapshot.exists()
              ? goalSnapshot.data().goal
              : null;

            goalsLoaded.current.add(capsuleId);
          } catch (error) {
            // Not added to goalsLoaded, so it is retried on the next tick.
            console.warn("Goal loading error:", error);
          }
        })
      );

      if (!cancelled && Object.keys(loaded).length > 0) {
        setGoals((previous) => ({ ...previous, ...loaded }));
      }
    };

    loadGoals();

    return () => {
      cancelled = true;
    };
  }, [userId, unlockedIdsKey, now]);

  // =====================================
  // BLOCKED APPS: names/icons + live Focus Mode status
  // =====================================

  const hasFocusCapsules = useMemo(
    () => capsules.some((capsule) => capsule.focusMode?.enabled),
    [capsules]
  );

  useEffect(() => {
    if (!hasFocusCapsules || appInfoRequested.current) return;

    appInfoRequested.current = true;

    const loadAppInfo = async () => {
      try {
        const result = await getLaunchableApps();

        if (!result.success) return;

        const map = {};

        (result.data?.apps || []).forEach((app) => {
          map[app.packageName] = {
            name: app.appName,
            icon: app.appIcon,
          };
        });

        setAppInfo(map);
      } catch (error) {
        console.warn("Unable to load app names:", error);
      }
    };

    loadAppInfo();
  }, [hasFocusCapsules]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const checkFocus = async () => {
      try {
        const status = await getFocusStatus();

        if (!cancelled) {
          setFocusActive(Boolean(status?.success && status.active));
        }
      } catch {
        if (!cancelled) setFocusActive(false);
      }
    };

    checkFocus();

    return () => {
      cancelled = true;
    };
  }, [userId, now]);

  const blockedStats = useMemo(
    () => buildBlockedStats(capsules, now.getTime()),
    [capsules, now]
  );

  // =====================================
  // LOAD FOCUS APPS (for the create form)
  // =====================================

  useEffect(() => {
    if (!showForm || !focusEnabled) return undefined;

    let cancelled = false;

    const loadFocusApps = async () => {
      setAppsLoading(true);

      try {
        const [appsResult, permissionResult] = await Promise.all([
          getLaunchableApps(),
          hasAccessibilityPermission(),
        ]);

        if (cancelled) return;

        if (appsResult.success) {
          setInstalledApps(appsResult.data?.apps || []);
        } else {
          message.error(
            appsResult.error || "Unable to load installed apps."
          );
        }

        setFocusPermission(
          Boolean(
            permissionResult.success && permissionResult.granted
          )
        );
      } catch (error) {
        console.error("Focus setup error:", error);
        message.error("Unable to prepare Focus Mode.");
      } finally {
        if (!cancelled) {
          setAppsLoading(false);
        }
      }
    };

    loadFocusApps();

    return () => {
      cancelled = true;
    };
  }, [showForm, focusEnabled]);

  // =====================================
  // REFRESH ACCESSIBILITY PERMISSION
  // =====================================

  const refreshFocusPermission = async () => {
    setCheckingPermission(true);

    try {
      const result = await hasAccessibilityPermission();

      const granted = Boolean(
        result.success && result.granted
      );

      setFocusPermission(granted);

      if (granted) {
        message.success("Accessibility permission is enabled.");
      } else {
        message.warning(
          "Please enable Smart Shield Accessibility permission."
        );
      }

      return granted;
    } catch (error) {
      console.error("Permission check error:", error);
      setFocusPermission(false);
      return false;
    } finally {
      setCheckingPermission(false);
    }
  };

  // =====================================
  // APP SELECTION
  // =====================================

  const filteredApps = installedApps.filter((app) => {
    const search = appSearch.trim().toLowerCase();

    if (!search) return true;

    return (
      (app.appName || "").toLowerCase().includes(search) ||
      (app.packageName || "").toLowerCase().includes(search)
    );
  });

  const toggleSelectedApp = (packageName) => {
    setSelectedApps((previous) =>
      previous.includes(packageName)
        ? previous.filter((item) => item !== packageName)
        : [...previous, packageName]
    );
  };

  const selectAllVisibleApps = () => {
    const visiblePackages = filteredApps.map(
      (app) => app.packageName
    );

    setSelectedApps((previous) => [
      ...new Set([...previous, ...visiblePackages]),
    ]);
  };

  const clearSelectedApps = () => {
    setSelectedApps([]);
  };

  // =====================================
  // RESET FORM
  // =====================================

  const resetForm = () => {
    setTitle("");
    setGoal("");
    setUnlockAt("");

    setFocusEnabled(false);
    setInstalledApps([]);
    setSelectedApps([]);
    setAppSearch("");

    setFocusHours(0);
    setFocusMinutes(25);

    setFocusPermission(false);
    setShowForm(false);
  };

  // =====================================
  // CREATE CAPSULE
  // =====================================

  const createCapsule = async () => {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      message.error("Please log in again.");
      return;
    }

    const cleanTitle = title.trim();
    const cleanGoal = goal.trim();

    // Basic validation
    if (!cleanTitle || !cleanGoal || !unlockAt) {
      message.warning("Please complete all fields.");
      return;
    }

    if (cleanTitle.length > 100) {
      message.warning("Title cannot exceed 100 characters.");
      return;
    }

    if (cleanGoal.length < 5 || cleanGoal.length > 2000) {
      message.warning(
        "Goal must contain 5 to 2000 characters."
      );
      return;
    }

    // Unlock date validation
    const selectedDate = new Date(unlockAt);

    if (
      Number.isNaN(selectedDate.getTime()) ||
      selectedDate.getTime() <= Date.now()
    ) {
      message.warning(
        "Please select a valid future date and time."
      );
      return;
    }

    // Focus duration validation
    const totalFocusMinutes =
      Number(focusHours) * 60 + Number(focusMinutes);

    if (focusEnabled) {
      if (
        !Number.isInteger(totalFocusMinutes) ||
        totalFocusMinutes < 1 ||
        totalFocusMinutes > 1440
      ) {
        message.warning(
          "Focus duration must be between 1 minute and 24 hours."
        );
        return;
      }

      if (selectedApps.length === 0) {
        message.warning("Select at least one app to block.");
        return;
      }

      // Fresh Accessibility permission check
      setSaving(true);

      const permissionResult = await hasAccessibilityPermission();

      const permissionGranted = Boolean(
        permissionResult.success && permissionResult.granted
      );

      setFocusPermission(permissionGranted);

      if (!permissionGranted) {
        setSaving(false);

        message.error(
          "Enable Smart Shield Accessibility permission before creating this capsule."
        );

        return;
      }

      // Check whether another native session is already running
      const currentFocus = await getFocusStatus();

      if (!currentFocus.success) {
        setSaving(false);

        message.error(
          currentFocus.error || "Unable to check current Focus Mode status."
        );

        return;
      }

      if (currentFocus.active) {
        setSaving(false);

        message.warning(
          "Another Focus Mode session is already running. Finish it before creating this capsule with Focus Mode."
        );

        return;
      }
    } else {
      setSaving(true);
    }

    try {
      const capsuleCollection = collection(
        db,
        "users",
        currentUser.uid,
        "timeCapsules"
      );

      const capsuleRef = doc(capsuleCollection);

      const goalRef = doc(
        db,
        "users",
        currentUser.uid,
        "timeCapsules",
        capsuleRef.id,
        "sealed",
        "goal"
      );

      const capsuleData = {
        title: cleanTitle,
        unlockAt: Timestamp.fromDate(selectedDate),
        createdAt: serverTimestamp(),
        status: "locked",
      };

      // Save optional Focus Mode settings
      if (focusEnabled) {
        capsuleData.focusMode = {
          enabled: true,
          selectedApps,
          durationMinutes: totalFocusMinutes,
        };
      }

      // Atomic Firestore write
      const batch = writeBatch(db);

      batch.set(capsuleRef, capsuleData);

      batch.set(goalRef, {
        goal: cleanGoal,
      });

      await batch.commit();

      // Start Focus Mode only after successful Firestore save
      if (focusEnabled) {
        const focusResult = await startFocusSession({
          packages: selectedApps,
          durationMs: totalFocusMinutes * 60 * 1000,
        });

        if (!focusResult.success) {
          console.error(
            "Focus Mode start error:",
            focusResult.error
          );

          message.warning(
            "Your capsule was created, but Focus Mode could not start: " +
              focusResult.error
          );
        } else {
          message.success(
            "Time Capsule created and Focus Mode activated!"
          );
        }
      } else {
        message.success("Your Time Capsule has been created!");
      }

      resetForm();
    } catch (error) {
      console.error("TIME CAPSULE CREATE ERROR:", {
        code: error.code,
        message: error.message,
        name: error.name,
      });

      if (error.code === "permission-denied") {
        message.error(
          "Firestore denied the operation. Check your security rules."
        );
      } else if (error.code === "unavailable") {
        message.error(
          "Firebase unavailable. Check your internet connection."
        );
      } else {
        message.error(
          error.message || "Unable to create your capsule."
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // =====================================
  // REVIEW CAPSULE
  // (the reflection text now comes from ReviewBox)
  // =====================================

  const submitReview = useCallback(
    async (capsuleId, status, reflectionText) => {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        message.error("Please log in again.");
        return;
      }

      const reflection = String(reflectionText || "");

      if (reflection.trim().length > 2000) {
        message.warning(
          "Reflection cannot exceed 2000 characters."
        );
        return;
      }

      const capsule = capsules.find(
        (item) => item.id === capsuleId
      );

      if (
        !capsule?.unlockAt?.toDate ||
        capsule.unlockAt.toDate().getTime() > Date.now()
      ) {
        message.error("This capsule is not unlocked yet.");
        return;
      }

      if (
        capsule.status === "completed" ||
        capsule.status === "not_completed"
      ) {
        message.warning(
          "This capsule has already been reviewed."
        );
        return;
      }

      setSaving(true);

      try {
        const capsuleRef = doc(
          db,
          "users",
          currentUser.uid,
          "timeCapsules",
          capsuleId
        );

        await updateDoc(capsuleRef, {
          status,
          completedAt: serverTimestamp(),
          reflection: reflection.trim(),
        });

        message.success(
          "Your capsule review has been saved!"
        );
      } catch (error) {
        console.error("Review error:", error);

        message.error(
          error.message || "Unable to submit your review."
        );
      } finally {
        setSaving(false);
      }
    },
    [capsules]
  );

  // =====================================
  // AUTH / LOADING
  // =====================================

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="font-semibold text-slate-700">
          Please log in to access your capsules.
        </p>
      </div>
    );
  }

  // =====================================
  // PAGE UI
  // =====================================

  return (
    <div className="min-h-screen bg-slate-50 pb-28 text-slate-900">

      {/* HEADER */}

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <LockOutlined className="text-xl" />
          </div>

          <div>
            <p className="text-xs font-bold tracking-wider text-blue-600">
              SMART SHIELD
            </p>

            <h1 className="text-lg font-bold">
              Digital Time Capsule
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-5">

        {/* INTRODUCTION */}

        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 to-indigo-800 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-100">
                Your future starts today
              </p>

              <h2 className="mt-3 text-2xl font-bold">
                Make a promise to yourself.
              </h2>
            </div>

            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <LockOutlined className="text-3xl" />
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-blue-100">
            Write down a personal goal, seal it, and revisit
            your commitment when the time comes.
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs text-blue-100">
            <BulbOutlined />
            <span>
              Small commitments create lasting habits.
            </span>
          </div>
        </section>

        {/* BLOCKED APPS PER DAY */}

        <BlockedAppsCard
          stats={blockedStats}
          appInfo={appInfo}
          nowMs={now.getTime()}
          focusActive={focusActive}
          hasFocusCapsules={hasFocusCapsules}
        />

        {/* REVIEW: LAST 2 DAYS / MONTH */}

        <MonthlyReviewCard
          capsules={capsules}
          blockedStats={blockedStats}
          appInfo={appInfo}
          nowMs={now.getTime()}
        />

        {/* CREATE BUTTON */}

        {!showForm && (
          <Button
            type="primary"
            size="large"
            block
            icon={<PlusOutlined />}
            className="h-12 rounded-2xl"
            onClick={() => setShowForm(true)}
          >
            Create a Time Capsule
          </Button>
        )}

        {/* CREATE FORM */}

        {showForm && (
          <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">
                Create your capsule
              </h2>

              <button
                type="button"
                disabled={saving}
                onClick={resetForm}
                className="text-sm font-medium text-slate-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>

            {/* TITLE */}

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Capsule title
              </label>

              <Input
                size="large"
                maxLength={100}
                placeholder="Example: My study commitment"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* GOAL */}

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Your personal goal
              </label>

              <TextArea
                rows={4}
                maxLength={2000}
                showCount
                placeholder="Example: I will study every day without using social media."
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>

            {/* UNLOCK DATE */}

            <div>
              <label className="mb-2 block text-sm font-semibold">
                Unlock date and time
              </label>

              <Input
                type="datetime-local"
                size="large"
                value={unlockAt}
                min={toLocalDateTimeInput(
                  new Date(now.getTime() + 60000)
                )}
                onChange={(e) => setUnlockAt(e.target.value)}
              />

              <p className="mt-2 text-xs text-slate-400">
                Your goal will remain sealed until this date and time.
              </p>
            </div>

            {/* FOCUS MODE */}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <ThunderboltOutlined className="text-lg" />
                  </div>

                  <div>
                    <h3 className="font-bold text-slate-800">
                      Focus Mode
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Block distracting apps while you focus.
                    </p>
                  </div>
                </div>

                <Switch
                  checked={focusEnabled}
                  disabled={saving}
                  onChange={(checked) => {
                    setFocusEnabled(checked);

                    if (!checked) {
                      setSelectedApps([]);
                      setAppSearch("");
                    }
                  }}
                />
              </div>

              {focusEnabled && (
                <div className="mt-5 space-y-5">

                  {/* DURATION */}

                  <div>
                    <label className="mb-3 block text-sm font-semibold">
                      Custom Focus Duration
                    </label>

                    <div className="grid grid-cols-2 gap-3">

                      <div>
                        <p className="mb-2 text-xs text-slate-500">
                          Hours
                        </p>

                        <InputNumber
                          className="w-full"
                          size="large"
                          min={0}
                          max={24}
                          value={focusHours}
                          disabled={saving}
                          onChange={(value) =>
                            setFocusHours(value ?? 0)
                          }
                        />
                      </div>

                      <div>
                        <p className="mb-2 text-xs text-slate-500">
                          Minutes
                        </p>

                        <InputNumber
                          className="w-full"
                          size="large"
                          min={0}
                          max={59}
                          value={focusMinutes}
                          disabled={saving}
                          onChange={(value) =>
                            setFocusMinutes(value ?? 0)
                          }
                        />
                      </div>

                    </div>

                    <p className="mt-2 text-xs text-slate-400">
                      Minimum 1 minute and maximum 24 hours.
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {[15, 25, 45, 60].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setFocusHours(0);
                            setFocusMinutes(minutes);
                          }}
                          className={`rounded-full px-3 py-2 text-xs font-semibold ${
                            focusHours === 0 &&
                            focusMinutes === minutes
                              ? "bg-blue-600 text-white"
                              : "bg-white text-slate-600"
                          }`}
                        >
                          {minutes} min
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* APP SELECTION */}

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold">
                        Select apps to block
                      </label>

                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        {selectedApps.length} selected
                      </span>
                    </div>

                    <div className="mb-3 flex gap-2">
                      <Button
                        size="small"
                        disabled={
                          appsLoading ||
                          filteredApps.length === 0 ||
                          saving
                        }
                        onClick={selectAllVisibleApps}
                      >
                        Select visible
                      </Button>

                      <Button
                        size="small"
                        disabled={selectedApps.length === 0 || saving}
                        onClick={clearSelectedApps}
                      >
                        Clear
                      </Button>
                    </div>

                    <Input
                      allowClear
                      size="large"
                      prefix={
                        <SearchOutlined className="text-slate-400" />
                      }
                      placeholder="Search installed apps"
                      value={appSearch}
                      onChange={(e) =>
                        setAppSearch(e.target.value)
                      }
                    />

                    {appsLoading ? (
                      <div className="py-8 text-center">
                        <Spin />
                        <p className="mt-2 text-xs text-slate-500">
                          Loading installed apps...
                        </p>
                      </div>
                    ) : filteredApps.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">
                        {appSearch
                          ? "No matching apps found."
                          : "No launchable apps found."}
                      </p>
                    ) : (
                      <div className="mt-2 max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white px-3">

                        {filteredApps.map((app) => {
                          const isSelected = selectedApps.includes(
                            app.packageName
                          );

                          return (
                            <button
                              type="button"
                              key={app.packageName}
                              disabled={saving}
                              onClick={() =>
                                toggleSelectedApp(app.packageName)
                              }
                              className="flex w-full items-center gap-3 py-3 text-left disabled:opacity-50"
                            >
                              {app.appIcon ? (
                                <img
                                  src={app.appIcon}
                                  alt=""
                                  className="h-10 w-10 shrink-0 rounded-xl object-contain"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-700">
                                  {getAppInitial(app.appName)}
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800">
                                  {app.appName}
                                </p>

                                <p className="truncate text-[10px] text-slate-400">
                                  {app.packageName}
                                </p>
                              </div>

                              {isSelected ? (
                                <CheckCircleOutlined className="text-xl text-blue-600" />
                              ) : (
                                <span className="h-5 w-5 rounded-full border-2 border-slate-300" />
                              )}
                            </button>
                          );
                        })}

                      </div>
                    )}
                  </div>

                  {/* ACCESSIBILITY PERMISSION */}

                  <div
                    className={`rounded-xl border p-3 ${
                      focusPermission
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <SafetyCertificateOutlined
                        className={
                          focusPermission
                            ? "text-emerald-600"
                            : "text-amber-600"
                        }
                      />

                      <p
                        className={`text-sm font-semibold ${
                          focusPermission
                            ? "text-emerald-800"
                            : "text-amber-800"
                        }`}
                      >
                        {focusPermission
                          ? "Accessibility permission enabled"
                          : "Accessibility permission required"}
                      </p>
                    </div>

                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      Smart Shield needs Accessibility permission
                      to detect and block selected apps.
                    </p>

                    {!focusPermission && (
                      <Button
                        size="small"
                        type="primary"
                        className="mt-3"
                        onClick={openAccessibilitySettings}
                      >
                        Open Accessibility Settings
                      </Button>
                    )}

                    <Button
                      size="small"
                      className="mt-3 ml-2"
                      loading={checkingPermission}
                      onClick={refreshFocusPermission}
                    >
                      Check permission
                    </Button>
                  </div>

                  {/* FOCUS SUMMARY */}

                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                    <p className="text-sm font-semibold text-blue-800">
                      Focus session summary
                    </p>

                    <p className="mt-2 text-xs leading-5 text-blue-700">
                      {focusHours} hour(s) and {focusMinutes} minute(s)
                      of app blocking will begin immediately after
                      this capsule is saved.
                    </p>

                    <p className="mt-1 text-xs leading-5 text-blue-700">
                      Your capsule will remain locked until its
                      separate unlock date.
                    </p>
                  </div>

                </div>
              )}
            </div>

            {/* CREATE BUTTON */}

            <Button
              type="primary"
              size="large"
              block
              loading={saving}
              icon={<LockOutlined />}
              className="h-12 rounded-2xl"
              onClick={createCapsule}
            >
              Seal My Capsule
            </Button>

          </section>
        )}

        {/* CAPSULE LIST */}

        <section>

          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">
                Your capsules
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Your promises to your future self
              </p>
            </div>

            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {capsules.length} capsules
            </span>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white py-16 text-center">
              <Spin size="large" />

              <p className="mt-3 text-sm text-slate-500">
                Loading your capsules...
              </p>
            </div>
          ) : capsules.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center">

              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <LockOutlined className="text-3xl" />
              </div>

              <h3 className="mt-4 font-bold">
                No capsules yet
              </h3>

              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">
                Create your first capsule and make a commitment
                to your future self.
              </p>

              <Button
                type="primary"
                className="mt-5 rounded-xl"
                onClick={() => setShowForm(true)}
              >
                Create your first capsule
              </Button>

            </div>
          ) : (
            <div className="space-y-3">

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedIds(new Set(capsules.map((item) => item.id)))
                  }
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  Expand all
                </button>

                <button
                  type="button"
                  onClick={() => setExpandedIds(new Set())}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  Collapse all
                </button>
              </div>

              {capsules.map((capsule) => {
                const isUnlocked =
                  capsule.unlockAt?.toDate &&
                  capsule.unlockAt.toDate().getTime() <= now.getTime();

                const isReviewed =
                  capsule.status === "completed" ||
                  capsule.status === "not_completed";

                const isOpen = expandedIds.has(capsule.id);
                const needsReview = isUnlocked && !isReviewed;

                const summary = isReviewed
                  ? `Reviewed ${formatDate(capsule.completedAt?.toDate?.())}`
                  : isUnlocked
                  ? "Ready for your review"
                  : `Unlocks in ${getRemainingTime(capsule.unlockAt, now)}`;

                return (
                  <article
                    key={capsule.id}
                    className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${
                      needsReview ? "border-blue-300" : "border-slate-200"
                    }`}
                  >

                    {/* COLLAPSED HEADER (always visible) */}

                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggleCapsule(capsule.id)}
                      className="flex w-full items-center gap-3 p-4 text-left"
                    >

                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                          isReviewed
                            ? "bg-emerald-50 text-emerald-600"
                            : isUnlocked
                            ? "bg-blue-50 text-blue-600"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {isReviewed ? (
                          <CheckCircleOutlined className="text-xl" />
                        ) : isUnlocked ? (
                          <UnlockOutlined className="text-xl" />
                        ) : (
                          <LockOutlined className="text-xl" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-bold">
                          {capsule.title}
                        </h3>

                        <p
                          className={`mt-1 truncate text-xs ${
                            needsReview
                              ? "font-semibold text-blue-600"
                              : "text-slate-400"
                          }`}
                        >
                          {summary}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                          isReviewed
                            ? capsule.status === "completed"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                            : isUnlocked
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {capsule.status === "completed"
                          ? "Completed"
                          : capsule.status === "not_completed"
                          ? "Not completed"
                          : isUnlocked
                          ? "Unlocked"
                          : "Locked"}
                      </span>

                      <DownOutlined
                        className={`shrink-0 text-xs text-slate-400 transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />

                    </button>

                    {/* EXPANDED CONTENT
                        (kept mounted while collapsed so a half-written
                        reflection is not lost) */}

                    <div
                      className={
                        isOpen
                          ? "border-t border-slate-100 px-5 pb-5 pt-4"
                          : "hidden"
                      }
                    >

                      <p className="text-xs text-slate-400">
                        Created {formatDate(capsule.createdAt?.toDate?.())}
                      </p>

                      {/* UNLOCK INFORMATION */}

                      <div className="mt-4 rounded-2xl bg-slate-50 p-4">

                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <CalendarOutlined className="text-blue-600" />
                          Unlock date
                        </div>

                        <p className="mt-2 text-sm text-slate-500">
                          {formatDate(
                            capsule.unlockAt?.toDate?.()
                          )}
                        </p>

                        {!isUnlocked && (
                          <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-blue-700">
                            <ClockCircleOutlined />
                            {getRemainingTime(capsule.unlockAt, now)}
                            {" "}remaining
                          </div>
                        )}

                      </div>

                      {/* FOCUS MODE INFORMATION */}

                      {capsule.focusMode?.enabled && (
                        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">

                          <div className="flex items-center gap-2">
                            <ThunderboltOutlined className="text-blue-600" />

                            <p className="text-sm font-semibold text-blue-800">
                              Focus Mode enabled
                            </p>
                          </div>

                          <p className="mt-2 text-xs text-blue-700">
                            Duration:{" "}
                            {Math.floor(
                              capsule.focusMode.durationMinutes / 60
                            )}h{" "}
                            {capsule.focusMode.durationMinutes % 60}m
                          </p>

                          <p className="mt-1 text-xs text-blue-700">
                            {capsule.focusMode.selectedApps?.length || 0}
                            {" "}apps selected for blocking
                          </p>

                        </div>
                      )}

                      {/* LOCKED CONTENT */}

                      {!isUnlocked && (
                        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-4">

                          <LockOutlined className="text-xl text-slate-400" />

                          <div>
                            <p className="text-sm font-semibold text-slate-700">
                              Your goal is sealed
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                              Come back when your capsule unlocks.
                            </p>
                          </div>

                        </div>
                      )}

                      {/* UNLOCKED GOAL */}

                      {isUnlocked && (
                        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">

                          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
                            Your original goal
                          </p>

                          {typeof goals[capsule.id] === "string" ? (
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                              {goals[capsule.id]}
                            </p>
                          ) : (
                            <p className="mt-3 text-sm text-slate-500">
                              {goals[capsule.id] === null
                                ? "The sealed goal document was not found."
                                : "Loading your goal..."}
                            </p>
                          )}

                        </div>
                      )}

                      {/* REVIEW FORM */}

                      {isUnlocked &&
                        !isReviewed &&
                        typeof goals[capsule.id] === "string" && (
                          <ReviewBox
                            capsuleId={capsule.id}
                            saving={saving}
                            onSubmit={submitReview}
                          />
                        )}

                      {/* SAVED REVIEW */}

                      {isReviewed && (
                        <div className="mt-4 rounded-2xl bg-slate-50 p-4">

                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Your reflection
                          </p>

                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                            {capsule.reflection ||
                              "No reflection added."}
                          </p>

                          <p className="mt-3 text-xs text-slate-400">
                            Reviewed on{" "}
                            {formatDate(
                              capsule.completedAt?.toDate?.()
                            )}
                          </p>

                        </div>
                      )}

                    </div>

                  </article>
                );
              })}

            </div>
          )}

        </section>

      </main>

      <BottomNavigation activeTab="time-capsule" />

    </div>
  );
};

export default UserTimeCapsule;