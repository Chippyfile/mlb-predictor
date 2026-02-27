// src/sports/ncaaf/NCAAFCalendarTab.jsx
// Lines 4047–4281 of App.jsx (extracted)

import { useState, useEffect, useCallback } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import { getBetSignals, fetchOdds } from "../../utils/sharedUtils.js";
import { NFL_TEAMS } from "../nfl/nflUtils.js";
import {
  fetchNCAAFGamesForDate,
  fetchNCAAFTeamStats,
  ncaafPredictGame,
  matchNCAAFOddsToGame,
} from "./ncaafUtils.js";
import { ncaafAutoSync } from "./ncaafSync.js";

// ─────────────────────────────────────────────────────────────
// NCAAF CALENDAR TAB
// ─────────────────────────────────────────────────────────────
export function NCAAFCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];

  // Default to most recent Saturday
  const defaultDate = (() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 1 : day === 6 ? 0 : day));
    return d.toISOString().split("T")[0];
  })();

  const [dateStr, setDateStr]     = useState(defaultDate);
  const [games, setGames]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(null);
  const [oddsInfo, setOddsInfo]   = useState(null);
  const [filterConf, setFilterConf] = useState("All");

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([
      fetchNCAAFGamesForDate(d),
      fetchOdds("americanfootball_ncaaf"),
    ]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    const enriched = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([
        fetchNCAAFTeamStats(g.homeTeamId),
        fetchNCAAFTeamStats(g.awayTeamId),
      ]);
      const pred = hs && as_
        ? ncaafPredictGame({
            homeStats: hs, awayStats: as_,
            neutralSite: g.neutralSite, weather: g.weather,
            calibrationFactor,
            homeTeamName: g.homeTeamName || "",
            awayTeamName: g.awayTeamName || "",
            isConferenceGame: g.conferenceGame || false,
          })
        : null;
      const gameOdds = odds?.games?.find(o => matchNCAAFOddsToGame(o, g)) || null;
      return { ...g, homeStats: hs, awayStats: as_, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  // Conference filter options
  const conferences = ["All", ...new Set(
    games.flatMap(g => [g.homeStats?.conference, g.awayStats?.conference].filter(Boolean))
  )].sort();
  const filteredGames = filterConf === "All"
    ? games
    : games.filter(g => g.homeStats?.conference === filterConf || g.awayStats?.conference === filterConf);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: "#f97316", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {conferences.length > 2 && (
          <select value={filterConf} onChange={e => setFilterConf(e.target.value)}
            style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }}>
            {conferences.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {!loading && oddsInfo?.games?.length > 0 &&
          <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {!loading && oddsInfo?.noKey &&
          <span style={{ fontSize: 11, color: C.dim }}>⚠ Add ODDS_API_KEY for live lines</span>}
        {loading &&
          <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading {games.length > 0 ? `${games.length} games` : "CFB games"}…</span>}
        {!loading && filteredGames.length === 0 &&
          <span style={{ color: C.dim, fontSize: 11 }}>No games on {dateStr} — CFB plays Sat/Thu/Fri</span>}
        {!loading && filteredGames.length > 0 &&
          <span style={{ fontSize: 10, color: C.dim }}>Week {filteredGames[0]?.week || "?"} · {filteredGames.length} game{filteredGames.length !== 1 ? "s" : ""}</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredGames.map(game => {
          const isOpen  = expanded === game.gameId;
          const sigs    = game.pred ? getBetSignals({ pred: game.pred, odds: game.odds, sport: "ncaaf" }) : null;
          const hasBet  = sigs && (sigs.ml?.verdict === "GO" || sigs.spread?.verdict === "LEAN" || sigs.ou?.verdict === "GO");
          const hCol    = NFL_TEAMS.find(t => t.abbr === game.homeAbbr)?.color || "#1e3050";
          const aCol    = NFL_TEAMS.find(t => t.abbr === game.awayAbbr)?.color || "#1e3050";

          return (
            <div key={game.gameId} style={{
              background: hasBet ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)",
              border: `1px solid ${hasBet ? "#2ea043" : C.border}`,
              borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${aCol},${hCol})` }} />
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)}
                style={{ padding: "12px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

                {/* Teams */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
                  <div style={{ textAlign: "center" }}>
                    {game.awayRank && <div style={{ fontSize: 8, color: C.yellow, fontWeight: 700 }}>#{game.awayRank}</div>}
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: aCol, border: `2px solid ${aCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#fff", margin: "0 auto 2px", textAlign: "center", overflow: "hidden", padding: 2 }}>
                      {(game.awayAbbr || "?").slice(0, 4)}
                    </div>
                    <div style={{ fontSize: 8, color: C.dim, maxWidth: 50, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {game.awayTeamName?.split(" ").pop()}
                    </div>
                  </div>
                  <span style={{ color: C.dim, fontSize: 12 }}>@</span>
                  <div style={{ textAlign: "center" }}>
                    {game.homeRank && <div style={{ fontSize: 8, color: C.yellow, fontWeight: 700 }}>#{game.homeRank}</div>}
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: hCol, border: `2px solid ${hCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#fff", margin: "0 auto 2px", textAlign: "center", overflow: "hidden", padding: 2 }}>
                      {(game.homeAbbr || "?").slice(0, 4)}
                    </div>
                    <div style={{ fontSize: 8, color: C.dim, maxWidth: 50, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {game.homeTeamName?.split(" ").pop()}
                    </div>
                    {game.neutralSite && <div style={{ fontSize: 7, color: C.dim }}>(N)</div>}
                  </div>
                  {game.weather?.note && <span style={{ fontSize: 9, color: C.dim }}>{game.weather.note}</span>}
                  {game.conferenceGame && (
                    <span style={{ fontSize: 8, color: "#58a6ff", background: "#0c1a2e", borderRadius: 4, padding: "1px 5px" }}>CONF</span>
                  )}
                </div>

                {/* Pills */}
                {game.pred ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${game.pred.awayScore.toFixed(0)}–${game.pred.homeScore.toFixed(0)}`} />
                    <Pill label="SPREAD"
                      value={game.pred.projectedSpread > 0
                        ? `${(game.homeAbbr || "").slice(0, 4)} -${game.pred.projectedSpread}`
                        : `${(game.awayAbbr || "").slice(0, 4)} -${-game.pred.projectedSpread}`}
                      highlight={sigs?.spread?.verdict === "LEAN"} />
                    <Pill label="MDL ML"
                      value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home}
                      highlight={sigs?.ml?.verdict === "GO" || sigs?.ml?.verdict === "LEAN"} />
                    {game.odds?.homeML &&
                      <Pill label="MKT ML" value={game.odds.homeML > 0 ? `+${game.odds.homeML}` : game.odds.homeML} color={C.yellow} />}
                    <Pill label="O/U" value={game.pred.ouTotal} highlight={sigs?.ou?.verdict === "GO"} />
                    <Pill label="CONF" value={game.pred.confidence} color={confColor2(game.pred.confidence)} highlight={game.pred.confidence === "HIGH"} />
                  </div>
                ) : (
                  <span style={{ color: C.dim, fontSize: 11 }}>
                    {game.loading ? "Calculating…" : "Stats unavailable"}
                  </span>
                )}

                {/* Status */}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live"  && <span style={{ fontSize: 10, color: "#f97316", fontWeight: 700 }}>LIVE</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(145px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${game.pred.awayScore.toFixed(1)} – ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0
                      ? `${(game.homeAbbr || "").slice(0, 6)} -${game.pred.projectedSpread}`
                      : `${(game.awayAbbr || "").slice(0, 6)} -${-game.pred.projectedSpread}`} />
                    {game.homeStats && <Kv k={`${(game.homeAbbr || "").slice(0, 6)} PPG`} v={game.homeStats.ppg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${(game.awayAbbr || "").slice(0, 6)} PPG`} v={game.awayStats.ppg?.toFixed(1)} />}
                    {game.homeStats && <Kv k={`${(game.homeAbbr || "").slice(0, 6)} Opp PPG`} v={game.homeStats.oppPpg?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${(game.awayAbbr || "").slice(0, 6)} Opp PPG`} v={game.awayStats.oppPpg?.toFixed(1)} />}
                    {game.homeStats && <Kv k={`${(game.homeAbbr || "").slice(0, 6)} adjEM`} v={game.pred.homeAdjEM > 0 ? `+${game.pred.homeAdjEM}` : game.pred.homeAdjEM} />}
                    {game.awayStats && <Kv k={`${(game.awayAbbr || "").slice(0, 6)} adjEM`} v={game.pred.awayAdjEM > 0 ? `+${game.pred.awayAdjEM}` : game.pred.awayAdjEM} />}
                    {game.homeStats && <Kv k={`${(game.homeAbbr || "").slice(0, 6)} TO Margin`} v={game.homeStats.toMargin > 0 ? `+${game.homeStats.toMargin?.toFixed(1)}` : game.homeStats.toMargin?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${(game.awayAbbr || "").slice(0, 6)} TO Margin`} v={game.awayStats.toMargin > 0 ? `+${game.awayStats.toMargin?.toFixed(1)}` : game.awayStats.toMargin?.toFixed(1)} />}
                    {game.homeStats?.conference && <Kv k="Home Conf" v={game.homeStats.conference} />}
                    {game.awayStats?.conference && <Kv k="Away Conf" v={game.awayStats.conference} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.week && <Kv k="CFB Week" v={game.week} />}
                    {game.weather?.note && <Kv k="Weather" v={game.weather.note} />}
                    {game.neutralSite && <Kv k="Site" v="Neutral" />}
                  </div>

                  {game.pred.factors?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 6 }}>KEY FACTORS</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {game.pred.factors.map((f, i) => (
                          <div key={i} style={{
                            background: f.type === "home" ? "#001a0f" : f.type === "away" ? "#1a0008" : "#1a1200",
                            border: `1px solid ${f.type === "home" ? "#003820" : f.type === "away" ? "#330011" : "#3a2a00"}`,
                            borderRadius: 6, padding: "4px 10px", fontSize: 11,
                            color: f.type === "home" ? C.green : f.type === "away" ? "#ff4466" : C.yellow,
                          }}>
                            {f.label}: {f.val}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <BetSignalsPanel
                    signals={sigs} pred={game.pred} odds={game.odds} sport="ncaaf"
                    homeName={(game.homeAbbr || "HOME").slice(0, 6)}
                    awayName={(game.awayAbbr || "AWAY").slice(0, 6)} />
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
// NCAAF SECTION (tab wrapper)
// ─────────────────────────────────────────────────────────────
export function NCAAFSection({ ncaafGames, setNcaafGames, calibrationNCAAF, setCalibrationNCAAF, refreshKey, setRefreshKey }) {
  const [tab, setTab]       = useState("calendar");
  const [syncMsg, setSyncMsg] = useState("");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["calendar", "accuracy", "history", "parlay"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", borderRadius: 7,
            border: `1px solid ${tab === t ? "#30363d" : "transparent"}`,
            background: tab === t ? "#161b22" : "transparent",
            color: tab === t ? "#f97316" : C.dim,
            cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
          }}>
            {t === "calendar" ? "📅" : t === "accuracy" ? "📊" : t === "history" ? "📋" : "🎯"} {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={async () => {
            setSyncMsg("Syncing NCAAF…");
            await ncaafAutoSync(m => setSyncMsg(m));
            setRefreshKey(k => k + 1);
            setTimeout(() => setSyncMsg(""), 4000);
          }} style={{ background: "#161b22", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 10 }}>
            ⟳ Sync
          </button>
        </div>
      </div>

      {syncMsg && (
        <div style={{ background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 7, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: C.green, fontFamily: "monospace" }}>
          {syncMsg}
        </div>
      )}

      <div style={{ fontSize: 10, color: C.dim, marginBottom: 12, letterSpacing: 1 }}>
        NCAAF · ESPN API (free) · ~130 FBS teams · Games Sat/Thu/Fri · SP+ proxy + weather + rankings
      </div>

      {tab === "calendar"  && <NCAAFCalendarTab calibrationFactor={calibrationNCAAF} onGamesLoaded={setNcaafGames} />}
      {tab === "accuracy"  && <AccuracyDashboard table="ncaaf_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNCAAF} spreadLabel="Spread" />}
      {tab === "history"   && <HistoryTab table="ncaaf_predictions" refreshKey={refreshKey} />}
      {tab === "parlay"    && <ParlayBuilder mlbGames={[]} ncaaGames={ncaafGames} />}
    </div>
  );
}