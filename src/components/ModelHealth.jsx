// src/components/ModelHealth.jsx
// Compact model freshness indicator for the nav bar.
// Fetches /cron/status from Railway and shows a dot per sport.
// Click to expand full details panel.

import { useState, useEffect, useCallback } from "react";

const ML_API = "https://sports-predictor-api-production.up.railway.app";

// Matches the existing C palette from Shared.jsx
const C = {
  green: "#3fb950", yellow: "#e3b341", red: "#f85149", blue: "#58a6ff",
  dim: "#484f58", muted: "#8b949e", border: "#21262d", bg: "#080c10", card: "#0d1117",
};

const SPORT_ICONS = { mlb: "⚾", nba: "🏀", ncaa: "🏀", nfl: "🏈", ncaaf: "🏈" };
const SPORT_LABELS = { mlb: "MLB", nba: "NBA", ncaa: "NCAAB", nfl: "NFL", ncaaf: "NCAAF" };

function freshnessColor(f) {
  if (f === "fresh") return C.green;
  if (f === "stale") return C.yellow;
  if (f === "very_stale") return C.red;
  if (f === "no_model") return C.dim;
  return C.muted;
}

function freshnessLabel(f) {
  if (f === "fresh") return "FRESH";
  if (f === "stale") return "STALE";
  if (f === "very_stale") return "STALE!";
  if (f === "no_model") return "NONE";
  return "?";
}

function timeAgo(hours) {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ModelHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${ML_API}/cron/status`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(id);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div style={{ fontSize: 9, color: C.dim, letterSpacing: 1, whiteSpace: "nowrap" }}>
        ML ···
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        onClick={fetchStatus}
        style={{
          fontSize: 9, color: C.red, letterSpacing: 1, cursor: "pointer",
          whiteSpace: "nowrap", opacity: 0.8,
        }}
        title="Railway API unreachable — click to retry"
      >
        ML ✕
      </div>
    );
  }

  const models = data.models || {};
  const sportKeys = ["mlb", "nba", "ncaa", "nfl", "ncaaf"];
  const activeSet = new Set(data.active_sports || []);

  // Summary dot: green if all active are fresh, yellow if any stale, red if any very_stale
  const activeModels = sportKeys.filter(s => activeSet.has(s)).map(s => models[s]);
  const summaryColor = activeModels.some(m => m?.freshness === "very_stale" || m?.freshness === "no_model")
    ? C.red
    : activeModels.some(m => m?.freshness === "stale")
      ? C.yellow
      : C.green;

  return (
    <div style={{ position: "relative" }}>
      {/* Compact nav-bar indicator */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
          padding: "3px 8px", borderRadius: 6,
          background: expanded ? "#161b22" : "transparent",
          border: `1px solid ${expanded ? C.border : "transparent"}`,
          transition: "all 0.15s",
        }}
        title="Model Health — click for details"
      >
        {/* Animated pulse dot */}
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: summaryColor,
          boxShadow: `0 0 4px ${summaryColor}`,
          animation: summaryColor !== C.green ? "pulse 2s ease infinite" : "none",
        }} />
        <span style={{ fontSize: 9, color: C.muted, letterSpacing: 1, fontWeight: 700 }}>ML</span>

        {/* Mini dots per active sport */}
        <div style={{ display: "flex", gap: 2 }}>
          {sportKeys.filter(s => activeSet.has(s)).map(s => (
            <div key={s} style={{
              width: 4, height: 4, borderRadius: "50%",
              background: freshnessColor(models[s]?.freshness),
              opacity: 0.9,
            }} />
          ))}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 6,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 14, minWidth: 300, zIndex: 200,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10, paddingBottom: 8,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#e2e8f0", letterSpacing: 2 }}>
              MODEL HEALTH
            </span>
            <span style={{ fontSize: 8, color: C.dim, letterSpacing: 1 }}>
              {data.next_run || "Daily 4 AM ET"}
            </span>
          </div>

          {/* Sport rows */}
          {sportKeys.map(s => {
            const m = models[s] || {};
            const active = activeSet.has(s);
            return (
              <div key={s} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0",
                opacity: active ? 1 : 0.4,
                borderBottom: `1px solid ${C.bg}`,
              }}>
                {/* Sport icon + name */}
                <span style={{ fontSize: 11, width: 18, textAlign: "center" }}>{SPORT_ICONS[s]}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, width: 46, letterSpacing: 1,
                  color: active ? "#e2e8f0" : C.dim,
                }}>
                  {SPORT_LABELS[s]}
                </span>

                {/* Status badge */}
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: 1.5,
                  color: freshnessColor(m.freshness),
                  background: `${freshnessColor(m.freshness)}15`,
                  border: `1px solid ${freshnessColor(m.freshness)}33`,
                  borderRadius: 4, padding: "1px 6px",
                  minWidth: 44, textAlign: "center",
                }}>
                  {freshnessLabel(m.freshness)}
                </span>

                {/* Age */}
                <span style={{ fontSize: 9, color: C.muted, flex: 1, textAlign: "right" }}>
                  {m.trained ? timeAgo(m.age_hours) : "—"}
                </span>

                {/* Training size + MAE */}
                {m.n_train && (
                  <span style={{ fontSize: 8, color: C.dim, textAlign: "right", minWidth: 70 }}>
                    {m.n_train.toLocaleString()} gm · {m.mae_cv?.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}

          {/* Last cron run */}
          {data.last_cron_run && (
            <div style={{
              marginTop: 8, paddingTop: 8,
              borderTop: `1px solid ${C.border}`,
              fontSize: 8, color: C.dim, letterSpacing: 1,
              display: "flex", justifyContent: "space-between",
            }}>
              <span>Last auto-train: {new Date(data.last_cron_run.run_at).toLocaleDateString()}</span>
              <span>{data.last_cron_run.duration_sec?.toFixed(0)}s · {data.last_cron_run.status}</span>
            </div>
          )}

          {/* Refresh button */}
          <div style={{ marginTop: 8, textAlign: "center" }}>
            <button
              onClick={(e) => { e.stopPropagation(); fetchStatus(); }}
              style={{
                fontSize: 8, color: C.blue, background: "transparent",
                border: `1px solid ${C.blue}33`, borderRadius: 4,
                padding: "3px 12px", cursor: "pointer", letterSpacing: 1, fontWeight: 700,
                fontFamily: "inherit",
              }}
            >
              ↻ REFRESH
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
