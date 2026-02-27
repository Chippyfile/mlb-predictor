// src/sports/nfl/NFLCalendarTab.jsx
// Lines 3312–3527 of App.jsx (extracted)

import { useState, useEffect, useCallback } from "react";
import { C, confColor2, Pill, Kv, BetSignalsPanel, AccuracyDashboard, HistoryTab, ParlayBuilder } from "../../components/Shared.jsx";
import { getBetSignals, fetchOdds } from "../../utils/sharedUtils.js";
import { fetchNFLGamesForDate, fetchNFLTeamStats, nflPredictGame, nflTeamByAbbr } from "./nflUtils.js";
import { nflAutoSync } from "./nflSync.js";

// ─────────────────────────────────────────────────────────────
// Odds matching helper (local — only needed for display)
// ─────────────────────────────────────────────────────────────
function matchNFLOddsToGame(o, g) {
  if (!o || !g) return false;
  const n = s => (s || "").toLowerCase().replace(/[\s\W]/g, "");
  return (
    (n(o.homeTeam).includes(n(g.homeTeamName || "").slice(0, 5)) ||
     n(g.homeTeamName || "").includes(n(o.homeTeam).slice(0, 5))) &&
    (n(o.awayTeam).includes(n(g.awayTeamName || "").slice(0, 5)) ||
     n(g.awayTeamName || "").includes(n(o.awayTeam).slice(0, 5)))
  );
}

// ─────────────────────────────────────────────────────────────
// NFL CALENDAR TAB
// ─────────────────────────────────────────────────────────────
export function NFLCalendarTab({ calibrationFactor, onGamesLoaded }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [oddsInfo, setOddsInfo] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true); setGames([]);
    const [raw, odds] = await Promise.all([
      fetchNFLGamesForDate(d),
      fetchOdds("americanfootball_nfl"),
    ]);
    setOddsInfo(odds);
    setGames(raw.map(g => ({ ...g, loading: true })));
    const enriched = await Promise.all(raw.map(async g => {
      const [hs, as_] = await Promise.all([
        fetchNFLTeamStats(g.homeAbbr),
        fetchNFLTeamStats(g.awayAbbr),
      ]);
      const pred = hs && as_
        ? nflPredictGame({ homeStats: hs, awayStats: as_, neutralSite: g.neutralSite, weather: g.weather, calibrationFactor })
        : null;
      const gameOdds = odds?.games?.find(o => matchNFLOddsToGame(o, g)) || null;
      return { ...g, homeStats: hs, awayStats: as_, pred, loading: false, odds: gameOdds };
    }));
    setGames(enriched);
    onGamesLoaded?.(enriched);
    setLoading(false);
  }, [calibrationFactor]);

  useEffect(() => { load(dateStr); }, [dateStr, calibrationFactor]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: C.card, color: "#e2e8f0", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={() => load(dateStr)}
          style={{ background: "#161b22", color: "#f97316", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ↻ REFRESH
        </button>
        {!loading && oddsInfo?.games?.length > 0 &&
          <span style={{ fontSize: 11, color: C.green }}>✓ Live odds ({oddsInfo.games.length})</span>}
        {loading &&
          <span style={{ color: C.dim, fontSize: 11 }}>⏳ Loading NFL games…</span>}
        {!loading && games.length === 0 &&
          <span style={{ color: C.dim, fontSize: 11 }}>No NFL games on {dateStr} — try Thu/Sun/Mon</span>}
        {!loading && games.length > 0 &&
          <span style={{ fontSize: 10, color: C.dim }}>Week {games[0]?.week || "—"} · {games[0]?.season || ""} Season</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {games.map(game => {
          const homeTeam = nflTeamByAbbr(game.homeAbbr);
          const awayTeam = nflTeamByAbbr(game.awayAbbr);
          const isOpen = expanded === game.gameId;
          const sigs = game.pred ? getBetSignals({ pred: game.pred, odds: game.odds, sport: "nfl" }) : null;
          const hasBet = sigs && (sigs.ml?.verdict === "GO" || sigs.spread?.verdict === "LEAN" || sigs.ou?.verdict === "GO");
          return (
            <div key={game.gameId} style={{
              background: hasBet ? "linear-gradient(135deg,#0b2012,#0e2315)" : "linear-gradient(135deg,#0d1117,#111822)",
              border: `1px solid ${hasBet ? "#2ea043" : C.border}`,
              borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${awayTeam.color},${homeTeam.color})` }} />
              <div onClick={() => setExpanded(isOpen ? null : game.gameId)}
                style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: awayTeam.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>
                      {game.awayAbbr}
                    </div>
                    <div style={{ fontSize: 9, color: C.dim }}>AWAY</div>
                  </div>
                  <span style={{ color: C.dim, fontSize: 13 }}>@</span>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: homeTeam.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", margin: "0 auto 2px" }}>
                      {game.homeAbbr}
                    </div>
                    <div style={{ fontSize: 9, color: C.dim }}>HOME{game.neutralSite ? " (N)" : ""}</div>
                  </div>
                  {game.weather?.note && <span style={{ fontSize: 9, color: C.dim, marginLeft: 4 }}>{game.weather.note}</span>}
                </div>

                {game.pred ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill label="PROJ" value={`${game.awayAbbr} ${game.pred.awayScore.toFixed(0)}–${game.pred.homeScore.toFixed(0)} ${game.homeAbbr}`} />
                    <Pill label="SPREAD"
                      value={game.pred.projectedSpread > 0
                        ? `${game.homeAbbr} -${game.pred.projectedSpread}`
                        : `${game.awayAbbr} -${-game.pred.projectedSpread}`}
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

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {game.status === "Final" && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>FINAL {game.awayScore}–{game.homeScore}</span>}
                  {game.status === "Live"  && <span style={{ fontSize: 10, color: "#f97316", fontWeight: 700 }}>LIVE</span>}
                  <span style={{ color: C.dim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 10 }}>
                    <Kv k="Projected Score" v={`${game.awayAbbr} ${game.pred.awayScore.toFixed(1)} — ${game.homeAbbr} ${game.pred.homeScore.toFixed(1)}`} />
                    <Kv k="Home Win %" v={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Kv k="O/U Total" v={game.pred.ouTotal} />
                    <Kv k="Spread" v={game.pred.projectedSpread > 0
                      ? `${game.homeAbbr} -${game.pred.projectedSpread}`
                      : `${game.awayAbbr} -${-game.pred.projectedSpread}`} />
                    {game.homeStats && <Kv k={`${game.homeAbbr} PPG / OppPPG`} v={`${game.homeStats.ppg?.toFixed(1)} / ${game.homeStats.oppPpg?.toFixed(1)}`} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} PPG / OppPPG`} v={`${game.awayStats.ppg?.toFixed(1)} / ${game.awayStats.oppPpg?.toFixed(1)}`} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} Yds/Play`} v={`${game.homeStats.ypPlay?.toFixed(1)} off / ${game.homeStats.oppYpPlay?.toFixed(1)} def`} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} Yds/Play`} v={`${game.awayStats.ypPlay?.toFixed(1)} off / ${game.awayStats.oppYpPlay?.toFixed(1)} def`} />}
                    {game.pred.homeEPA != null && <Kv k={`${game.homeAbbr} Net EPA`} v={game.pred.homeEPA > 0 ? `+${game.pred.homeEPA}` : `${game.pred.homeEPA}`} />}
                    {game.pred.awayEPA != null && <Kv k={`${game.awayAbbr} Net EPA`} v={game.pred.awayEPA > 0 ? `+${game.pred.awayEPA}` : `${game.pred.awayEPA}`} />}
                    {game.homeStats && <Kv k={`${game.homeAbbr} TO Margin`} v={game.homeStats.turnoverMargin > 0 ? `+${game.homeStats.turnoverMargin?.toFixed(1)}` : game.homeStats.turnoverMargin?.toFixed(1)} />}
                    {game.awayStats && <Kv k={`${game.awayAbbr} TO Margin`} v={game.awayStats.turnoverMargin > 0 ? `+${game.awayStats.turnoverMargin?.toFixed(1)}` : game.awayStats.turnoverMargin?.toFixed(1)} />}
                    <Kv k="Confidence" v={`${game.pred.confidence} (${game.pred.confScore})`} />
                    {game.week && <Kv k="Week" v={game.week} />}
                    {game.weather?.note && <Kv k="Weather" v={game.weather.note} />}
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

                  <BetSignalsPanel signals={sigs} pred={game.pred} odds={game.odds} sport="nfl" homeName={game.homeAbbr} awayName={game.awayAbbr} />
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
// NFL SECTION (tab wrapper)
// ─────────────────────────────────────────────────────────────
export function NFLSection({ nflGames, setNflGames, calibrationNFL, setCalibrationNFL, refreshKey, setRefreshKey }) {
  const [tab, setTab] = useState("calendar");
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
            setSyncMsg("Syncing NFL…");
            await nflAutoSync(m => setSyncMsg(m));
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
        NFL · ESPN API (free, no key) · Games: Thu / Sun / Mon · Weather + EPA + Turnover model
      </div>

      {tab === "calendar"  && <NFLCalendarTab calibrationFactor={calibrationNFL} onGamesLoaded={setNflGames} />}
      {tab === "accuracy"  && <AccuracyDashboard table="nfl_predictions" refreshKey={refreshKey} onCalibrationChange={setCalibrationNFL} spreadLabel="Spread" />}
      {tab === "history"   && <HistoryTab table="nfl_predictions" refreshKey={refreshKey} />}
      {tab === "parlay"    && <ParlayBuilder mlbGames={[]} ncaaGames={nflGames} />}
    </div>
  );
}