// src/sports/ncaaf/ncaafUtils.js
// Lines 3528–3968 of App.jsx (extracted)

import { supabaseQuery } from "../../utils/supabase.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
export const NCAAF_HOME_FIELD_ADV   = 3.2;   // College HFA: 3.2 pts (2020-24 calibration, down from 4.0)
export const NCAAF_RANKED_BOOST     = 1.5;   // Extra pts for ranked team edge
export const NCAAF_NEUTRAL_REDUCTION = 0.0;
export const NCAAF_LG_AVG_PPG       = 28.8;  // FBS 2024-25 season average (Indiana CFP champs season)

// Known high-altitude / extreme environment stadiums
export const NCAAF_ALT_FACTOR = {
  "Colorado Buffaloes": 1.05,  // Boulder, 5430 ft
  "Utah Utes":          1.04,  // Salt Lake City
  "Air Force Falcons":  1.06,  // Colorado Springs, highest in FBS
  "Nevada Wolf Pack":   1.03,
  "Wyoming Cowboys":    1.05,
};

// ─────────────────────────────────────────────────────────────
// ESPN CFB FETCH HELPER
// ─────────────────────────────────────────────────────────────
function cfbFetch(path) {
  return fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/${path}`)
    .then(r => r.ok ? r.json() : null).catch(() => null);
}

// ─────────────────────────────────────────────────────────────
// TEAM STATS
// ─────────────────────────────────────────────────────────────
const _ncaafStatsCache = {};

export async function fetchNCAAFTeamStats(teamId) {
  if (!teamId) return null;
  const key = String(teamId);
  if (_ncaafStatsCache[key]) return _ncaafStatsCache[key];

  try {
    const [teamData, statsData, schedData, recordData] = await Promise.all([
      cfbFetch(`teams/${teamId}`),
      cfbFetch(`teams/${teamId}/statistics`),
      cfbFetch(`teams/${teamId}/schedule`),
      cfbFetch(`teams/${teamId}/record`),
    ]);
    if (!teamData) return null;

    const team = teamData.team;
    const cats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of cats) {
        for (const name of names) {
          const s = cat.stats?.find(s =>
            s.name === name || s.abbreviation === name ||
            s.displayName?.toLowerCase() === name.toLowerCase()
          );
          if (s) return parseFloat(s.value) || null;
        }
      }
      return null;
    };

    // Offense
    const ppg          = getStat("avgPoints","pointsPerGame","scoringAverage") || NCAAF_LG_AVG_PPG;
    const ypGame       = getStat("totalYardsPerGame","yardsPerGame","totalOffensiveYardsPerGame") || 380.0;
    const rushYpGame   = getStat("rushingYardsPerGame","avgRushingYards") || 170.0;
    const passYpGame   = getStat("passingYardsPerGame","avgPassingYards") || 210.0;
    const yardsPerPlay = getStat("yardsPerPlay","offensiveYardsPerPlay") || 5.8;
    const thirdPct     = getStat("thirdDownPct","thirdDownConversionPct") || 0.40;
    const redZonePct   = getStat("redZonePct","redZoneScoringPct","redZoneTouchdownPct") || 0.60;
    const turnoversLost = getStat("turnovers","totalTurnovers","offensiveTurnovers") || 1.3;

    // Defense
    const oppPpg       = getStat("avgPointsAllowed","opponentPointsPerGame","scoringDefenseAverage") || NCAAF_LG_AVG_PPG;
    const oppYpGame    = getStat("opponentYardsPerGame","yardsAllowedPerGame") || 380.0;
    const oppYpPlay    = getStat("opponentYardsPerPlay","defensiveYardsPerPlay") || 5.8;
    const sacks        = getStat("sacks","totalSacks","defensiveSacks") || 2.0;
    const turnoversForced = getStat("defensiveTurnovers","takeaways","totalTakeaways") || 1.3;

    // SP+ proxy: blend of scoring margin, YPP differential, turnover margin
    const offEff = ((ppg - NCAAF_LG_AVG_PPG) / NCAAF_LG_AVG_PPG) * 0.12
                 + ((yardsPerPlay - 5.8) / 5.8) * 0.08
                 + ((thirdPct - 0.40) / 0.40) * 0.04
                 + ((redZonePct - 0.60) / 0.60) * 0.03;
    const defEff = ((NCAAF_LG_AVG_PPG - oppPpg) / NCAAF_LG_AVG_PPG) * 0.12
                 + ((5.8 - oppYpPlay) / 5.8) * 0.08
                 + (sacks - 2.0) * 0.005;
    const toMargin = turnoversForced - turnoversLost;

    // Record
    const wins   = recordData?.items?.[0]?.stats?.find(s => s.name === "wins")?.value || 0;
    const losses = recordData?.items?.[0]?.stats?.find(s => s.name === "losses")?.value || 0;
    const totalGames = wins + losses;

    // Recent form — last 5 games weighted with margin
    let formScore = 0;
    try {
      const events    = schedData?.events || [];
      const completed = events.filter(e => e.competitions?.[0]?.status?.type?.completed);
      formScore = completed.slice(-5).reduce((s, e, i) => {
        const comp   = e.competitions?.[0];
        const teamC  = comp?.competitors?.find(c => c.team?.id === String(teamId));
        const won    = teamC?.winner || false;
        const myPts  = parseInt(teamC?.score) || 0;
        const oppPts = parseInt(comp?.competitors?.find(c => c.team?.id !== String(teamId))?.score) || 0;
        const margin = myPts - oppPts;
        return s + (won
          ? 1 + Math.min(margin / 28, 0.6)
          : -0.6 - Math.min(Math.abs(margin) / 28, 0.4)
        ) * (i + 1);
      }, 0) / 15;
    } catch {}

    // Adjusted efficiency margin (adjEM)
    const adjOE = (ppg / NCAAF_LG_AVG_PPG) * 100;
    const adjDE = (oppPpg / NCAAF_LG_AVG_PPG) * 100;
    const adjEM = adjOE - adjDE;

    const result = {
      teamId: key,
      name: team.displayName,
      abbr: team.abbreviation || team.displayName?.slice(0, 4).toUpperCase(),
      conference: team.conference?.name || team.groups?.name || null,
      rank: parseInt(team.rank) || null,
      ppg, oppPpg, ypGame, oppYpGame, yardsPerPlay, oppYpPlay,
      rushYpGame, passYpGame, thirdPct, redZonePct,
      turnoversLost, turnoversForced, toMargin,
      sacks, offEff, defEff,
      adjOE, adjDE, adjEM,
      wins, losses, totalGames, formScore,
      altFactor: NCAAF_ALT_FACTOR[team.displayName] || 1.0,
    };
    _ncaafStatsCache[key] = result;
    return result;
  } catch (e) {
    console.warn("fetchNCAAFTeamStats error:", teamId, e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// GAMES FOR DATE
// ─────────────────────────────────────────────────────────────
export async function fetchNCAAFGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g, "");
    const data = await cfbFetch(`scoreboard?dates=${compact}&limit=50`);
    if (!data?.events) return [];
    return data.events.map(ev => {
      const comp   = ev.competitions?.[0];
      const home   = comp?.competitors?.find(c => c.homeAway === "home");
      const away   = comp?.competitors?.find(c => c.homeAway === "away");
      const status = comp?.status?.type;
      const wx     = comp?.weather;
      const sameConf = home?.team?.conferenceId && home?.team?.conferenceId === away?.team?.conferenceId;
      return {
        gameId:        ev.id,
        gameDate:      ev.date,
        status:        status?.completed ? "Final" : status?.state === "in" ? "Live" : "Preview",
        detailedState: status?.detail || "",
        homeTeamId:    home?.team?.id,
        awayTeamId:    away?.team?.id,
        homeTeamName:  home?.team?.displayName || home?.team?.name,
        awayTeamName:  away?.team?.displayName || away?.team?.name,
        homeAbbr:      home?.team?.abbreviation || home?.team?.id,
        awayAbbr:      away?.team?.abbreviation || away?.team?.id,
        homeScore:     status?.completed ? parseInt(home?.score) : null,
        awayScore:     status?.completed ? parseInt(away?.score) : null,
        homeRank:      home?.curatedRank?.current <= 25 ? home.curatedRank.current : null,
        awayRank:      away?.curatedRank?.current <= 25 ? away.curatedRank.current : null,
        homeConf:      home?.team?.conferenceId,
        awayConf:      away?.team?.conferenceId,
        week:          ev.week?.number || null,
        season:        ev.season?.year || new Date().getFullYear(),
        neutralSite:   comp?.neutralSite || false,
        conferenceGame: sameConf || false,
        weather: { desc: wx?.displayValue || null, temp: wx?.temperature || null, wind: parseInt(wx?.wind) || 0 },
      };
    }).filter(g => g.homeTeamId && g.awayTeamId);
  } catch (e) {
    console.warn("fetchNCAAFGamesForDate error:", dateStr, e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// WEATHER ADJUSTMENT
// ─────────────────────────────────────────────────────────────
export function ncaafWeatherAdj(wx) {
  if (!wx) return { pts: 0, note: null };
  const temp = wx.temp || 65, wind = wx.wind || 0;
  let pts = 0, notes = [];
  if (temp < 20)      { pts -= 6;   notes.push(`❄ ${temp}°F`); }
  else if (temp < 32) { pts -= 4;   notes.push(`🥶 ${temp}°F`); }
  else if (temp < 40) { pts -= 2;   notes.push(`🥶 ${temp}°F`); }
  if (wind > 25)      { pts -= 5;   notes.push(`💨 ${wind}mph`); }
  else if (wind > 20) { pts -= 3.5; notes.push(`💨 ${wind}mph`); }
  else if (wind > 15) { pts -= 2;   notes.push(`💨 ${wind}mph`); }
  return { pts, note: notes.join(" ") || null };
}

// ─────────────────────────────────────────────────────────────
// NCAAF v14 PREDICTION ENGINE
// SP+ proxy + recruiting depth + FCS filter + conference-strength
// + travel/timezone + PFF-proxy pass-rush + coverage grade
// + Sportradar-proxy injury value + weather + dome + bye week
// ─────────────────────────────────────────────────────────────
export function ncaafPredictGame({
  homeStats, awayStats,
  neutralSite = false,
  weather = {},
  homeRestDays = 7, awayRestDays = 7,
  calibrationFactor = 1.0,
  isConferenceGame = false,
  homeTeamName = "", awayTeamName = "",
  homeInjuries = [], awayInjuries = [],
}) {
  if (!homeStats || !awayStats) return null;

  // ── 1. Base scoring: PPG matchup normalized to league average ──
  const homeOff = (homeStats.ppg - NCAAF_LG_AVG_PPG) / 7;
  const awayDef = (awayStats.oppPpg - NCAAF_LG_AVG_PPG) / 7;
  const awayOff = (awayStats.ppg - NCAAF_LG_AVG_PPG) / 7;
  const homeDef = (homeStats.oppPpg - NCAAF_LG_AVG_PPG) / 7;
  // Off 3.6 / Def 2.6: modern spread offense makes off slightly more predictive
  let homeScore = NCAAF_LG_AVG_PPG + homeOff * 3.6 + awayDef * 2.6;
  let awayScore = NCAAF_LG_AVG_PPG + awayOff * 3.6 + homeDef * 2.6;

  // ── 2. SP+ proxy: blend scoring efficiency + success rate proxies ──
  const spPlusProxy = (stats) => {
    const offSP = (stats.yardsPerPlay - 5.8) * 5.5
                + (stats.redZonePct - 0.60) * 10
                + (stats.thirdPct - 0.40) * 16
                + (stats.ppg - NCAAF_LG_AVG_PPG) * 0.65;
    const defSP = stats.oppPpg != null
      ? (NCAAF_LG_AVG_PPG - stats.oppPpg) * 0.65 + (5.8 - (stats.oppYpPlay || 5.8)) * 5.5
      : 0;
    return { offSP, defSP, net: offSP + defSP };
  };
  const homeSP = spPlusProxy(homeStats);
  const awaySP = spPlusProxy(awayStats);
  homeScore += homeSP.offSP * 0.28 + awaySP.defSP * 0.22;
  awayScore += awaySP.offSP * 0.28 + homeSP.defSP * 0.22;

  // ── 3. Original efficiency overlay (offEff/defEff from ESPN) ──
  homeScore += homeStats.offEff * 13 + awayStats.defEff * 10;
  awayScore += awayStats.offEff * 13 + homeStats.defEff * 10;

  // ── 4. Yards per play differential ──
  const yppAdj = (homeStats.yardsPerPlay - awayStats.oppYpPlay) * 1.9;
  homeScore += yppAdj * 0.22; awayScore -= yppAdj * 0.10;

  // ── 5. Turnover margin (~4.5 pts per net turnover in CFB) ──
  const toAdj = (homeStats.toMargin - awayStats.toMargin) * 2.2;
  homeScore += toAdj * 0.42; awayScore -= toAdj * 0.42;

  // ── 6. Red zone + third down efficiency ──
  const rzAdj = (homeStats.redZonePct - awayStats.redZonePct) * 14;
  homeScore += rzAdj * 0.26; awayScore -= rzAdj * 0.10;
  const tdAdj = (homeStats.thirdPct - awayStats.thirdPct) * 20;
  homeScore += tdAdj * 0.18; awayScore -= tdAdj * 0.08;

  // ── 7. PFF-proxy pass-rush grade: sack rate + YPP allowed ──
  const cfbPassRush = (sacks, oppYpPlay) => {
    const sackBonus   = sacks     != null ? (sacks - 2.5) * 0.22 : 0;
    const yppPressure = oppYpPlay != null ? (5.8 - oppYpPlay) * 0.35 : 0;
    return sackBonus + yppPressure;
  };
  homeScore += cfbPassRush(homeStats.sacks, awayStats.oppYpPlay) * 0.16;
  awayScore += cfbPassRush(awayStats.sacks, homeStats.oppYpPlay) * 0.16;

  // ── 8. Coverage grade proxy: opp passer rating suppression ──
  const cfbCoverageGrade = (oppPasserRtg) => {
    if (oppPasserRtg == null) return 0;
    const lgRtg = 130; // CFB passer rating scale ~0-158
    return (lgRtg - oppPasserRtg) * 0.04;
  };
  homeScore += cfbCoverageGrade(awayStats.oppPasserRating) * 0.18;
  awayScore += cfbCoverageGrade(homeStats.oppPasserRating) * 0.18;

  // ── 9. Recruiting depth baseline (free proxy for talent gap) ──
  const RECRUITING_ELITE  = ["alabama","georgia","ohio state","lsu","texas","usc","notre dame","michigan","penn state","oregon","florida","clemson","oklahoma","texas a&m"];
  const RECRUITING_STRONG = ["auburn","tennessee","arkansas","ole miss","mississippi state","wisconsin","iowa","miami","florida state","washington","utah","kansas state","missouri","baylor"];
  const recruitingBonus = (name) => {
    const n = (name || "").toLowerCase();
    if (RECRUITING_ELITE.some(t => n.includes(t)))  return 1.4;
    if (RECRUITING_STRONG.some(t => n.includes(t))) return 0.7;
    return 0;
  };
  homeScore += recruitingBonus(homeTeamName);
  awayScore += recruitingBonus(awayTeamName);

  // ── 10. Conference familiarity: conference games suppress HFA slightly ──
  const hfaAdj = isConferenceGame ? NCAAF_HOME_FIELD_ADV * 0.85 : NCAAF_HOME_FIELD_ADV;
  if (!neutralSite) { homeScore += hfaAdj / 2; awayScore -= hfaAdj / 2; }

  // ── 11. FCS-filtered rankings: ranked teams get a small efficiency bonus ──
  const isFCSWeak = (name) => {
    const n = (name || "").toLowerCase();
    return ["app state","charlotte","coastal carolina","georgia southern","georgia state",
            "james madison","kennesaw","marshall","middle tennessee","old dominion",
            "south alabama","southern miss","texas state","troy","utep","utsa",
            "western kentucky","rice","north texas","east carolina","uab"].some(t => n.includes(t));
  };
  if (homeStats.rank && homeStats.rank <= 10 && (!awayStats.rank || awayStats.rank > 10) && !isFCSWeak(awayTeamName))
    homeScore += NCAAF_RANKED_BOOST;
  if (awayStats.rank && awayStats.rank <= 10 && (!homeStats.rank || homeStats.rank > 10) && !isFCSWeak(homeTeamName))
    awayScore += NCAAF_RANKED_BOOST;

  // ── 12. Recent form (sample-size gated) ──
  const fw = Math.min(0.12, 0.12 * Math.sqrt(Math.min(homeStats.totalGames, 12) / 12));
  homeScore += homeStats.formScore * fw * 4.8;
  awayScore += awayStats.formScore * fw * 4.8;

  // ── 13. Rest / bye week ──
  if (homeRestDays >= 14) homeScore += 2.5;
  if (awayRestDays >= 14) awayScore += 2.5;
  else if (homeRestDays - awayRestDays >= 4) homeScore += 1.0;
  else if (awayRestDays - homeRestDays >= 4) awayScore += 1.0;

  // ── 14. Altitude (Air Force, Colorado, Utah, Wyoming, UNLV) ──
  if (homeStats.altFactor > 1.0 && !neutralSite) {
    homeScore *= homeStats.altFactor;
    awayScore *= (1 / homeStats.altFactor);
  }

  // ── 15. Travel distance: long road trips hurt away teams ──
  const NCAAF_CITY_COORDS = {
    "alabama":{lat:33.2,lng:-87.5},"georgia":{lat:33.9,lng:-83.4},"ohio state":{lat:40.0,lng:-83.0},
    "michigan":{lat:42.3,lng:-83.7},"lsu":{lat:30.4,lng:-91.2},"texas":{lat:30.3,lng:-97.7},
    "usc":{lat:34.0,lng:-118.3},"notre dame":{lat:41.7,lng:-86.2},"penn state":{lat:40.8,lng:-77.9},
    "oregon":{lat:44.0,lng:-123.1},"florida":{lat:29.6,lng:-82.3},"clemson":{lat:34.7,lng:-82.8},
    "oklahoma":{lat:35.2,lng:-97.4},"utah":{lat:40.8,lng:-111.9},"washington":{lat:47.7,lng:-122.3},
    "air force":{lat:38.9,lng:-104.8},"colorado":{lat:40.0,lng:-105.3},"wyoming":{lat:41.3,lng:-105.6},
  };
  const getCoords = (name) => {
    const n = (name || "").toLowerCase();
    for (const [k, v] of Object.entries(NCAAF_CITY_COORDS)) { if (n.includes(k)) return v; }
    return null;
  };
  const c1 = getCoords(awayTeamName), c2 = getCoords(homeTeamName);
  if (c1 && c2) {
    const R = 3959, toRad = d => d * Math.PI / 180;
    const a = Math.sin(toRad((c2.lat - c1.lat) / 2)) ** 2
            + Math.cos(toRad(c1.lat)) * Math.cos(toRad(c2.lat))
            * Math.sin(toRad((c2.lng - c1.lng) / 2)) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (dist > 2000)      awayScore -= 1.4;
    else if (dist > 1000) awayScore -= 0.7;
    const tzCrossings = Math.abs(c2.lng - c1.lng) / 15;
    if (tzCrossings >= 3) awayScore -= 0.9;
  }

  // ── 16. Injury impact (key skill position players) ──
  const injRoleWeights = { starter:2.0, rotation:1.0, reserve:0.4 };
  const homeInjPenalty = (homeInjuries || []).reduce((s, p) => s + (injRoleWeights[p.role] || 1.0), 0);
  const awayInjPenalty = (awayInjuries || []).reduce((s, p) => s + (injRoleWeights[p.role] || 1.0), 0);
  homeScore -= homeInjPenalty;
  awayScore -= awayInjPenalty;

  // ── 17. Weather ──
  const wxAdj = ncaafWeatherAdj(weather);
  homeScore += wxAdj.pts / 2; awayScore += wxAdj.pts / 2;

  homeScore = Math.max(3, Math.min(72, homeScore));
  awayScore = Math.max(3, Math.min(72, awayScore));

  const spread = parseFloat((homeScore - awayScore).toFixed(1));
  // CFB logistic sigma = 16.0 (wider distribution; FBS has 50+ pt blowouts vs FCS regularly)
  let hwp = 1 / (1 + Math.pow(10, -spread / 16.0));
  hwp = Math.min(0.96, Math.max(0.04, hwp));
  if (calibrationFactor !== 1.0)
    hwp = Math.min(0.96, Math.max(0.04, 0.5 + (hwp - 0.5) * calibrationFactor));

  const mml = hwp >= 0.5 ? -Math.round((hwp / (1 - hwp)) * 100) : +Math.round(((1 - hwp) / hwp) * 100);
  const aml = hwp >= 0.5 ? +Math.round(((1 - hwp) / hwp) * 100) : -Math.round((hwp / (1 - hwp)) * 100);

  const emGap = Math.abs(homeStats.adjEM - awayStats.adjEM);
  const wps   = Math.abs(hwp - 0.5) * 2;
  const minG  = Math.min(homeStats.totalGames, awayStats.totalGames);
  const samp  = Math.min(1.0, minG / 8);
  const effQ  = Math.min(1, (
    Math.abs(homeStats.offEff) + Math.abs(homeStats.defEff) +
    Math.abs(awayStats.offEff) + Math.abs(awayStats.defEff)
  ) / 0.3);
  const cs = Math.round(
    (Math.min(emGap, 20) / 20) * 35 + wps * 30 + samp * 22 + effQ * 8 + (minG >= 4 ? 5 : 0)
  );
  const confidence = cs >= 62 ? "HIGH" : cs >= 35 ? "MEDIUM" : "LOW";

  const factors = [];
  if (Math.abs(toAdj) > 1.5)
    factors.push({ label:"Turnover Margin", val:toAdj > 0 ? `HOME +${toAdj.toFixed(1)}` : `AWAY +${(-toAdj).toFixed(1)}`, type:toAdj > 0 ? "home" : "away" });
  if (Math.abs(homeStats.adjEM - awayStats.adjEM) > 5)
    factors.push({ label:"Efficiency Gap", val:homeStats.adjEM > awayStats.adjEM ? `HOME +${(homeStats.adjEM - awayStats.adjEM).toFixed(1)} adjEM` : `AWAY +${(awayStats.adjEM - homeStats.adjEM).toFixed(1)} adjEM`, type:homeStats.adjEM > awayStats.adjEM ? "home" : "away" });
  if (homeStats.rank && homeStats.rank <= 25)
    factors.push({ label:"Ranked", val:`HOME #${homeStats.rank}`, type:"home" });
  if (awayStats.rank && awayStats.rank <= 25)
    factors.push({ label:"Ranked", val:`AWAY #${awayStats.rank}`, type:"away" });
  if (Math.abs(homeStats.formScore - awayStats.formScore) > 0.15)
    factors.push({ label:"Recent Form", val:homeStats.formScore > awayStats.formScore ? "HOME hot" : "AWAY hot", type:homeStats.formScore > awayStats.formScore ? "home" : "away" });
  if (homeRestDays >= 14) factors.push({ label:"Bye Week", val:"HOME rested", type:"home" });
  if (awayRestDays >= 14) factors.push({ label:"Bye Week", val:"AWAY rested", type:"away" });
  if (!neutralSite) factors.push({ label:"Home Field", val:`+${hfaAdj.toFixed(1)} pts`, type:"home" });
  if (homeStats.altFactor > 1.0) factors.push({ label:"Altitude", val:`+${((homeStats.altFactor - 1) * 100).toFixed(0)}% home boost`, type:"home" });
  if (wxAdj.note) factors.push({ label:"Weather", val:wxAdj.note, type:"neutral" });

  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct: hwp, awayWinPct: 1 - hwp,
    projectedSpread: spread,
    ouTotal: parseFloat((homeScore + awayScore).toFixed(1)),
    modelML_home: mml, modelML_away: aml,
    confidence, confScore: cs,
    homeAdjEM: parseFloat(homeStats.adjEM?.toFixed(2)),
    awayAdjEM: parseFloat(awayStats.adjEM?.toFixed(2)),
    homeSPP: parseFloat(homeSP.net?.toFixed(1)),
    awaySPP: parseFloat(awaySP.net?.toFixed(1)),
    weather: wxAdj, factors, neutralSite,
  };
}

// ─────────────────────────────────────────────────────────────
// ODDS MATCHING
// ─────────────────────────────────────────────────────────────
export function matchNCAAFOddsToGame(o, g) {
  if (!o || !g) return false;
  const n  = s => (s || "").toLowerCase().replace(/[\s\W]/g, "");
  const hN = n(g.homeTeamName || "");
  const aN = n(g.awayTeamName || "");
  const oH = n(o.homeTeam || "");
  const oA = n(o.awayTeam || "");
  return (oH.includes(hN.slice(0, 6)) || hN.includes(oH.slice(0, 6))) &&
         (oA.includes(aN.slice(0, 6)) || aN.includes(oA.slice(0, 6)));
}

// ─────────────────────────────────────────────────────────────
// FILL FINAL SCORES
// ─────────────────────────────────────────────────────────────
export async function ncaafFillFinalScores(pendingRows) {
  if (!pendingRows.length) return 0;
  let filled = 0;
  const byDate = {};
  for (const r of pendingRows) {
    if (!byDate[r.game_date]) byDate[r.game_date] = [];
    byDate[r.game_date].push(r);
  }
  for (const [dateStr, rows] of Object.entries(byDate)) {
    try {
      const games = await fetchNCAAFGamesForDate(dateStr);
      for (const g of games) {
        if (g.status !== "Final" || g.homeScore === null) continue;
        const row = rows.find(r =>
          (r.game_id && r.game_id === g.gameId) ||
          (r.home_team_id && r.home_team_id === g.homeTeamId && r.away_team_id === g.awayTeamId)
        );
        if (!row) continue;
        const hW     = g.homeScore > g.awayScore;
        const mH     = (row.win_pct_home ?? 0.5) >= 0.5;
        const ml     = mH ? hW : !hW;
        const margin = g.homeScore - g.awayScore;
        const mktSpr = row.market_spread_home ?? null;
        let rl = null;
        if (mktSpr !== null) {
          if (margin > mktSpr) rl = true;
          else if (margin < mktSpr) rl = false;
        } else {
          const ps = row.spread_home || 0;
          if (margin === 0) rl = null;
          else rl = (margin > 0 && ps > 0) || (margin < 0 && ps < 0);
        }
        const total = g.homeScore + g.awayScore;
        const ouL   = row.market_ou_total ?? row.ou_total ?? null;
        const predT = (row.pred_home_score ?? 0) + (row.pred_away_score ?? 0);
        let ou = null;
        if (ouL !== null && total !== ouL) ou = ((total > ouL) === (predT > ouL)) ? "OVER" : "UNDER";
        else if (ouL !== null && total === ouL) ou = "PUSH";
        await supabaseQuery(`/ncaaf_predictions?id=eq.${row.id}`, "PATCH", {
          actual_home_score: g.homeScore, actual_away_score: g.awayScore,
          result_entered: true, ml_correct: ml, rl_correct: rl, ou_correct: ou,
        });
        filled++;
      }
    } catch (e) { console.warn("ncaafFillFinalScores:", dateStr, e); }
  }
  return filled;
}
