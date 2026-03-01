// src/components/Shared.jsx
// Lines 2268–2651 of App.jsx (extracted)
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import { supabaseQuery } from "../utils/supabase.js";
import { decimalToML, combinedParlayOdds, combinedParlayProb, computeAccuracy, trueImplied } from "../utils/sharedUtils.js";

// ── CONSTANTS ─────────────────────────────────────────────────
export const NCAA_LIVE_CUTOFF = "2025-01-01"; // games on/after this date used real-time stats

// ── COLOUR PALETTE ────────────────────────────────────────────
export const C = {
  green: "#3fb950", yellow: "#e3b341", red: "#f85149", blue: "#58a6ff",
  orange: "#f97316", dim: "#484f58", muted: "#8b949e",
  border: "#21262d", bg: "#080c10", card: "#0d1117",
};

export const confColor2 = c => c === "HIGH" ? C.green : c === "MEDIUM" ? C.yellow : C.muted;

// ── PILL ──────────────────────────────────────────────────────
export function Pill({ label, value, color, highlight }) {
  return (
    <div style={{
      textAlign: "center", minWidth: 44, position: "relative",
      background: highlight ? "rgba(46,160,67,0.15)" : "transparent",
      border: highlight ? "1px solid #2ea04355" : "1px solid transparent",
      borderRadius: 6, padding: highlight ? "2px 6px" : "0",
    }}>
      {highlight && (
        <div style={{
          position: "absolute", top: -7, right: -4, fontSize: 8,
          background: "#2ea043", color: "#fff", borderRadius: 3,
          padding: "0 3px", fontWeight: 800, letterSpacing: 0.5, lineHeight: "14px",
        }}>BET</div>
      )}
      <div style={{ fontSize: 14, fontWeight: 800, color: highlight ? "#3fb950" : (color || "#e2e8f0") }}>{value}</div>
      <div style={{ fontSize: 8, color: "#484f58", letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

// ── KV ────────────────────────────────────────────────────────
export function Kv({ k, v }) {
  return (
    <div style={{ padding: "8px 10px", background: "#080c10", borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 1.5, marginBottom: 2, textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{v ?? "—"}</div>
    </div>
  );
}

// ── ACCURACY DASHBOARD ────────────────────────────────────────
export function AccuracyDashboard({ table, refreshKey, onCalibrationChange, spreadLabel = "Run Line", isNCAA = false }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [gameTypeFilter, setGameTypeFilter] = useState(table === "mlb_predictions" ? "R" : "ALL");
  const [forwardOnly, setForwardOnly] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const typeFilter = (table === "mlb_predictions" && gameTypeFilter !== "ALL") ? `&game_type=eq.${gameTypeFilter}` : "";
      const data = await supabaseQuery(`/${table}?result_entered=eq.true${typeFilter}&order=game_date.asc&limit=2000`);
      setRecords(data || []);
      setLoading(false);
    })();
  }, [refreshKey, gameTypeFilter, table]);

  const filteredRecords = useMemo(() => {
    if (!isNCAA || !forwardOnly) return records;
    return records.filter(r => r.game_date >= NCAA_LIVE_CUTOFF);
  }, [records, forwardOnly, isNCAA]);

  const acc = useMemo(() => filteredRecords.length ? computeAccuracy(filteredRecords) : null, [filteredRecords]);
  const calib = acc?.calibration;

  if (loading) return <div style={{ color: C.dim, textAlign: "center", marginTop: 60, fontSize: 13 }}>Loading…</div>;
  if (!acc) return (
    <div style={{ color: C.dim, textAlign: "center", marginTop: 60 }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>📊</div>
      {table === "mlb_predictions" && gameTypeFilter === "R"
        ? <div>
            <div style={{ marginBottom: 8 }}>No regular season games graded yet.</div>
            <div style={{ fontSize: 11, color: "#3a3a3a", marginBottom: 16 }}>Regular season starts ~March 27.</div>
            <button onClick={() => setGameTypeFilter("S")} style={{ background: C.card, color: C.yellow, border: `1px solid #3a2a00`, borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🌸 View Spring Training Stats</button>
          </div>
        : <div>No graded predictions yet. Results auto-record as games finish.</div>}
    </div>
  );

  const cumData = []; let correct = 0, total = 0;
  filteredRecords.filter(r => r.ml_correct !== null).forEach(r => {
    total++; if (r.ml_correct) correct++;
    cumData.push({ game: total, pct: parseFloat((correct / total * 100).toFixed(1)) });
  });
  const roiData = []; let cumRoi = 0;
  filteredRecords.filter(r => r.ml_correct !== null).forEach((r, i) => {
    cumRoi += r.ml_correct ? 90.9 : -100;
    roiData.push({ game: i + 1, roi: parseFloat(cumRoi.toFixed(0)) });
  });

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>📊 Accuracy Dashboard</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {table === "mlb_predictions" && (
            <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
              {[["R", "⚾ Regular"], ["S", "🌸 Spring"], ["ALL", "All"]].map(([v, l]) => (
                <button key={v} onClick={() => setGameTypeFilter(v)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: gameTypeFilter === v ? C.blue : "transparent", color: gameTypeFilter === v ? C.bg : C.dim }}>{l}</button>
              ))}
            </div>
          )}
          {isNCAA && (
            <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
              <button onClick={() => setForwardOnly(false)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: !forwardOnly ? C.orange : "transparent", color: !forwardOnly ? C.bg : C.dim }}>All Games</button>
              <button onClick={() => setForwardOnly(true)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: forwardOnly ? C.green : "transparent", color: forwardOnly ? C.bg : C.dim }}>✓ Live Only</button>
            </div>
          )}
          {["overview", "calibration", "monthly"].map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${activeSection === s ? "#30363d" : "transparent"}`, background: activeSection === s ? "#161b22" : "transparent", color: activeSection === s ? C.blue : C.dim, cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{s}</button>
          ))}
        </div>
      </div>

      {table === "mlb_predictions" && gameTypeFilter === "S" && (
        <div style={{ background: "#1a1200", border: "1px solid #3a2a00", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.yellow }}>
          ⚠️ Spring Training: lower accuracy expected — rosters experimental, home advantage disabled.
        </div>
      )}
      {isNCAA && !forwardOnly && (
        <div style={{ background: "#1a0f00", border: "1px solid #5a3a00", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: C.orange, lineHeight: 1.6 }}>
          ⚠️ <strong>Backtested data warning:</strong> Historical games (before {NCAA_LIVE_CUTOFF}) were predicted using end-of-season ESPN stats retroactively applied — not the stats available on game day. This inflates ML accuracy significantly. Switch to <strong>✓ Live Only</strong> for real-world accuracy once enough live games accumulate.
        </div>
      )}
      {isNCAA && forwardOnly && filteredRecords.length < 20 && (
        <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: C.green }}>
          ✓ Showing live predictions only (on/after {NCAA_LIVE_CUTOFF}). {filteredRecords.length} games graded so far — accuracy will stabilize after ~50 games.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "ML ACCURACY", value: `${acc.mlAcc}%`, sub: `${acc.mlTotal} picks`, color: parseFloat(acc.mlAcc) >= 55 ? C.green : parseFloat(acc.mlAcc) >= 52 ? C.yellow : C.red },
          { label: spreadLabel.toUpperCase(), value: acc.rlAcc ? `${acc.rlAcc}%` : "—", sub: acc.rlGames > 0 ? (acc.hasMarketSpreads ? `${acc.rlGames}g vs market` : `${acc.rlGames}g *model line`) : null, color: acc.hasMarketSpreads ? (parseFloat(acc.rlAcc) >= 52 ? C.green : C.red) : C.yellow },
          { label: "OVER/UNDER", value: acc.ouAcc ? `${acc.ouAcc}%` : "—", color: parseFloat(acc.ouAcc) >= 50 ? C.green : C.red },
          { label: "NET ROI", value: `$${acc.roi}`, sub: `${acc.roiPct}% on stake`, color: parseFloat(acc.roi) >= 0 ? C.green : C.red },
          calib ? { label: "BRIER SCORE", value: calib.brierScore, sub: `${(calib.brierSkill * 100).toFixed(1)}% vs coin flip`, color: calib.brierScore < 0.22 ? C.green : calib.brierScore < 0.24 ? C.yellow : C.red } : null,
        ].filter(Boolean).map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 100, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
            {s.sub && <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {activeSection === "overview" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>STREAKS</div>
              <div style={{ display: "flex", gap: 16 }}>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>{acc.longestWin}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST W</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: C.red }}>{acc.longestLoss}</div><div style={{ fontSize: 9, color: C.dim }}>LONGEST L</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 800, color: acc.currentStreak > 0 ? C.green : C.red }}>{acc.currentStreak > 0 ? `W${acc.currentStreak}` : `L${Math.abs(acc.currentStreak)}`}</div><div style={{ fontSize: 9, color: C.dim }}>CURRENT</div></div>
              </div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 10 }}>BY CONFIDENCE</div>
              <div style={{ display: "flex", gap: 14 }}>
                {["HIGH", "MEDIUM", "LOW"].map(tier => {
                  const t = acc.tiers[tier];
                  const p = t.total ? Math.round(t.correct / t.total * 100) : null;
                  return (
                    <div key={tier} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: p ? (p >= 60 ? C.green : p >= 52 ? C.yellow : C.red) : C.dim }}>{p ? `${p}%` : "—"}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>{tier}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>{t.total}g</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {cumData.length > 2 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>ML ACCURACY OVER TIME</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={cumData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
                  <XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} />
                  <YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} />
                  <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" />
                  <ReferenceLine y={50} stroke={C.dim} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="pct" stroke={C.blue} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {roiData.length > 2 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px" }}>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>CUMULATIVE ROI ($100/bet, -110)</div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={roiData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
                  <XAxis dataKey="game" tick={{ fill: C.dim, fontSize: 10 }} />
                  <YAxis tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} />
                  <ReferenceLine y={0} stroke={C.dim} />
                  <Line type="monotone" dataKey="roi" stroke={parseFloat(acc.roi) >= 0 ? C.green : C.red} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {activeSection === "calibration" && calib && (
        <div style={{ background: "#0a0f14", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>CALIBRATION ANALYSIS</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <Kv k="Brier Score" v={calib.brierScore} />
            <Kv k="Skill vs Coin" v={`${(calib.brierSkill * 100).toFixed(1)}%`} />
            <Kv k="Mean Cal. Error" v={`${calib.meanCalibrationError}%`} />
            <Kv k="Overall Bias" v={`${calib.overallBias > 0 ? "+" : ""}${calib.overallBias}%`} />
            <Kv k="Sample Size" v={`${calib.n} games`} />
          </div>
          {onCalibrationChange && (() => {
            let curFactor = 1.0;
            try { curFactor = parseFloat(localStorage.getItem(table === "mlb_predictions" ? "cal_mlb" : "cal_ncaa")) || 1.0; } catch {}
            return curFactor !== 1.0 ? (
              <div style={{ background: "#0d1a10", border: "1px solid #1a4a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: C.green }}>✅ Calibration factor ×{curFactor} is active — win probabilities on Calendar tab are adjusted</div>
                <button onClick={() => onCalibrationChange?.(1.0)} style={{ background: "#21262d", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 10 }}>Reset</button>
              </div>
            ) : null;
          })()}
          {calib.suggestedFactor !== 1.0 && (
            <div style={{ background: "#1a1400", border: "1px solid #3a2a00", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.yellow, marginBottom: 6 }}>
                💡 Model is {calib.overallBias < 0 ? "over-confident" : "under-confident"} by ~{Math.abs(calib.overallBias).toFixed(1)}%. Suggested factor: ×{calib.suggestedFactor}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onCalibrationChange?.(calib.suggestedFactor)} style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Apply ×{calib.suggestedFactor}</button>
                <button onClick={() => onCalibrationChange?.(1.0)} style={{ background: "#21262d", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>Reset to 1.0</button>
              </div>
            </div>
          )}
          {calib.curve.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead><tr style={{ color: C.dim }}>{["BIN", "N", "PRED", "ACTUAL", "ERROR", "VERDICT"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {calib.curve.map((b, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid #0d1117` }}>
                      <td style={{ padding: "5px 8px", color: C.muted }}>{b.label}</td>
                      <td style={{ padding: "5px 8px", color: C.dim }}>{b.n}</td>
                      <td style={{ padding: "5px 8px", color: C.blue }}>{b.expected}%</td>
                      <td style={{ padding: "5px 8px", color: C.green }}>{b.actual}%</td>
                      <td style={{ padding: "5px 8px", color: Math.abs(b.error) < 3 ? C.green : Math.abs(b.error) < 6 ? C.yellow : C.red }}>{b.error > 0 ? "+" : ""}{b.error}%</td>
                      <td style={{ padding: "5px 8px", fontSize: 9, color: Math.abs(b.error) < 3 ? C.green : Math.abs(b.error) < 6 ? C.yellow : C.red }}>{Math.abs(b.error) < 3 ? "✓ Good" : Math.abs(b.error) < 6 ? "⚠ Minor bias" : "✗ Needs correction"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeSection === "monthly" && acc.byMonth?.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px" }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginBottom: 12 }}>MONTHLY ML ACCURACY</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={acc.byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#161b22" />
              <XAxis dataKey="month" tick={{ fill: C.dim, fontSize: 10 }} />
              <YAxis domain={[40, 70]} tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: "#161b22", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} />
              <ReferenceLine y={55} stroke={C.green} strokeDasharray="4 4" />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                {acc.byMonth.map((e, i) => <Cell key={i} fill={e.pct >= 55 ? C.green : e.pct >= 50 ? C.yellow : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── HISTORY TAB ───────────────────────────────────────────────
export function HistoryTab({ table, refreshKey }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [gameTypeFilter, setGameTypeFilter] = useState("ALL");
  const isMLB = table === "mlb_predictions";

  const load = useCallback(async () => {
    setLoading(true);
    let path = `/${table}?order=game_date.desc&limit=200`;
    if (filterDate) path += `&game_date=eq.${filterDate}`;
    if (isMLB && gameTypeFilter !== "ALL") path += `&game_type=eq.${gameTypeFilter}`;
    const data = await supabaseQuery(path);
    setRecords(data || []);
    setLoading(false);
  }, [filterDate, gameTypeFilter, table]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete?")) return;
    await supabaseQuery(`/${table}?id=eq.${id}`, "DELETE");
    load();
  };

  const grouped = records.reduce((acc, r) => {
    if (!acc[r.game_date]) acc[r.game_date] = [];
    acc[r.game_date].push(r);
    return acc;
  }, {});

  const confColor = c => c === "HIGH" ? C.green : c === "MEDIUM" ? C.yellow : C.muted;
  const mlSign = ml => ml > 0 ? `+${ml}` : ml;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>📋 History</h2>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }} />
        {filterDate && <button onClick={() => setFilterDate("")} style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Clear</button>}
        <button onClick={load} style={{ background: C.card, color: C.blue, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>↻</button>
        {isMLB && (
          <div style={{ display: "flex", gap: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 2 }}>
            {[["ALL", "All"], ["R", "⚾ RS"], ["S", "🌸 ST"]].map(([v, l]) => (
              <button key={v} onClick={() => setGameTypeFilter(v)} style={{ padding: "3px 9px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: gameTypeFilter === v ? C.blue : "transparent", color: gameTypeFilter === v ? C.bg : C.dim }}>{l}</button>
            ))}
          </div>
        )}
        {/* Sync / Refresh / Regrade buttons injected by parent via props if needed */}
      </div>
      {loading && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>Loading…</div>}
      {!loading && records.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No predictions yet</div>}
      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, marginBottom: 6, borderBottom: `1px solid #161b22`, paddingBottom: 5, letterSpacing: 2 }}>📅 {date}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: C.dim, fontSize: 9 }}>
                  {["MATCHUP", "MODEL ML", "O/U", "WIN %", "CONF", "RESULT", "ML✓", "ATS✓", "O/U✓", ""].map(h => (
                    <th key={h} style={{ padding: "5px 8px", textAlign: "left", borderBottom: `1px solid #161b22`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recs.map(r => {
                  const bg = r.result_entered ? (r.ml_correct ? "rgba(63,185,80,0.06)" : "rgba(248,81,73,0.06)") : "transparent";
                  const homeScore = isMLB ? r.actual_home_runs : r.actual_home_score;
                  const awayScore = isMLB ? r.actual_away_runs : r.actual_away_score;
                  const homeName = isMLB ? r.home_team : (r.home_team_name || r.home_team);
                  const awayName = isMLB ? r.away_team : (r.away_team_name || r.away_team);
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid #0d1117`, background: bg }}>
                      <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{awayName} @ {homeName} {r.game_type === "S" && <span style={{ fontSize: 8, color: C.yellow, marginLeft: 4 }}>ST</span>}</td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}><span style={{ color: C.blue }}>H:{mlSign(r.model_ml_home)}</span><span style={{ color: C.dim, margin: "0 3px" }}>|</span><span style={{ color: C.dim }}>A:{mlSign(r.model_ml_away)}</span></td>
                      <td style={{ padding: "7px 8px", color: C.yellow }}>{r.ou_total}</td>
                      <td style={{ padding: "7px 8px", color: C.blue }}>{r.win_pct_home != null ? `${Math.round(r.win_pct_home * 100)}%` : "—"}</td>
                      <td style={{ padding: "7px 8px" }}><span style={{ color: confColor(r.confidence), fontWeight: 700, fontSize: 10 }}>{r.confidence}</span></td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{r.result_entered ? <span style={{ color: C.green }}>{awayName} {awayScore} — {homeName} {homeScore}</span> : <span style={{ color: "#4a3a00", fontSize: 10 }}>⏳ Pending</span>}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.ml_correct ? "✅" : "❌") : "—"}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? (r.rl_correct === null ? "🔲" : r.rl_correct ? "✅" : "❌") : "—"}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>{r.result_entered ? <span style={{ color: r.ou_correct === "PUSH" ? C.yellow : "#e2e8f0", fontSize: 10 }}>{r.ou_correct}</span> : "—"}</td>
                      <td style={{ padding: "7px 8px" }}><button onClick={() => deleteRecord(r.id)} style={{ background: "transparent", border: "none", color: C.dim, cursor: "pointer", fontSize: 12 }}>🗑</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── PARLAY BUILDER ────────────────────────────────────────────
export function ParlayBuilder({ mlbGames = [], ncaaGames = [] }) {
  const [sportFilter, setSportFilter] = useState("ALL");
  const [legCount, setLegCount] = useState(3);
  const [mode, setMode] = useState("auto");
  const [customLegs, setCustomLegs] = useState([]);
  const [wager, setWager] = useState(100);

  const allGameLegs = useMemo(() => {
    const mlbLegs = mlbGames.filter(g => g.pred).map(g => {
      const pickHome = g.pred.homeWinPct >= 0.5;
      const ml = pickHome ? (g.odds?.homeML || g.pred.modelML_home) : (g.odds?.awayML || g.pred.modelML_away);
      const home = g.homeTeam || { abbr: "HOME" };
      const away = g.awayTeam || { abbr: "AWAY" };
      return { sport: "MLB", gamePk: g.gamePk || g.gameId, label: `${away.abbr} @ ${home.abbr}`, pick: pickHome ? home.abbr : away.abbr, prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct, ml, confidence: g.pred.confidence, confScore: g.pred.confScore, hasOdds: !!g.odds?.homeML };
    });
    const ncaaLegs = ncaaGames.filter(g => g.pred).map(g => {
      const pickHome = g.pred.homeWinPct >= 0.5;
      const ml = pickHome ? (g.odds?.homeML || g.pred.modelML_home) : (g.odds?.awayML || g.pred.modelML_away);
      const hName = (g.homeAbbr || g.homeTeamName || "HOME").slice(0, 8);
      const aName = (g.awayAbbr || g.awayTeamName || "AWAY").slice(0, 8);
      return { sport: "NCAA", gamePk: g.gameId, label: `${aName} @ ${hName}`, pick: pickHome ? hName : aName, prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct, ml, confidence: g.pred.confidence, confScore: g.pred.confScore, hasOdds: !!g.odds?.homeML };
    });
    return [...mlbLegs, ...ncaaLegs].sort((a, b) => b.prob - a.prob);
  }, [mlbGames, ncaaGames]);

  const filteredLegs = useMemo(() => {
    if (sportFilter === "MLB") return allGameLegs.filter(l => l.sport === "MLB");
    if (sportFilter === "NCAA") return allGameLegs.filter(l => l.sport === "NCAA");
    return allGameLegs;
  }, [allGameLegs, sportFilter]);

  const autoParlay = useMemo(() => filteredLegs.slice(0, legCount), [filteredLegs, legCount]);
  const active = mode === "auto" ? autoParlay : customLegs;
  const combinedProb = active.length ? combinedParlayProb(active) : 0;
  const decOdds = active.length ? combinedParlayOdds(active) : 1;
  const ev = active.length ? ((combinedProb * (decOdds - 1) * wager) - ((1 - combinedProb) * wager)).toFixed(2) : null;

  const toggleCustomLeg = (leg) => {
    const exists = customLegs.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
    if (exists) setCustomLegs(customLegs.filter(l => !(l.gamePk === leg.gamePk && l.sport === leg.sport)));
    else setCustomLegs([...customLegs, leg]);
  };

  const sportColor = s => s === "MLB" ? C.blue : C.orange;
  const sportBadge = s => (
    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: s === "MLB" ? "#0d1a2e" : "#2a1a0a", color: sportColor(s), marginLeft: 4 }}>
      {s === "MLB" ? "⚾" : "🏀"}
    </span>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, color: C.blue, letterSpacing: 2, textTransform: "uppercase" }}>🎯 Parlay Builder</h2>
        <div style={{ display: "flex", gap: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3 }}>
          {[["ALL", "⚾+🏀"], ["MLB", "⚾"], ["NCAA", "🏀"]].map(([v, l]) => (
            <button key={v} onClick={() => setSportFilter(v)} style={{ padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, background: sportFilter === v ? C.blue : "transparent", color: sportFilter === v ? C.bg : C.dim }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {[2, 3, 4, 5, 6, 7, 8].map(n => (
            <button key={n} onClick={() => { setLegCount(n); setMode("auto"); }} style={{ width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, background: mode === "auto" && legCount === n ? C.blue : "#161b22", color: mode === "auto" && legCount === n ? C.bg : C.dim }}>{n}</button>
          ))}
        </div>
        <button onClick={() => setMode(m => m === "auto" ? "custom" : "auto")} style={{ background: mode === "custom" ? C.blue : "#161b22", color: mode === "custom" ? C.bg : "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>
          {mode === "custom" ? "✏️ Custom" : "⚡ Auto"}
        </button>
      </div>

      {active.length > 0 && (
        <div style={{ background: "linear-gradient(135deg,#0d1a2e,#0a1520)", border: "1px solid #1e3448", borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.blue, marginBottom: 10, letterSpacing: 2 }}>{active.length}-LEG PARLAY</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <Pill label="COMBINED PROB" value={`${(combinedProb * 100).toFixed(1)}%`} color={combinedProb > 0.15 ? C.green : C.red} />
            <Pill label="FAIR ODDS" value={decimalToML(decOdds)} color={C.yellow} />
            <Pill label={`PAYOUT $${wager}`} value={`$${(wager * decOdds).toFixed(0)}`} color={C.green} />
            {ev && <Pill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev) >= 0 ? C.green : C.red} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: C.dim }}>Wager: $</span>
            <input type="number" value={wager} onChange={e => setWager(Number(e.target.value))} style={{ width: 70, background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 7px", fontSize: 11, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {active.map((leg, i) => (
              <div key={`${leg.sport}-${leg.gamePk}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "7px 10px" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: sportColor(leg.sport), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: C.bg }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{leg.label}{sportBadge(leg.sport)}</div>
                  <div style={{ fontSize: 10, color: C.dim }}>Pick: <span style={{ color: C.green }}>{leg.pick}</span></div>
                </div>
                <Pill label="PROB" value={`${(leg.prob * 100).toFixed(1)}%`} />
                <Pill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
                {mode === "custom" && <button onClick={() => toggleCustomLeg(leg)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer" }}>✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredLegs.length === 0 && (
        <div style={{ color: C.dim, textAlign: "center", marginTop: 40, fontSize: 12 }}>No games loaded — visit Calendar tab first to load today's games</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredLegs.map((leg, i) => {
          const isAutoSel = mode === "auto" && autoParlay.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
          const isCustomSel = customLegs.find(l => l.gamePk === leg.gamePk && l.sport === leg.sport);
          return (
            <div key={`${leg.sport}-${leg.gamePk}`} style={{ background: isAutoSel ? "#0e2015" : C.card, border: `1px solid ${isAutoSel ? "#2ea043" : C.border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: 22, fontSize: 10, color: C.dim }}>{isAutoSel ? "✅" : `#${i + 1}`}</div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{leg.label}{sportBadge(leg.sport)}</div>
                <div style={{ fontSize: 10, color: C.dim }}>Pick: {leg.pick} — {(leg.prob * 100).toFixed(1)}%</div>
              </div>
              <Pill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
              <Pill label="CONF" value={leg.confidence} color={confColor2(leg.confidence)} />
              {mode === "custom" && (
                <button onClick={() => toggleCustomLeg(leg)} style={{ background: isCustomSel ? "#2ea043" : "#161b22", color: isCustomSel ? "#fff" : C.dim, border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>
                  {isCustomSel ? "✓ Added" : "+ Add"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ── BET SIGNALS PANEL ─────────────────────────────────────────
// Displays GO/LEAN/SKIP verdicts for ML, O/U, spread, confidence
// Used by NCAACalendarTab, MLBCalendarTab, NFLCalendarTab, NCAAFCalendarTab
export function BetSignalsPanel({ signals, pred, odds, sport, homeName, awayName }) {
  if (!signals) return null;

  const verdictStyle = v => ({
    GO:        { bg: "#0d2818", border: "#2ea043", color: C.green,  icon: "🟢" },
    LEAN:      { bg: "#1a1200", border: "#d29922", color: C.yellow, icon: "🟡" },
    SKIP:      { bg: "#111",    border: C.border,  color: C.dim,    icon: "⚪" },
    "NO LINE": { bg: "#111",    border: C.border,  color: C.dim,    icon: "—"  },
  }[v] || { bg: "#111", border: C.border, color: C.dim, icon: "?" });

  const Row = ({ label, signal }) => {
    if (!signal) return null;
    const s = verdictStyle(signal.verdict);
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 7, marginBottom: 6 }}>
        <div style={{ fontSize: 14, lineHeight: 1 }}>{s.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: s.color, letterSpacing: 1 }}>{signal.verdict}</span>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{signal.reason}</div>
          {signal.side && signal.verdict !== "SKIP" && (
            <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginTop: 3 }}>
              → Bet: {signal.side}{signal.ml ? ` (${signal.ml})` : ""}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 8 }}>BET SIGNALS</div>
      <Row label={`${sport === "mlb" ? "⚾" : sport === "nfl" || sport === "ncaaf" ? "🏈" : "🏀"} MONEYLINE`} signal={signals.ml} />
      <Row label="📊 OVER/UNDER"      signal={signals.ou} />
      {signals.spread && <Row label={`📏 ${sport === "mlb" ? "RUN LINE" : "SPREAD"}`} signal={signals.spread} />}
      <Row label="🎯 CONFIDENCE"      signal={signals.conf} />

      {/* Edge Analysis */}
      {odds?.homeML && odds?.awayML && (() => {
        const market = trueImplied(odds.homeML, odds.awayML);
        const homeWin = pred.homeWinPct;
        const awayWin = 1 - homeWin;
        const hEdge = ((homeWin - market.home) * 100).toFixed(1);
        const aEdge = ((awayWin - market.away) * 100).toFixed(1);
        return (
          <div style={{ padding: "10px 12px", background: "#0a0f14", borderRadius: 6, marginTop: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>EDGE ANALYSIS</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <span style={{ color: parseFloat(hEdge) >= 3.5 ? C.green : parseFloat(hEdge) < 0 ? C.red : C.muted, fontWeight: 700 }}>
                  {parseFloat(hEdge) > 0 ? "+" : ""}{hEdge}%
                </span>{" "}
                <span style={{ fontSize: 10, color: C.dim }}>{homeName}</span>
              </div>
              <div>
                <span style={{ color: parseFloat(aEdge) >= 3.5 ? C.green : parseFloat(aEdge) < 0 ? C.red : C.muted, fontWeight: 700 }}>
                  {parseFloat(aEdge) > 0 ? "+" : ""}{aEdge}%
                </span>{" "}
                <span style={{ fontSize: 10, color: C.dim }}>{awayName}</span>
              </div>
              <div style={{ fontSize: 10, color: C.dim }}>
                Mkt: {(market.home * 100).toFixed(1)}% / {(market.away * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              <strong style={{ color: C.blue }}>What is Edge Analysis?</strong><br />
              The market sets a price (e.g. {homeName} -145) that implies a {(market.home * 100).toFixed(1)}% win
              probability after removing the sportsbook's vig (built-in profit margin). Our model independently
              calculates win probability using efficiency stats, tempo, and scoring trends.{" "}
              <strong>Edge</strong> is the gap between these two numbers — if the model gives {homeName}{" "}
              {(homeWin * 100).toFixed(1)}% but the market only prices them at {(market.home * 100).toFixed(1)}%,
              that is a <strong>{Math.abs(parseFloat(hEdge)).toFixed(1)}% edge</strong> on the {homeName} moneyline.
              A consistent edge of 3.5%+ is statistically exploitable over a large sample. Below 3.5% the edge is
              within the noise of normal variance.
            </div>
          </div>
        );
      })()}
    </div>
  );
}