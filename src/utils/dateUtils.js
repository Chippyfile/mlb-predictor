// src/utils/dateUtils.js
// Shared date utilities — all date logic uses Pacific time, not UTC
// This prevents the "wrong day" bug where UTC midnight rolls over before
// West Coast games finish (e.g., a 7pm PST game is April 6 locally but April 7 UTC)

export const pstToday = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));

export const pstTodayStr = () => {
  const d = pstToday();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
