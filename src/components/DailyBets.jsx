// src/components/DailyBets.jsx
// Daily betting card — parlay strategy + individual sport picks
// Reads from Supabase predictions tables for today's games

import React, { useState, useEffect, useMemo } from "react";
import { C, Pill } from "./Shared.jsx";
import { getBetSignals, DECISIVENESS_GATE } from "../utils/sharedUtils.js";
import { supabaseQuery } from "../utils/supabase.js";

// ── Strategy constants ──
const ML_CAP = -500;
const CONF_GATE = 0.65;
const MIN_LEGS = 3;
const MAX_LEGS = 5;

function getStrategyMode() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const day = now.getDate();

  // Jan 1-7: SKIP entirely
  if (month === 1 && day <= 7) return "skip";
  // Jan 8-31 or Feb: 3-leg only at $75
  if (month === 1 || month === 2) return "3only";
  // Nov, Dec, Mar: full 3+5 strategy
  return "full";
}

const STRATEGY_LABELS = {
  skip: { label: "🚫 NO BETS — Jan W1 (conference chaos)", color: "#f85149", sublabel: "Historical −23.6% ROI. Skip this week." },
  "3only": { label: "🛡 SAFE MODE — 3-Leg Only @ $75", color: "#d29922", sublabel: "Jan/Feb: 5-leg historically unprofitable. Consolidate to 3-leg." },
  full: { label: "🎯 FULL STRATEGY — $50 on 3-Leg + $25 on 5-Leg", color: "#2ea043", sublabel: "Nov/Dec/Mar: Both legs profitable. 44.6% ROI across 6 seasons." },
};

// ── Spread to ML conversion ──
function spreadToML(spread) {
  const s = Math.abs(spread);
  if (s < 0.5) return -110;
  const pairs = [[1,-120],[2,-140],[3,-160],[4,-185],[5,-210],[6,-245],[7,-280],[8,-320],[9,-370],[10,-420],[12,-550],[14,-700],[16,-900],[18,-1200],[20,-1500]];
  let ml = -2000;
  for (const [lim, f] of pairs) { if (s <= lim) { ml = f; break; } }
  return spread < 0 ? ml : -ml;
}

// ── Styles ──
const S = {
  page: { maxWidth: 800, margin: "0 auto", padding: "16px 12px", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" },
  header: { textAlign: "center", marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 900, letterSpacing: -1, color: "#e6edf3", margin: 0 },
  subtitle: { fontSize: 12, color: C.dim, marginTop: 4 },
  strategyCard: (color) => ({
    background: `linear-gradient(135deg, ${color}12, ${color}06)`,
    border: `1px solid ${color}55`,
    borderRadius: 12, padding: "16px 20px", marginBottom: 20,
  }),
  strategyLabel: (color) => ({ fontSize: 16, fontWeight: 800, color, marginBottom: 4 }),
  strategySub: { fontSize: 11, color: C.dim },
  parlayCard: {
    background: `linear-gradient(135deg, #0d1117, #161b22)`,
    border: `1px solid #30363d`,
    borderRadius: 10, padding: "14px 18px", marginBottom: 12,
  },
  parlayHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  parlayTitle: { fontSize: 14, fontWeight: 800, color: "#e6edf3" },
  parlayBadge: (color) => ({
    fontSize: 10, fontWeight: 800, color: "#fff", background: color,
    borderRadius: 5, padding: "3px 10px", letterSpacing: 1,
  }),
  legRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 0", borderBottom: `1px solid #21262d`,
  },
  legTeam: { fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1 },
  legMl: { fontSize: 12, color: C.muted, width: 60, textAlign: "right" },
  legConf: { fontSize: 11, width: 50, textAlign: "right" },
  sportSection: { marginTop: 28 },
  sportHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid #21262d` },
  sportIcon: { fontSize: 20 },
  sportName: { fontSize: 18, fontWeight: 900, color: "#e6edf3", letterSpacing: -0.5 },
  sportCount: { fontSize: 11, color: C.dim, marginLeft: "auto" },
  categoryLabel: { fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: 2, marginTop: 14, marginBottom: 6, textTransform: "uppercase" },
  pickRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
    background: "#0d1117", borderRadius: 8, marginBottom: 6,
    border: "1px solid #21262d",
  },
  pickTeam: { fontSize: 13, fontWeight: 700, color: "#e6edf3", flex: 1, minWidth: 0 },
  pickLine: { fontSize: 12, color: "#8b949e", width: 60, textAlign: "center" },
  pickEdge: { fontSize: 11, width: 55, textAlign: "right" },
  unitBadge: (units, color) => ({
    fontSize: 10, fontWeight: 900, color: "#fff",
    background: color, borderRadius: 4, padding: "2px 8px",
    minWidth: 30, textAlign: "center",
  }),
  noPicks: { fontSize: 12, color: C.dim, fontStyle: "italic", padding: "10px 0" },
  timestamp: { fontSize: 10, color: "#484f58", textAlign: "center", marginTop: 20 },
};

// ── Unit color helper ──
function unitColor(units) {
  if (units >= 5) return "#2ea043";
  if (units >= 4) return "#2ea043";
  if (units >= 3) return "#d29922";
  if (units >= 2) return "#d29922";
  return "#8b949e";
}

function confColor(conf) {
  if (conf >= 80) return "#2ea043";
  if (conf >= 70) return "#58a6ff";
  if (conf >= 60) return "#d29922";
  return "#8b949e";
}

// ── Main Component ──
export default function DailyBets({ ncaaGames = [], nbaGames = [], mlbGames = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const mode = getStrategyMode();
  const strategy = STRATEGY_LABELS[mode];

  // ── Build NCAA parlay picks ──
  const ncaaParlayPicks = useMemo(() => {
    if (mode === "skip") return [];

    const eligible = ncaaGames
      .filter(g => g.pred && g.odds)
      .map(g => {
        const signals = getBetSignals({ pred: g.pred, odds: g.odds, sport: "ncaa", homeName: g.homeTeam, awayName: g.awayTeam });
        const margin = g.pred?.projectedSpread || g.pred?.mlMargin || 0;
        const probHome = g.pred?.homeWinPct || 0.5;
        const conf = Math.max(probHome, 1 - probHome);
        const spread = g.odds?.homeSpread ?? 0;
        const impliedML = spreadToML(spread);
        const pickHome = margin < 0; // negative margin = home favored
        const pickML = pickHome ? impliedML : -impliedML;
        const pickTeam = pickHome ? (g.homeTeam || "Home") : (g.awayTeam || "Away");
        const pickSpread = pickHome ? spread : -spread;

        return {
          team: pickTeam,
          ml: pickML,
          conf: conf * 100,
          margin: Math.abs(margin),
          pickHome,
          spread: pickSpread,
          signals,
          gameId: g.gameId,
        };
      })
      .filter(p => p.conf >= CONF_GATE * 100 && p.ml > ML_CAP)
      .sort((a, b) => b.conf - a.conf);

    return eligible;
  }, [ncaaGames, mode]);

  const parlay3Picks = ncaaParlayPicks.slice(0, 3);
  const parlay5Picks = ncaaParlayPicks.slice(0, Math.min(5, ncaaParlayPicks.length));

  // ── Build ATS/OU picks for each sport ──
  function buildPicks(games, sport) {
    const atsPicks = [];
    const ouPicks = [];

    for (const g of games) {
      if (!g.pred || !g.odds) continue;
      const home = g.homeTeam || g.homeAbbr || "Home";
      const away = g.awayTeam || g.awayAbbr || "Away";
      const signals = getBetSignals({ pred: g.pred, odds: g.odds, sport, homeName: home, awayName: away });

      if (signals.betSizing) {
        const side = signals.betSizing.side;
        const team = side === "HOME" ? home : away;
        const spread = g.odds?.homeSpread;
        const displaySpread = spread != null
          ? (side === "HOME" ? spread : -spread)
          : null;

        atsPicks.push({
          team,
          spread: displaySpread,
          units: signals.betSizing.units,
          edge: parseFloat(signals.betSizing.disagree || 0),
          label: signals.betSizing.label,
          color: signals.betSizing.color,
          side,
        });
      }

      if (signals.ou && (signals.ou.verdict === "GO" || signals.ou.verdict === "LEAN") && signals.ou.units) {
        ouPicks.push({
          team: signals.ou.side === "OVER" ? `${home}/${away}` : `${home}/${away}`,
          side: signals.ou.side,
          edge: parseFloat(signals.ou.diff || signals.ou.edge || 0),
          units: signals.ou.units,
          modelTotal: signals.ou.modelTotal,
          marketLine: signals.ou.marketLine,
        });
      }
    }

    return { atsPicks, ouPicks };
  }

  const ncaaPicks = buildPicks(ncaaGames, "ncaa");
  const nbaPicks = buildPicks(nbaGames, "nba");
  const mlbPicks = buildPicks(mlbGames, "mlb");

  const sportData = [
    { name: "NCAA", icon: "🏀", color: C.orange, ...ncaaPicks },
    { name: "NBA", icon: "🏀", color: "#58a6ff", ...nbaPicks },
    { name: "MLB", icon: "⚾", color: C.blue, ...mlbPicks },
  ];

  const totalPicks = sportData.reduce((s, sp) => s + sp.atsPicks.length + sp.ouPicks.length, 0);

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <h1 style={S.title}>Daily Bets</h1>
        <div style={S.subtitle}>{today} · {totalPicks} active signals</div>
      </div>

      {/* ── NCAA PARLAY STRATEGY ── */}
      <div style={S.strategyCard(strategy.color)}>
        <div style={S.strategyLabel(strategy.color)}>{strategy.label}</div>
        <div style={S.strategySub}>{strategy.sublabel}</div>
      </div>

      {mode !== "skip" && ncaaParlayPicks.length >= MIN_LEGS && (
        <>
          {/* 3-Leg Parlay */}
          {parlay3Picks.length >= 3 && (
            <div style={S.parlayCard}>
              <div style={S.parlayHeader}>
                <span style={S.parlayTitle}>🏀 3-Leg Parlay</span>
                <span style={S.parlayBadge("#2ea043")}>
                  {mode === "3only" ? "$75" : "$50"}
                </span>
              </div>
              {parlay3Picks.map((p, i) => (
                <div key={i} style={{ ...S.legRow, borderBottom: i === parlay3Picks.length - 1 ? "none" : S.legRow.borderBottom }}>
                  <span style={S.legTeam}>{p.team} ML</span>
                  <span style={S.legMl}>{p.ml > 0 ? `+${p.ml}` : p.ml}</span>
                  <span style={{ ...S.legConf, color: confColor(p.conf) }}>{p.conf.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: C.dim }}>
                <span>Parlay odds: {parlay3Picks.reduce((acc, p) => acc * (p.ml > 0 ? p.ml/100+1 : 100/Math.abs(p.ml)+1), 1).toFixed(2)}x</span>
                <span>Potential: ${(mode === "3only" ? 75 : 50) * parlay3Picks.reduce((acc, p) => acc * (p.ml > 0 ? p.ml/100+1 : 100/Math.abs(p.ml)+1), 1).toFixed(0)}</span>
              </div>
            </div>
          )}

          {/* 5-Leg Parlay (only in full mode) */}
          {mode === "full" && parlay5Picks.length >= 5 && (
            <div style={S.parlayCard}>
              <div style={S.parlayHeader}>
                <span style={S.parlayTitle}>🏀 5-Leg Parlay</span>
                <span style={S.parlayBadge("#58a6ff")}>$25</span>
              </div>
              {parlay5Picks.map((p, i) => (
                <div key={i} style={{ ...S.legRow, borderBottom: i === parlay5Picks.length - 1 ? "none" : S.legRow.borderBottom }}>
                  <span style={S.legTeam}>{p.team} ML</span>
                  <span style={S.legMl}>{p.ml > 0 ? `+${p.ml}` : p.ml}</span>
                  <span style={{ ...S.legConf, color: confColor(p.conf) }}>{p.conf.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: C.dim }}>
                <span>Parlay odds: {parlay5Picks.reduce((acc, p) => acc * (p.ml > 0 ? p.ml/100+1 : 100/Math.abs(p.ml)+1), 1).toFixed(2)}x</span>
                <span>Potential: ${(25 * parlay5Picks.reduce((acc, p) => acc * (p.ml > 0 ? p.ml/100+1 : 100/Math.abs(p.ml)+1), 1)).toFixed(0)}</span>
              </div>
            </div>
          )}

          {ncaaParlayPicks.length < MIN_LEGS && (
            <div style={S.noPicks}>Not enough qualifying NCAA picks for parlays today ({ncaaParlayPicks.length} picks, need {MIN_LEGS})</div>
          )}
        </>
      )}

      {/* ── INDIVIDUAL SPORT PICKS ── */}
      {sportData.map(sport => {
        const hasPicks = sport.atsPicks.length > 0 || sport.ouPicks.length > 0;
        if (!hasPicks) return null;

        return (
          <div key={sport.name} style={S.sportSection}>
            <div style={S.sportHeader}>
              <span style={S.sportIcon}>{sport.icon}</span>
              <span style={S.sportName}>{sport.name}</span>
              <span style={S.sportCount}>
                {sport.atsPicks.length} ATS · {sport.ouPicks.length} O/U
              </span>
            </div>

            {/* ATS Picks */}
            {sport.atsPicks.length > 0 && (
              <>
                <div style={S.categoryLabel}>ATS / Spread</div>
                {sport.atsPicks
                  .sort((a, b) => b.units - a.units || b.edge - a.edge)
                  .map((pick, i) => (
                    <div key={i} style={S.pickRow}>
                      <span style={S.pickTeam}>{pick.team}</span>
                      <span style={S.pickLine}>
                        {pick.spread != null
                          ? (pick.spread > 0 ? `+${pick.spread.toFixed(1)}` : pick.spread.toFixed(1))
                          : "—"
                        }
                      </span>
                      <span style={S.pickEdge}>{pick.edge.toFixed(1)} pts</span>
                      <span style={S.unitBadge(pick.units, unitColor(pick.units))}>
                        {pick.units}u
                      </span>
                    </div>
                  ))}
              </>
            )}

            {/* O/U Picks */}
            {sport.ouPicks.length > 0 && (
              <>
                <div style={S.categoryLabel}>Over / Under</div>
                {sport.ouPicks
                  .sort((a, b) => b.units - a.units || b.edge - a.edge)
                  .map((pick, i) => (
                    <div key={i} style={S.pickRow}>
                      <span style={S.pickTeam}>
                        {pick.side === "OVER" ? "▲" : "▼"} {pick.side} {pick.team}
                      </span>
                      <span style={S.pickLine}>
                        {pick.modelTotal?.toFixed?.(1) ?? "—"}
                      </span>
                      <span style={S.pickEdge}>{pick.edge.toFixed(1)} pts</span>
                      <span style={S.unitBadge(pick.units, pick.side === "OVER" ? "#2ea043" : "#58a6ff")}>
                        {pick.units}u
                      </span>
                    </div>
                  ))}
              </>
            )}
          </div>
        );
      })}

      {totalPicks === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: C.dim }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14 }}>No signals yet today</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Sync games from each sport tab to generate picks</div>
        </div>
      )}

      <div style={S.timestamp}>
        Last updated: {new Date().toLocaleTimeString()} · Strategy: {mode} mode
      </div>
    </div>
  );
}
