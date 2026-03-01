// src/App.jsx
// Root component — imports all sport modules, handles nav + calibration state
// ~130 lines (down from 5,224)

import { useState, useEffect } from "react";

// ── Shared UI & constants ──────────────────────────────────────
import { C, ParlayBuilder } from "./components/Shared.jsx";
import { SEASON } from "./utils/sharedUtils.js";

// ── Sport section components ───────────────────────────────────
import { MLBSection }   from "./sports/mlb/MLBCalendarTab.jsx";
import { NCAASection }  from "./sports/ncaa/NCAACalendarTab.jsx";
import { NBASection }   from "./sports/nba/NBACalendarTab.jsx";
import { NFLSection }   from "./sports/nfl/NFLCalendarTab.jsx";
import { NCAAFSection } from "./sports/ncaaf/NCAAFCalendarTab.jsx";

// ── Auto-sync functions (run once on mount) ────────────────────
import { mlbAutoSync }   from "./sports/mlb/mlbSync.js";
import { ncaaAutoSync }  from "./sports/ncaa/ncaaSync.js";
import { nbaAutoSync }   from "./sports/nba/nbaSync.js";
import { nflAutoSync }   from "./sports/nfl/nflSync.js";
import { ncaafAutoSync } from "./sports/ncaaf/ncaafSync.js";
import ModelHealth from "./components/ModelHealth.jsx";

// ─────────────────────────────────────────────────────────────
// SPORT NAV CONFIG
// ─────────────────────────────────────────────────────────────
const SPORTS = [
  ["MLB",   "⚾", C.blue],
  ["NCAA",  "🏀", C.orange],
  ["NBA",   "🏀", "#58a6ff"],
  ["NFL",   "🏈", "#f97316"],
  ["NCAAF", "🏈", "#22c55e"],
];

// ─────────────────────────────────────────────────────────────
// CALIBRATION HELPER — reads/writes localStorage
// ─────────────────────────────────────────────────────────────
function useCalibration(key, defaultVal = 1.0) {
  const [value, setValue] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(key));
      return isNaN(v) ? defaultVal : v;
    } catch { return defaultVal; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, value); } catch {}
  }, [key, value]);
  return [value, setValue];
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [sport, setSport] = useState("MLB");

  // Per-sport game lists (passed down so ParlayBuilder can combine them)
  const [mlbGames,   setMlbGames]   = useState([]);
  const [ncaaGames,  setNcaaGames]  = useState([]);
  const [nbaGames,   setNbaGames]   = useState([]);
  const [nflGames,   setNflGames]   = useState([]);
  const [ncaafGames, setNcaafGames] = useState([]);

  // Calibration factors (persisted to localStorage)
  const [calibrationMLB,   setCalibrationMLB]   = useCalibration("cal_mlb");
  const [calibrationNCAA,  setCalibrationNCAA]  = useCalibration("cal_ncaa");
  const [calibrationNBA,   setCalibrationNBA]   = useCalibration("cal_nba");
  const [calibrationNFL,   setCalibrationNFL]   = useCalibration("cal_nfl");
  const [calibrationNCAAF, setCalibrationNCAAF] = useCalibration("cal_ncaaf");

  const [refreshKey, setRefreshKey] = useState(0);
  const [syncMsg,    setSyncMsg]    = useState("");

  // Run all auto-syncs once on mount
  useEffect(() => {
    (async () => {
      setSyncMsg("⚾ Syncing MLB…");   await mlbAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏀 Syncing NCAA…");  await ncaaAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏀 Syncing NBA…");   await nbaAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏈 Syncing NFL…");   await nflAutoSync(m => setSyncMsg(m));
      setSyncMsg("🏈 Syncing NCAAF…"); await ncaafAutoSync(m => setSyncMsg(m));
      setSyncMsg("");
      setRefreshKey(k => k + 1);
    })();
  }, []);

  // Badge showing active calibration overrides
  const calActive = [
    calibrationMLB   !== 1.0 && `MLB×${calibrationMLB}`,
    calibrationNCAA  !== 1.0 && `NCAAB×${calibrationNCAA}`,
    calibrationNBA   !== 1.0 && `NBA×${calibrationNBA}`,
    calibrationNFL   !== 1.0 && `NFL×${calibrationNFL}`,
    calibrationNCAAF !== 1.0 && `NCAAF×${calibrationNCAAF}`,
  ].filter(Boolean);

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", color: "#e2e8f0",
      fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace",
    }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }
        select option { background: #0d1117; }
        button { font-family: inherit; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      {/* ── NAV ───────────────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`, padding: "0 12px",
        display: "flex", alignItems: "center", gap: 10, height: 52,
        position: "sticky", top: 0, background: "#0d1117", zIndex: 100, flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#e2e8f0", letterSpacing: 1, whiteSpace: "nowrap" }}>
          ⚾🏀🏀🏈🏈 <span style={{ fontSize: 8, color: C.dim, letterSpacing: 2 }}>PREDICTOR v15</span>
        </div>

        <div style={{
          display: "flex", gap: 2, background: "#080c10",
          border: `1px solid ${C.border}`, borderRadius: 8, padding: 3,
          marginLeft: "auto", flexWrap: "wrap",
        }}>
          {SPORTS.map(([s, icon, col]) => (
            <button key={s} onClick={() => setSport(s)} style={{
              padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 800,
              background: sport === s ? col : "transparent",
              color: sport === s ? "#0d1117" : C.dim,
              transition: "all 0.15s",
            }}>{icon} {s}</button>
          ))}
          <button onClick={() => setSport("PARLAY")} style={{
            padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 10, fontWeight: 800,
            background: sport === "PARLAY" ? C.green : "transparent",
            color: sport === "PARLAY" ? "#0d1117" : C.dim,
            transition: "all 0.15s",
          }}>🎯 PARLAY</button>
        </div>

        <ModelHealth />

        {syncMsg && (
          <div style={{ fontSize: 9, color: C.dim, animation: "pulse 1.5s ease infinite", whiteSpace: "nowrap" }}>
            {syncMsg}
          </div>
        )}
        {calActive.length > 0 && (
          <div style={{
            fontSize: 9, color: C.yellow, background: "#1a1200",
            border: `1px solid #3a2a00`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
          }}>
            Cal: {calActive.join(" ")}
          </div>
        )}
      </div>

      {/* ── CONTENT ───────────────────────────────────────────── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {sport === "MLB" && (
          <MLBSection
            mlbGames={mlbGames} setMlbGames={setMlbGames}
            calibrationMLB={calibrationMLB} setCalibrationMLB={setCalibrationMLB}
            refreshKey={refreshKey} setRefreshKey={setRefreshKey}
          />
        )}
        {sport === "NCAA" && (
          <NCAASection
            ncaaGames={ncaaGames} setNcaaGames={setNcaaGames}
            calibrationNCAA={calibrationNCAA} setCalibrationNCAA={setCalibrationNCAA}
            refreshKey={refreshKey} setRefreshKey={setRefreshKey}
          />
        )}
        {sport === "NBA" && (
          <NBASection
            nbaGames={nbaGames} setNbaGames={setNbaGames}
            calibrationNBA={calibrationNBA} setCalibrationNBA={setCalibrationNBA}
            refreshKey={refreshKey} setRefreshKey={setRefreshKey}
          />
        )}
        {sport === "NFL" && (
          <NFLSection
            nflGames={nflGames} setNflGames={setNflGames}
            calibrationNFL={calibrationNFL} setCalibrationNFL={setCalibrationNFL}
            refreshKey={refreshKey} setRefreshKey={setRefreshKey}
          />
        )}
        {sport === "NCAAF" && (
          <NCAAFSection
            ncaafGames={ncaafGames} setNcaafGames={setNcaafGames}
            calibrationNCAAF={calibrationNCAAF} setCalibrationNCAAF={setCalibrationNCAAF}
            refreshKey={refreshKey} setRefreshKey={setRefreshKey}
          />
        )}
        {sport === "PARLAY" && (
          <div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 16, letterSpacing: 1 }}>
              Combined parlay builder — load games in each sport's calendar first
            </div>
            <ParlayBuilder
              mlbGames={mlbGames}
              ncaaGames={[...ncaaGames, ...nbaGames, ...nflGames, ...ncaafGames]}
            />
          </div>
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <div style={{
        textAlign: "center", padding: "16px",
        borderTop: `1px solid ${C.border}`,
        fontSize: 9, color: "#21262d", letterSpacing: 2,
      }}>
        MULTI-SPORT PREDICTOR v15 · MLB · NCAAB · NBA · NFL · NCAAF · ESPN API · {SEASON}
      </div>
    </div>
  );
}