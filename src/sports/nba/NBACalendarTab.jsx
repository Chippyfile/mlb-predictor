// src/sports/nba/NBACalendarTab.jsx
// v17 audit fixes: removed redundant fetchNBARealPace calls (data already in team stats)
import { useState, useEffect, useCallback } from "react";
import { C, Pill, Kv, confColor2, AccuracyDashboard, HistoryTab, ParlayBuilder, BetSignalsPanel } from "../../components/Shared.jsx";
import ShapPanel from "../../components/ShapPanel.jsx";
import MonteCarloPanel from "../../components/MonteCarloPanel.jsx";
import { getBetSignals, fetchOdds } from "../../utils/sharedUtils.js";
import { mlPredict, mlMonteCarlo } from "../../utils/mlApi.js";
import { nbaAutoSync, computeDaysRest } from "./nbaSync.js";
import {
  fetchNBAGamesForDate,
  fetchNBATeamStats,
  nbaPredictGame,
  matchNBAOddsToGame,
  NBA_TEAM_COLORS,
  computeLeagueAverages,
} from "./nbaUtils.js";

// ─────────────────────────────────────────────────────────────
// NBACalendarTab
// ─────────────────────────────────────────────────────────────
export function NBACalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([fetchNBAGamesForDate(d), fetchOdds("basketball_nba")]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    // Pre-load all team stats and compute dynamic league averages
    const allStatsPairs = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([fetchNBATeamStats(g.homeAbbr), fetchNBATeamStats(g.awayAbbr)]);
      // AUDIT: fetchNBARealPace was redundant wrapper over fetchNBATeamStats.
      // Team stats already contain pace, adjOE, adjDE, netRtg.
      // Pass them directly as realStats to preserve backward compat with nbaPredictGame.
      const nbaRealH = hs ? { pace: hs.pace, offRtg: hs.adjOE, defRtg: hs.adjDE, netRtg: hs.netRtg } : null;
      const nbaRealA = as_ ? { pace: as_.pace, offRtg: as_.adjOE, defRtg: as_.adjDE, netRtg: as_.netRtg } : null;
      return { game: g, hs, as_, nbaRealH, nbaRealA };
    }));
    // Compute league averages from all unique teams loaded today
    const uniqueNbaStats = [];
    const seenNba = new Set();
    for (const { hs, as_ } of allStatsPairs) {
      if (hs && !seenNba.has(hs.abbr)) { seenNba.add(hs.abbr); uniqueNbaStats.push(hs); }
      if (as_ && !seenNba.has(as_.abbr)) { seenNba.add(as_.abbr); uniqueNbaStats.push(as_); }
    }
    if (uniqueNbaStats.length >= 10) computeLeagueAverages(uniqueNbaStats);

    const enriched = await Promise.all(allStatsPairs.map(async ({ game: g, hs, as_, nbaRealH, nbaRealA }) => {
      // NBA-H3 FIX (v16): Compute rest + travel for CalendarTab predictions
      // Previously these defaulted to homeDaysRest=2, awayDaysRest=2, missing
      // the ±1.8–2.2 pt B2B penalties entirely for live predictions.
      const homeDaysRest = hs ? computeDaysRest(hs, d) : 2;
      const awayDaysRest = as_ ? computeDaysRest(as_, d) : 2;
      const awayPrevCityAbbr = as_?.lastGameCity || null;

      const pred = hs && as_ ? nbaPredictGame({
        homeStats: hs, awayStats: as_,
        neutralSite: g.neutralSite,
        calibrationFactor,
        homeRealStats: nbaRealH, awayRealStats: nbaRealA,
        homeAbbr: g.homeAbbr, awayAbbr: g.awayAbbr,
        homeDaysRest, awayDaysRest,
        awayPrevCityAbbr,
      }) : null;
      const rawOdds = odds?.games?.find(o => matchNBAOddsToGame(o, g)) || null;
      // ── ODDS NORMALIZATION ──
      // Normalize field names (odds.js returns marketSpreadHome/marketTotal)
      // and detect home/away swap between The Odds API and ESPN
      const gameOdds = rawOdds ? (() => {
        const normalize = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");
        const oddsHome = normalize(rawOdds.homeTeam);
        const espnHome = normalize(g.homeTeamName || g.homeAbbr);
        const espnAway = normalize(g.awayTeamName || g.awayAbbr);
        const homeMatchesHome = oddsHome.includes(espnHome.slice(0, 6)) || espnHome.includes(oddsHome.slice(0, 6));
        const homeMatchesAway = oddsHome.includes(espnAway.slice(0, 6)) || espnAway.includes(oddsHome.slice(0, 6));
        const isSwapped = !homeMatchesHome && homeMatchesAway;
        if (isSwapped) console.warn(`⚠️ NBA ODDS SWAP: Odds="${rawOdds.homeTeam}" vs ESPN="${g.homeTeamName}"`);
        return {
          ...rawOdds,
          homeML: isSwapped ? rawOdds.awayML : rawOdds.homeML,
          awayML: isSwapped ? rawOdds.homeML : rawOdds.awayML,
          homeSpread: isSwapped ? -(rawOdds.marketSpreadHome ?? null) : (rawOdds.marketSpreadHome ?? null),
          ouLine: rawOdds.marketTotal ?? null,
          _swapped: isSwapped,
        };
      })() : null;
      // ── ML API: calibrated win prob + SHAP + Monte Carlo ──
      let mlResult = null, mcResult = null;
      if (pred) {
        // Run ML prediction first, then MC with ML-adjusted means
        try {
          mlResult = await mlPredict("nba", {
            pred_home_score: pred.homeScore, pred_away_score: pred.awayScore,
            home_net_rtg: pred.homeNetRtg, away_net_rtg: pred.awayNetRtg,
            win_pct_home: pred.homeWinPct, ou_total: pred.ouTotal,
            model_ml_home: pred.modelML_home,
            market_ou_total: gameOdds?.ouLine ?? pred.ouTotal,
            market_spread_home: gameOdds?.marketSpreadHome ?? 0,
            // v22: Send full stats so Railway can build all 27 features
            home_ppg: hs?.ppg, away_ppg: as_?.ppg,
            home_opp_ppg: hs?.oppPpg, away_opp_ppg: as_?.oppPpg,
            home_fgpct: hs?.fgPct, away_fgpct: as_?.fgPct,
            home_threepct: hs?.threePct, away_threepct: as_?.threePct,
            home_ftpct: hs?.ftPct, away_ftpct: as_?.ftPct,
            home_assists: hs?.assists, away_assists: as_?.assists,
            home_turnovers: hs?.turnovers, away_turnovers: as_?.turnovers,
            home_tempo: hs?.pace ?? hs?.tempo, away_tempo: as_?.pace ?? as_?.tempo,
            home_orb_pct: hs?.orbPct, away_orb_pct: as_?.orbPct,
            home_fta_rate: hs?.ftaRate, away_fta_rate: as_?.ftaRate,
            home_ato_ratio: hs?.atoRatio, away_ato_ratio: as_?.atoRatio,
            home_opp_fgpct: hs?.oppFgPct, away_opp_fgpct: as_?.oppFgPct,
            home_opp_threepct: hs?.oppThreePct, away_opp_threepct: as_?.oppThreePct,
            home_steals: hs?.steals, away_steals: as_?.steals,
            home_blocks: hs?.blocks, away_blocks: as_?.blocks,
            home_wins: hs?.wins, away_wins: as_?.wins,
            home_losses: hs?.losses, away_losses: as_?.losses,
            home_form: hs?.formScore ?? 0, away_form: as_?.formScore ?? 0,
            home_days_rest: homeDaysRest, away_days_rest: awayDaysRest,
            away_travel_dist: 0,
          });
          if (mlResult) console.log(`[NBA ML] ${g.homeAbbr}: margin=${mlResult.ml_margin}, shap=${!!mlResult.shap}, meta=${!!mlResult.model_meta}`);
        } catch (e) { console.warn("[NBA ML] predict failed:", e.message); }
        // FIX (v22): MC was using raw heuristic scores, ignoring the ML margin
        // entirely. Now split ouTotal by heuristic ratio + ML margin shift,
        // matching the NCAA fix for the double-division bug.
        const heuristicTotal = pred.homeScore + pred.awayScore;
        const ouBase = pred.ouTotal ?? heuristicTotal;
        const homeRatio = heuristicTotal > 0 ? pred.homeScore / heuristicTotal : 0.5;
        const mlMarginAdj = mlResult ? (mlResult.ml_margin - pred.projectedSpread) / 2 : 0;
        const mcHome = ouBase * homeRatio + mlMarginAdj;
        const mcAway = ouBase * (1 - homeRatio) - mlMarginAdj;
        try {
          mcResult = await mlMonteCarlo("NBA", mcHome, mcAway, 10000, gameOdds?.ouLine ?? pred.ouTotal, g.gameId);
        } catch (e) { console.warn("[NBA MC] failed:", e.message); }
      }
      // FIX: Reconcile projected scores with ML margin so all displayed
      // values are internally consistent.
      const finalPred = pred && mlResult ? (() => {
        const mlMargin = mlResult.ml_margin;
        const heuristicMargin = pred.projectedSpread;
        const marginShift = (mlMargin - heuristicMargin) / 2;
        const adjHomeScore = parseFloat((pred.homeScore + marginShift).toFixed(1));
        const adjAwayScore = parseFloat((pred.awayScore - marginShift).toFixed(1));
        // CONSISTENCY FIX: Derive win prob FROM margin so spread/win%/ML always agree.
        const SIGMA = 15.0;
        const marginBasedWinProb = 1 / (1 + Math.pow(10, -mlMargin / SIGMA));
        const MARGIN_WEIGHT = 0.70;
        const rawBlended = MARGIN_WEIGHT * marginBasedWinProb + (1 - MARGIN_WEIGHT) * mlResult.ml_win_prob_home;
        // NBA-M2 FIX (v16): Widened caps from [0.12, 0.88] to [0.08, 0.92]
        // to match the wider caps in nbaPredictGame and allow edge detection on heavies
        const blendedWinHome = Math.max(0.08, Math.min(0.92, rawBlended));
        const blendedWinAway = 1 - blendedWinHome;
        const ML_CAP = 500;
        // VIG FIX: away ML ≠ -homeML. Real lines are asymmetric due to vig.
        // Same VIG = 0.0225 (~4.5% total juice) pattern as ncaaUtils.js.
        const VIG = 0.0225;
        const hProb = blendedWinHome + VIG;
        const aProb = blendedWinAway + VIG;
        const newModelML_home = blendedWinHome >= 0.5
          ? -Math.min(ML_CAP, Math.round((hProb / (1 - hProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - hProb) / hProb) * 100));
        const newModelML_away = blendedWinAway >= 0.5
          ? -Math.min(ML_CAP, Math.round((aProb / (1 - aProb)) * 100))
          : +Math.min(ML_CAP, Math.round(((1 - aProb) / aProb) * 100));
        return {
          ...pred,
          homeScore: adjHomeScore,
          awayScore: adjAwayScore,
          homeWinPct: blendedWinHome,
          awayWinPct: blendedWinAway,
          projectedSpread: parseFloat(mlMargin.toFixed(1)),
          ouTotal: pred.ouTotal,
          modelML_home: newModelML_home,
          modelML_away: newModelML_away,
          mlEnhanced: true,
          _heuristicHomeScore: pred.homeScore,
          _heuristicAwayScore: pred.awayScore,
          _heuristicSpread: pred.projectedSpread,
          _heuristicWinPct: pred.homeWinPct,
          _rawMlWinProb: mlResult.ml_win_prob_home,
        };
      })() : pred;
      return { ...g, homeStats: hs, awayStats: as_, pred: finalPred, loading: false, odds: gameOdds, mlShap: mlResult?.shap ?? null, mlMeta: mlResult?.model_meta ?? null, mc: mcResult };
    }));
    setGames(enriched); onGamesLoaded?.(enriched); setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: C.orange, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {!loading && oddsInfo?.games?.length > 0 && <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {loading && <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading…</span>}
        {!loading && games.length === 0 && <span style={{ color: C.dim, fontSize: 11 }}>No NBA games on {dateStr}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const homeColor = NBA_TEAM_COLORS[game.homeAbbr] || "#334";
          const awayColor = NBA_TEAM_COLORS[game.awayAbbr] || "#334";
          const isOpen = expanded === game.gameId;
          const sigs = game.pred ? getBetSignals({ pred: game.pred, odds: game.odds, sport: "nba" }) : null;
          const dec = game.pred ? (game.pred.decisiveness ?? (Math.abs(game.pred.homeWinPct - 0.5) * 100)) : 0;
          const hasBet = sigs && dec >= 15 && (sigs.ml?.verdict === "GO" || sigs.ml?.verdict === "LEAN" || sigs.spread?.verdict === "GO" || sigs.ou?.verdict === "GO");
          return (
            <div key={game.gameId} style={{ background: hasBet ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)", border: `1px solid ${hasBet ? "#2ea043" : C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${awayColor},${homeColor})` }} />
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)}
                style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: awayColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.awayAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <span style={{ color: C.dim }}>@</span>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: homeColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>{game.homeAbbr}</div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME</div>
                  </div>
                </div>
                {game.pred ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${game.awayAbbr} ${game.pred.awayScore.toFixed(0)}–${game.pred.homeScore.toFixed(0)} ${game.homeAbbr}`} />
                    <Pill label="SPREAD" value={game.pred.projectedSpread > 0 ? `${game.homeAbbr} -${game.pred.projectedSpread}` : `${game.awayAbbr} -${-game.pred.projectedSpread}`} highlight={sigs?.spread?.verdict === "GO"} lean={sigs?.spread?.verdict === "LEAN"} />
                    <Pill label="MDL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} highlight={sigs?.ml?.verdict === "GO"} lean={sigs?.ml?.verdict === "LEAN"} />
                    {game.odds?.homeML && <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                    <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs?.ou?.verdict === "GO"} lean={sigs?.ou?.verdict === "LEAN"} />
                  </div>
                ) : (
                  <span style={{ color: C.dim, fontSize: 11 }}>{game.loading ? "Calculating…" : "Stats unavailable"}</span>
                )}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live" && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>LIVE</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Win %" v={`${game.homeAbbr} ${(game.pred.homeWinPct*100).toFixed(1)}% / ${game.awayAbbr} ${(game.pred.awayWinPct*100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Possessions" v={game.pred.possessions} />
                    <Kv k={`${game.homeAbbr} Net Rtg`} v={game.pred.homeNetRtg} />
                    <Kv k={`${game.awayAbbr} Net Rtg`} v={game.pred.awayNetRtg} />
                    {game.homeStats && <Kv k={`${game.homeAbbr} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} Opp PPG`} v={game.homeStats.oppPpg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} Opp PPG`} v={game.awayStats.oppPpg?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                  </div>
                  <BetSignalsPanel signals={sigs} pred={game.pred} odds={game.odds} sport="nba" homeName={game.homeAbbr} awayName={game.awayAbbr} />
                  {game.pred?.mlEnhanced && <div style={{ fontSize: 8, color: "#58a6ff", marginTop: 4 }}>⚡ ML-enhanced · trained on {game.mlMeta?.n_train} games · MAE {game.mlMeta?.mae_cv?.toFixed(1)} pts</div>}
                  <ShapPanel shap={game.mlShap} homeName={game.homeAbbr} awayName={game.awayAbbr} />
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

// ─────────────────────────────────────────────────────────────
// NBASection
// ─────────────────────────────────────────────────────────────
export function NBASection({ nbaGames, setNbaGames, calibrationNBA, setCalibrationNBA, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar","accuracy","history","parlay"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7, border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent", color: tab === t ? C.orange : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => { setSyncMsg("Syncing…"); await nbaAutoSync(m => setSyncMsg(m)); setRefreshKey(k => k+1); setTimeout(() => setSyncMsg(""), 4000); }}
            style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>
      {syncMsg && <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>{syncMsg}</div>}
      {tab === "calendar" && <NBACalendarTab calibrationFactor={calibrationNBA} onGamesLoaded={setNbaGames} />}
      {tab === "accuracy" && <AccuracyDashboard table="nba_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNBA} spreadLabel="Spread" />}
      {tab === "history" && <HistoryTab table="nba_predictions" refreshKey={refreshKey} />}
      {tab === "parlay" && <ParlayBuilder mlbGames={[]} ncaaGames={[]} nbaGames={nbaGames} />}
    </div>
  );
}