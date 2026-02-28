// src/sports/ncaa/NCAACalendarTab.jsx
// Lines 2877–3276 of App.jsx (extracted)
import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, trueImplied, EDGE_THRESHOLD, fetchOdds } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import { fetchNCAATeamStats, fetchNCAAGamesForDate, ncaaPredictGame, matchNCAAOddsToGame } from "./ncaaUtils.js";
import { ncaaAutoSync, ncaaFullBackfill, ncaaRegradeAllResults } from "./ncaaSync.js";

// Season start (Nov 1 of prior year) — keep in sync with ncaaSync.js
const _ncaaSeasonStart = (() => {
  const now = new Date();
  const seasonYear = now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
  return `${seasonYear}-11-01`;
})();

export default function NCAACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsData, setOddsData] = useState(null);

  const loadGames = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNCAAGamesForDate(d), fetchOdds("basketball_ncaab")]);
    setOddsData(odds);
    const enriched = await Promise.all(raw.map(async (g) => {
      const [homeStats, awayStats] = await Promise.all([fetchNCAATeamStats(g.homeTeamId), fetchNCAATeamStats(g.awayTeamId)]);
      const pred = homeStats && awayStats ? ncaaPredictGame({ homeStats, awayStats, neutralSite: g.neutralSite, calibrationFactor }) : null;
      const gameOdds = odds?.games?.find(o => matchNCAAOddsToGame(o, g)) || null;
      let mlResult = null, mcResult = null;
      if (pred) {
        // Run ML prediction first
        mlResult = await mlPredict("ncaa", {
            pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
            home_adj_em: pred.homeAdjEM, away_adj_em: pred.awayAdjEM,
            win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
            model_ml_home: pred.modelML_home,
            neutral_site: g.neutralSite,
            spread_home: pred.projectedSpread,
            market_spread_home: gameOdds?.homeSpread ?? null,
            market_ou_total: gameOdds?.ouLine ?? pred.ouTotal,
            // R2: Heuristic win probability for capped feature
            // R3: Conference + date for conference game detection + season phase
            home_conference: homeStats?.conferenceName || "",
            away_conference: awayStats?.conferenceName || "",
            game_date: selectedDate,
            // Raw stats for expanded ML features
            home_ppg: homeStats?.ppg, away_ppg: awayStats?.ppg,
            home_opp_ppg: homeStats?.oppPpg, away_opp_ppg: awayStats?.oppPpg,
            home_fgpct: homeStats?.fgPct, away_fgpct: awayStats?.fgPct,
            home_threepct: homeStats?.threePct, away_threepct: awayStats?.threePct,
            home_ftpct: homeStats?.ftPct, away_ftpct: awayStats?.ftPct,
            home_assists: homeStats?.assists, away_assists: awayStats?.assists,
            home_turnovers: homeStats?.turnovers, away_turnovers: awayStats?.turnovers,
            home_tempo: homeStats?.tempo, away_tempo: awayStats?.tempo,
            home_orb_pct: homeStats?.orbPct, away_orb_pct: awayStats?.orbPct,
            home_fta_rate: homeStats?.ftaRate, away_fta_rate: awayStats?.ftaRate,
            home_ato_ratio: homeStats?.atoRatio, away_ato_ratio: awayStats?.atoRatio,
            home_opp_fgpct: homeStats?.oppFGpct, away_opp_fgpct: awayStats?.oppFGpct,
            home_opp_threepct: homeStats?.oppThreePct, away_opp_threepct: awayStats?.oppThreePct,
            home_steals: homeStats?.steals, away_steals: awayStats?.steals,
            home_blocks: homeStats?.blocks, away_blocks: awayStats?.blocks,
            home_wins: homeStats?.wins, away_wins: awayStats?.wins,
            home_losses: homeStats?.losses, away_losses: awayStats?.losses,
            home_form: homeStats?.formScore, away_form: awayStats?.formScore,
            home_sos: null, away_sos: null,
            home_rank: g.homeRank || 200, away_rank: g.awayRank || 200,
          });
        // R9: MC uses ML-adjusted means when ML is available
        const mlMarginAdj = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
        const mcHome = pred.homeScore + mlMarginAdj;
        const mcAway = pred.awayScore - mlMarginAdj;
        mcResult = await mlMonteCarlo("NCAAB", mcHome, mcAway, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      const finalPred = pred && mlResult ? {
        ...pred,
        homeWinPct: mlResult.ml_win_prob_home,
        awayWinPct: mlResult.ml_win_prob_away,
        projectedSpread: parseFloat(mlResult.ml_margin.toFixed(1)),
        mlEnhanced: true,
        biasCorrection: mlResult.bias_correction_applied ?? 0,
      } : pred;
      // R9: MC uses ML-adjusted means when ML prediction is available
      const mcHomeMean = mlResult ? pred.homeScore + (mlResult.ml_margin - pred.projectedSpread) / 2 : pred?.homeScore;
      const mcAwayMean = mlResult ? pred.awayScore - (mlResult.ml_margin - pred.projectedSpread) / 2 : pred?.awayScore;
      if (pred && !mcResult) {
        mcResult = await mlMonteCarlo("NCAAB", mcHomeMean, mcAwayMean, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
      }
      return { ...g, homeStats, awayStats, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { loadGames(dateStr); }, [dateStr, calibrationFactor]);

  const getBannerInfo = (pred, odds) => {
    if (!pred) return { color: "yellow", label: "⚠ No prediction" };
    if (odds?.homeML && odds?.awayML) {
      const market = trueImplied(odds.homeML, odds.awayML);
      const homeEdge = pred.homeWinPct - market.home;
      if (Math.abs(homeEdge) >= EDGE_THRESHOLD)
        return { color: "green", edge: homeEdge, label: homeEdge >= EDGE_THRESHOLD ? `+${(homeEdge * 100).toFixed(1)}% HOME edge` : `+${((-homeEdge) * 100).toFixed(1)}% AWAY edge` };
      return { color: "neutral", edge: homeEdge, label: `${(Math.abs(homeEdge) * 100).toFixed(1)}% edge` };
    }
    if (pred.homeWinPct >= 0.65 || pred.homeWinPct <= 0.35) return { color: "green", label: "Strong signal" };
    return { color: "neutral", label: "Close matchup" };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => loadGames(dateStr)} style={{ background: "#161b22", color: C.orange, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↻ REFRESH</button>
        {!loading && oddsData?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsData.games.length})</span>}
        {!loading && oddsData?.noKey && <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading {games.length > 0 ? `${games.length} games` : "schedule"}…</span>}
        <span style={{ fontSize: 10, color: C.dim }}>NCAA Men's Basketball · ESPN API</span>
      </div>
      {!loading && games.length === 0 && <div style={{ color: C.dim, textAlign: "center", marginTop: 40 }}>No games scheduled for {dateStr}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const bannerInfo = game.loading ? { color: "yellow", label: "Calculating…" } : getBannerInfo(game.pred, game.odds);
          const color = bannerInfo.color;
          const isOpen = expanded === game.gameId;
          const bannerBg = color === "green" ? "linear-gradient(135deg,#1a0a00,#221005)" : color === "yellow" ? "linear-gradient(135deg,#1a1200,#1a1500)" : `linear-gradient(135deg,${C.card},#111822)`;
          const borderColor = color === "green" ? "#f97316" : color === "yellow" ? "#4a3a00" : C.border;
          const hName = game.homeAbbr || (game.homeTeamName || "").slice(0, 8);
          const aName = game.awayAbbr || (game.awayTeamName || "").slice(0, 8);
          return (
            <div key={game.gameId} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 200 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{aName}</div>
                    {game.awayRank && <div style={{ fontSize: 9, color: C.orange }}>#{game.awayRank}</div>}
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <div style={{ fontSize: 13, color: C.dim }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{hName}</div>
                    {game.homeRank && <div style={{ fontSize: 9, color: C.orange }}>#{game.homeRank}</div>}
                    <div style={{ fontSize: 9, color: C.dim }}>HOME{game.neutralSite ? " (N)" : ""}</div>
                  </div>
                </div>
                {game.pred ? (() => {
                  const sigs = getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa" });
                  return (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <Pill label="PROJ" value={`${aName} ${game.pred.awayScore.toFixed(0)} — ${hName} ${game.pred.homeScore.toFixed(0)}`} />
                      <Pill label="SPREAD" value={game.pred.projectedSpread > 0 ? `${hName} -${game.pred.projectedSpread.toFixed(1)}` : `${aName} -${(-game.pred.projectedSpread).toFixed(1)}`} highlight={sigs.spread?.verdict === "LEAN"} />
                      <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs.ml?.verdict === "GO" || sigs.ml?.verdict === "LEAN"} />
                      {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                      <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs.ou?.verdict === "GO" || sigs.ou?.verdict === "LEAN"} />
                      <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={sigs.conf?.verdict === "GO"} />
                    </div>
                  );
                })() : <div style={{ color: C.dim, fontSize: 11 }}>{game.loading ? "Calculating…" : "⚠ Stats unavailable"}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}-{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  {bannerInfo.edge != null && <span style={{ fontSize: 10, color: Math.abs(bannerInfo.edge) >= EDGE_THRESHOLD ? C.orange : C.dim }}>{bannerInfo.label}</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${aName} ${game.pred.awayScore.toFixed(1)} — ${hName} ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0 ? `${hName} -${game.pred.projectedSpread.toFixed(1)}` : `${aName} -${(-game.pred.projectedSpread).toFixed(1)}`} />
                    <Kv k="Possessions" v={game.pred.possessions.toFixed(1)} />
                    {game.homeStats && <Kv k={`${hName} Adj EM`} v={game.pred.homeAdjEM} />}
                    {game.awayStats && <Kv k={`${aName} Adj EM`} v={game.pred.awayAdjEM} />}
                    {game.homeStats && <Kv k={`${hName} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${aName} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.neutralSite && <Kv k="Site" v="Neutral" />}
                    {game.venue && <Kv k="Venue" v={game.venue} />}
                  </div>
                  <BetSignalsPanel
                    signals={getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaa" })}
                    pred={game.pred} odds={game.odds} sport="ncaa"
                    homeName={hName} awayName={aName}
                  />
                  {game.pred?.mlEnhanced && <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(1)} pts</div>}
                  <ShapPanel shap={game.mlShap} homeName={hName} awayName={aName} />
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

// ── NCAA SECTION (tab wrapper) ────────────────────────────────
export function NCAASection({ ncaaGames, setNcaaGames, calibrationNCAA, setCalibrationNCAA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const abortRef = useRef(null);
  const TABS = ["calendar", "accuracy", "history", "parlay"];

  const handleAutoSync = async () => {
    setSyncMsg("🏀 Syncing…");
    await ncaaAutoSync(msg => setSyncMsg(msg));
    setRefreshKey(k => k + 1);
    setTimeout(() => setSyncMsg(""), 4000);
  };

  const handleFullBackfill = async () => {
    if (backfilling) {
      abortRef.current?.abort();
      setBackfilling(false);
      setSyncMsg("🏀 Backfill cancelled");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBackfilling(true);
    setSyncMsg("🏀 Starting full season backfill…");
    await ncaaFullBackfill(msg => setSyncMsg(msg), controller.signal);
    setBackfilling(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`, background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.orange : C.dim, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={handleAutoSync} disabled={backfilling} style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: backfilling ? "not-allowed" : "pointer", fontSize: 10 }}>⟳ Sync</button>
          <button onClick={handleFullBackfill} style={{ background: backfilling ? "#2a0a0a" : "#1a0a00", color: backfilling ? C.red : C.orange, border: `1px solid ${backfilling ? "#5a1a1a" : "#3a1a00"}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
            {backfilling ? "⏹ Cancel" : "⏮ Full Season Backfill"}
          </button>
          <button
            onClick={async () => {
              if (!window.confirm("Regrade all NCAA records with updated confidence + ATS logic?")) return;
              setSyncMsg("⏳ Regrading…");
              await ncaaRegradeAllResults(msg => setSyncMsg(msg));
              setRefreshKey(k => k + 1);
              setTimeout(() => setSyncMsg(""), 4000);
            }}
            disabled={backfilling}
            style={{ background: "#1a0a2e", color: "#d2a8ff", border: "1px solid #3d1f6e", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}
          >🔧 Regrade</button>
        </div>
      </div>
      {syncMsg && (
        <div style={{ background: "#0d1a10", border: `1px solid #1a3a1a`, borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: backfilling ? C.orange : C.green, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 8 }}>
          {backfilling && <span style={{ fontSize: 14 }}>⏳</span>}
          {syncMsg}
        </div>
      )}
      {!syncMsg && (
        <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
          NCAA Men's Basketball · Season starts {_ncaaSeasonStart} · ESPN API (free, no key)
        </div>
      )}
      {tab === "calendar" && <NCAACalendarTab calibrationFactor={calibrationNCAA} onGamesLoaded={setNcaaGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="ncaa_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNCAA} spreadLabel="Spread" isNCAA={true} />}
      {tab === "history" && <HistoryTab table="ncaa_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={ncaaGames} />}
    </div>
  );
}