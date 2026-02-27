// src/sports/mlb/MLBCalendarTab.jsx
// Lines 2722–3054 of App.jsx (extracted)
import React, { useState, useEffect, useCallback } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import {
  mlbTeamById, resolveStatTeamId,
  fetchMLBScheduleForDate, matchMLBOddsToGame,
  fetchTeamHitting, fetchTeamPitching, fetchStarterStats,
  fetchRecentForm, fetchLineup, fetchBullpenFatigue,
  mlbPredictGame,
} from "./mlb.js";
import { mlbAutoSync } from "./mlbSync.js";

export default function MLBCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchMLBScheduleForDate(d), fetchOdds("baseball_mlb")]);
    setOddsData(odds);
    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));
    const enriched = await Promise.all(raw.map(async (g) => {
      const homeStatId = resolveStatTeamId(g.homeTeamId, g.homeAbbr);
      const awayStatId = resolveStatTeamId(g.awayTeamId, g.awayAbbr);
      const [
        homeHit, awayHit, homePitch, awayPitch,
        homeStarter, awayStarter,
        homeForm, awayForm,
        homeLineup, awayLineup,
      ] = await Promise.all([
        fetchTeamHitting(homeStatId), fetchTeamHitting(awayStatId),
        fetchTeamPitching(homeStatId), fetchTeamPitching(awayStatId),
        fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
        fetchRecentForm(homeStatId), fetchRecentForm(awayStatId),
        fetchLineup(g.gamePk, homeStatId, true), fetchLineup(g.gamePk, awayStatId, false),
      ]);
      if (homeStarter) homeStarter.pitchHand = g.homeStarterHand;
      if (awayStarter) awayStarter.pitchHand = g.awayStarterHand;
      const [homeBullpen, awayBullpen] = await Promise.all([
        fetchBullpenFatigue(g.homeTeamId), fetchBullpenFatigue(g.awayTeamId),
      ]);
      const pred = mlbPredictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm,
        homeGamesPlayed: homeForm?.gamesPlayed || 0,
        awayGamesPlayed: awayForm?.gamesPlayed || 0,
        bullpenData: { [g.homeTeamId]: homeBullpen, [g.awayTeamId]: awayBullpen },
        homeLineup, awayLineup,
        umpire: g.umpire,
        calibrationFactor,
      });
      const gameOdds = odds?.games?.find(o => matchMLBOddsToGame(o, g)) || null;
      const [mlResult, mcResult] = await Promise.all([
        mlPredict("mlb", {
          pred_home_runs: pred.homeRuns, pred_away_runs: pred.awayRuns,
          win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
          model_ml_home: pred.modelML_home,
          home_woba: pred.homeWOBA, away_woba: pred.awayWOBA,
          home_fip: pred.hFIP, away_fip: pred.aFIP,
          park_factor: pred.parkFactor,
        }),
        mlMonteCarlo("MLB", pred.homeRuns, pred.awayRuns, 10000, gameOdds?.ouLine ?? pred.ouTotal),
      ]);
      const finalPred = pred && mlResult ? {
        ...pred,
        homeWinPct: mlResult.ml_win_prob_home,
        awayWinPct: mlResult.ml_win_prob_away,
        mlEnhanced: true,
      } : pred;
      return { ...g, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds, hasStarter) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    if (!hasStarter) return { color: "yellow", label: "⚠ Starters TBD" };
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: homeEdge >= EDGE_THRESHOLD ? `+${(homeEdge * 100).toFixed(1)}% HOME edge` : `+${((-homeEdge) * 100).toFixed(1)}% AWAY edge` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (pred.homeWinPct >= 0.60 || pred.homeWinPct <= 0.40) return { color: "green", label: "Strong signal" };
    return { color: "neutral", label: "Close matchup" };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => loadGames(dateStr)} style={{ background: "#161b22", color: C.blue, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↻ REFRESH</button>
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading && oddsData?.noKey && <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading predictions…</span>}
      </div>
      {!loading && games.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No games scheduled for {dateStr}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const home = mlbTeamById(game.homeTeamId), away = mlbTeamById(game.awayTeamId);
          const bannerInfo = game.loading ? { color: "yellow", label: "Calculating…" } : getBannerInfo(game.pred, game.odds, game.homeStarter && game.awayStarter);
          const color = bannerInfo.color;
          const isOpen = expanded === game.gamePk;
          const bannerBg = color === "green" ? "linear-gradient(135deg,#0b2012,#0e2315)" : color === "yellow" ? "linear-gradient(135deg,#1a1200,#1a1500)" : `linear-gradient(135deg,${C.card},#111822)`;
          const borderColor = color === "green" ? "#2ea043" : color === "yellow" ? "#4a3a00" : C.border;
          return (
            <div key={game.gamePk} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gamePk)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 160 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{away.abbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                    {game.awayStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.awayStarter.split(" ").pop()}{game.awayStarterHand ? ` (${game.awayStarterHand})` : ""}</div>}
                  </div>
                  <div style={{ fontSize: 14, color: C.dim }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{home.abbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                    {game.homeStarter && <div style={{ fontSize: 10, color: C.muted }}>{game.homeStarter.split(" ").pop()}{game.homeStarterHand ? ` (${game.homeStarterHand})` : ""}</div>}
                  </div>
                </div>
                {game.loading ? <div style={{ color: C.dim, fontSize: 11 }}>Calculating…</div>
                  : game.pred ? (() => {
                    const sigs = getBetSignals({ pred: game.pred, odds: game.odds, sport: "mlb" });
                    return (
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <Pill label="PROJ" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                        <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs.ml?.verdict === "GO" || sigs.ml?.verdict === "LEAN"} />
                        {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                        <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs.ou?.verdict === "GO" || sigs.ou?.verdict === "LEAN"} />
                        <Pill label="WIN%" value={`${Math.round(game.pred.homeWinPct * 100)}%`} color={game.pred.homeWinPct >= 0.55 ? C.green : "#e2e8f0"} />
                        <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={sigs.conf?.verdict === "GO"} />
                      </div>
                    );
                  })() : <div style={{ color: C.dim, fontSize: 11 }}>⚠ Data unavailable</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE {game.inningHalf} {game.inning}</span>}
                  {game.umpire?.name && <span style={{ fontSize: 9, color: C.dim }}>⚖ {game.umpire.name.split(" ").pop()}</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={`${game.pred.ouTotal}`} />
                    <Kv k="Model ML (H)" v={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    {game.odds?.homeML && <Kv k="Market ML (H)" v={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} />}
                    <Kv k="Home FIP" v={game.pred.hFIP?.toFixed(2)} />
                    <Kv k="Away FIP" v={game.pred.aFIP?.toFixed(2)} />
                    <Kv k="Home wOBA" v={game.pred.homeWOBA?.toFixed(3)} />
                    <Kv k="Away wOBA" v={game.pred.awayWOBA?.toFixed(3)} />
                    {game.umpire?.name && <Kv k="Umpire" v={`${game.umpire.name} (${game.umpire.size})`} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>
                  <BetSignalsPanel
                    signals={getBetSignals({ pred: game.pred, odds: game.odds, sport: "mlb" })}
                    pred={game.pred} odds={game.odds} sport="mlb"
                    homeName={home.abbr} awayName={away.abbr}
                  />
                  {game.pred?.mlEnhanced && <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(2)} runs</div>}
                  <ShapPanel shap={game.mlShap} homeName={home.abbr} awayName={away.abbr} />
                  <MonteCarloPanel mc={game.mc} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MLB SECTION (tab wrapper) ────────────────────────────────
export function MLBSection({ mlbGames, setMlbGames, calibrationMLB, setCalibrationMLB, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const TABS = ["calendar", "accuracy", "history", "parlay"];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`, background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.blue : C.dim, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <button
          onClick={async () => { setRefreshKey(k => k + 1); await mlbAutoSync(msg => console.log(msg)); setRefreshKey(k => k + 1); }}
          style={{ marginLeft: "auto", background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 10 }}
        >⟳ Auto Sync</button>
      </div>
      {tab === "calendar" && <MLBCalendarTab calibrationFactor={calibrationMLB} onGamesLoaded={setMlbGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="mlb_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationMLB} spreadLabel="Run Line" />}
      {tab === "history" && <HistoryTab table="mlb_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={mlbGames} ncaaGames={[]} />}
    </div>
  );
}