import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine
} from "recharts";

// ============================================================
// MLB PREDICTOR v6 — HISTORY + PARLAY + SEASON ACCURACY
// New in v6:
//   • History tab  — saves every prediction to Supabase
//   • Season Accuracy banner — ML, ATS, O/U, by confidence tier
//   • Parlay tab   — pick leg count, auto-suggests highest-prob games
//   • Result entry — mark actual outcomes to drive accuracy tracking
// ============================================================

// ── SUPABASE CONFIG ──────────────────────────────────────────
// Replace with your project URL and anon key
const SUPABASE_URL = https://lxaaqtqvlwjvyuedyauo.supabase.co;
const SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWFxdHF2bHdqdnl1ZWR5YXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDYzNTUsImV4cCI6MjA4NzM4MjM1NX0.UItPw2j2oo5F2_zJZmf43gmZnNHVQ5FViQgbd4QEii0;

async function supabaseQuery(path, method = "GET", body = null) {
  try {
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": method === "POST" ? "return=representation" : "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
    if (!res.ok) {
      const err = await res.text();
      console.error("Supabase error:", err);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) {
    console.error("Supabase fetch failed:", e);
    return null;
  }
}

// Supabase SQL to create the table (run once in Supabase SQL editor):
// CREATE TABLE mlb_predictions (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   game_date date NOT NULL,
//   home_team text NOT NULL,
//   away_team text NOT NULL,
//   model_ml_home integer,
//   model_ml_away integer,
//   run_line_home numeric,
//   run_line_away numeric,
//   ou_total numeric,
//   win_pct_home numeric,
//   confidence text,
//   pred_home_runs numeric,
//   pred_away_runs numeric,
//   actual_home_runs integer,
//   actual_away_runs integer,
//   result_entered boolean DEFAULT false,
//   ml_correct boolean,
//   rl_correct boolean,
//   ou_correct text,
//   created_at timestamptz DEFAULT now()
// );

// ── MLB API ───────────────────────────────────────────────────
const MLB_API  = "https://statsapi.mlb.com/api/v1";
const ODDS_API_KEY = ""; // optional: the-odds-api.com free key
const SEASON   = new Date().getFullYear();

// ── TEAMS ─────────────────────────────────────────────────────
const TEAMS = [
  { id: 108, name: "Angels",      abbr: "LAA", league: "AL" },
  { id: 109, name: "D-backs",     abbr: "ARI", league: "NL" },
  { id: 110, name: "Orioles",     abbr: "BAL", league: "AL" },
  { id: 111, name: "Red Sox",     abbr: "BOS", league: "AL" },
  { id: 112, name: "Cubs",        abbr: "CHC", league: "NL" },
  { id: 113, name: "Reds",        abbr: "CIN", league: "NL" },
  { id: 114, name: "Guardians",   abbr: "CLE", league: "AL" },
  { id: 115, name: "Rockies",     abbr: "COL", league: "NL" },
  { id: 116, name: "Tigers",      abbr: "DET", league: "AL" },
  { id: 117, name: "Astros",      abbr: "HOU", league: "AL" },
  { id: 118, name: "Royals",      abbr: "KC",  league: "AL" },
  { id: 119, name: "Dodgers",     abbr: "LAD", league: "NL" },
  { id: 120, name: "Nationals",   abbr: "WSH", league: "NL" },
  { id: 121, name: "Mets",        abbr: "NYM", league: "NL" },
  { id: 133, name: "Athletics",   abbr: "OAK", league: "AL" },
  { id: 134, name: "Pirates",     abbr: "PIT", league: "NL" },
  { id: 135, name: "Padres",      abbr: "SD",  league: "NL" },
  { id: 136, name: "Mariners",    abbr: "SEA", league: "AL" },
  { id: 137, name: "Giants",      abbr: "SF",  league: "NL" },
  { id: 138, name: "Cardinals",   abbr: "STL", league: "NL" },
  { id: 139, name: "Rays",        abbr: "TB",  league: "AL" },
  { id: 140, name: "Rangers",     abbr: "TEX", league: "AL" },
  { id: 141, name: "Blue Jays",   abbr: "TOR", league: "AL" },
  { id: 142, name: "Twins",       abbr: "MIN", league: "AL" },
  { id: 143, name: "Phillies",    abbr: "PHI", league: "NL" },
  { id: 144, name: "Braves",      abbr: "ATL", league: "NL" },
  { id: 145, name: "White Sox",   abbr: "CWS", league: "AL" },
  { id: 146, name: "Marlins",     abbr: "MIA", league: "NL" },
  { id: 147, name: "Yankees",     abbr: "NYY", league: "AL" },
  { id: 158, name: "Brewers",     abbr: "MIL", league: "NL" },
];
const teamById = (id) => TEAMS.find(t => t.id === id) || { name: "Unknown", abbr: "UNK" };

// ── PARK FACTORS ──────────────────────────────────────────────
const PARK_FACTORS = {
  108: { runFactor: 1.02, hrFactor: 1.05, name: "Angel Stadium" },
  109: { runFactor: 1.03, hrFactor: 1.02, name: "Chase Field" },
  110: { runFactor: 0.95, hrFactor: 0.91, name: "Camden Yards" },
  111: { runFactor: 1.04, hrFactor: 1.08, name: "Fenway Park" },
  112: { runFactor: 1.04, hrFactor: 1.07, name: "Wrigley Field" },
  113: { runFactor: 1.00, hrFactor: 1.01, name: "Great American" },
  114: { runFactor: 0.97, hrFactor: 0.95, name: "Progressive Field" },
  115: { runFactor: 1.16, hrFactor: 1.19, name: "Coors Field" },
  116: { runFactor: 0.98, hrFactor: 0.96, name: "Comerica Park" },
  117: { runFactor: 0.99, hrFactor: 0.97, name: "Minute Maid" },
  118: { runFactor: 1.01, hrFactor: 1.00, name: "Kauffman Stadium" },
  119: { runFactor: 1.00, hrFactor: 1.01, name: "Dodger Stadium" },
  120: { runFactor: 1.01, hrFactor: 1.02, name: "Nationals Park" },
  121: { runFactor: 1.03, hrFactor: 1.06, name: "Citi Field" },
  133: { runFactor: 0.99, hrFactor: 0.98, name: "Oakland Coliseum" },
  134: { runFactor: 0.96, hrFactor: 0.93, name: "PNC Park" },
  135: { runFactor: 0.95, hrFactor: 0.92, name: "Petco Park" },
  136: { runFactor: 0.94, hrFactor: 0.90, name: "T-Mobile Park" },
  137: { runFactor: 0.91, hrFactor: 0.88, name: "Oracle Park" },
  138: { runFactor: 0.97, hrFactor: 0.95, name: "Busch Stadium" },
  139: { runFactor: 0.96, hrFactor: 0.94, name: "Tropicana Field" },
  140: { runFactor: 1.05, hrFactor: 1.08, name: "Globe Life Field" },
  141: { runFactor: 1.03, hrFactor: 1.04, name: "Rogers Centre" },
  142: { runFactor: 1.00, hrFactor: 0.99, name: "Target Field" },
  143: { runFactor: 1.06, hrFactor: 1.09, name: "Citizens Bank" },
  144: { runFactor: 1.02, hrFactor: 1.04, name: "Truist Park" },
  145: { runFactor: 1.00, hrFactor: 1.00, name: "Guaranteed Rate" },
  146: { runFactor: 0.97, hrFactor: 0.96, name: "loanDepot Park" },
  147: { runFactor: 1.05, hrFactor: 1.10, name: "Yankee Stadium" },
  158: { runFactor: 0.97, hrFactor: 0.95, name: "American Family Field" },
};

// ── PREDICTION ENGINE ─────────────────────────────────────────
function predictGame({ homeTeamId, awayTeamId, homeHit, awayHit, homePitch, awayPitch,
                        homeStarterStats, awayStarterStats, homeForm, awayForm, bullpenData }) {
  const park = PARK_FACTORS[homeTeamId] || { runFactor: 1.0, hrFactor: 1.0 };
  const wOBA = (h) => {
    if (!h) return 0.320;
    const { obp = 0.320, slg = 0.420, avg = 0.250 } = h;
    return Math.max(0.25, Math.min(0.42, 0.69 * (obp - avg) + 0.89 * avg + 1.27 * (slg - avg) * 0.9 + 0.05));
  };

  let hr = 4.5, ar = 4.5;
  hr += (wOBA(homeHit) - 0.320) * 14;
  ar += (wOBA(awayHit) - 0.320) * 14;

  const hFIP = homeStarterStats?.fip || (homePitch ? homePitch.era * 0.82 + homePitch.whip * 0.4 : 4.25);
  const aFIP = awayStarterStats?.fip  || (awayPitch  ? awayPitch.era  * 0.82 + awayPitch.whip  * 0.4 : 4.25);
  ar += (hFIP - 4.25) * 0.35;
  hr += (aFIP - 4.25) * 0.35;

  hr *= park.runFactor;
  ar *= park.runFactor;

  if (homeForm?.formScore) hr += homeForm.formScore * 0.3;
  if (awayForm?.formScore) ar += awayForm.formScore * 0.3;
  if (homeForm?.luckFactor) hr -= homeForm.luckFactor * 0.2;
  if (awayForm?.luckFactor) ar -= awayForm.luckFactor * 0.2;

  const bpHome = bullpenData?.[homeTeamId];
  const bpAway = bullpenData?.[awayTeamId];
  if (bpHome?.fatigued) ar += 0.3;
  if (bpAway?.fatigued) hr += 0.3;

  hr = Math.max(1.5, Math.min(10, hr));
  ar = Math.max(1.5, Math.min(10, ar));

  const homeAdv = 0.038;
  const lambda = hr / ar;
  const hwp = Math.min(0.85, Math.max(0.15, 0.5 + (Math.log(lambda) * 0.6) + homeAdv));

  let confScore = 50;
  if (homeStarterStats) confScore += 12;
  if (awayStarterStats) confScore += 12;
  if (homeForm) confScore += 8;
  if (awayForm) confScore += 8;
  if (bullpenData) confScore += 10;

  const confidence = confScore >= 85 ? "HIGH" : confScore >= 65 ? "MEDIUM" : "LOW";

  const modelML_home = hwp >= 0.5
    ? -Math.round((hwp / (1 - hwp)) * 100)
    : Math.round(((1 - hwp) / hwp) * 100);
  const modelML_away = hwp >= 0.5
    ? Math.round(((1 - hwp) / hwp) * 100)
    : -Math.round((hwp / (1 - hwp)) * 100);

  return { homeRuns: hr, awayRuns: ar, homeWinPct: hwp, awayWinPct: 1 - hwp,
           confidence, confScore, modelML_home, modelML_away,
           ouTotal: parseFloat((hr + ar).toFixed(1)),
           runLineHome: -1.5, runLinePct: hwp > 0.65 ? hwp - 0.12 : hwp - 0.18 };
}

// ── MLB API HELPERS ───────────────────────────────────────────
function getGameTypes(dateStr) {
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  if (m >= 2 && m <= 3) return "S";
  if (m >= 10) return "P";
  return "R";
}

async function fetchScheduleForDate(dateStr) {
  const gameType = getGameTypes(dateStr);
  const url = `${MLB_API}/schedule?sportId=1&date=${dateStr}&gameType=${gameType}&hydrate=probablePitcher,teams,venue,broadcasts`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const games = [];
    for (const d of (data?.dates || [])) {
      for (const g of (d.games || [])) {
        games.push({
          gamePk: g.gamePk,
          gameDate: g.gameDate,
          status: g.status?.abstractGameState,
          homeTeamId: g.teams?.home?.team?.id,
          awayTeamId: g.teams?.away?.team?.id,
          homeScore: g.teams?.home?.score,
          awayScore: g.teams?.away?.score,
          homeStarter: g.teams?.home?.probablePitcher?.fullName || null,
          awayStarter: g.teams?.away?.probablePitcher?.fullName || null,
          homeStarterId: g.teams?.home?.probablePitcher?.id || null,
          awayStarterId: g.teams?.away?.probablePitcher?.id || null,
          venue: g.venue?.name,
        });
      }
    }
    return games;
  } catch { return []; }
}

async function fetchTeamHitting(teamId) {
  const url = `${MLB_API}/teams/${teamId}/stats?stats=season&group=hitting&season=${SEASON}&sportId=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return { avg: parseFloat(s.avg)||0.250, obp: parseFloat(s.obp)||0.320, slg: parseFloat(s.slg)||0.420, ops: parseFloat(s.ops)||0.740 };
  } catch { return null; }
}

async function fetchTeamPitching(teamId) {
  const url = `${MLB_API}/teams/${teamId}/stats?stats=season&group=pitching&season=${SEASON}&sportId=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return { era: parseFloat(s.era)||4.00, whip: parseFloat(s.whip)||1.30 };
  } catch { return null; }
}

async function fetchStarterStats(pitcherId) {
  if (!pitcherId) return null;
  const url = `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${SEASON}&sportId=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const s = data?.stats?.[0]?.splits?.[0]?.stat || {};
    const era = parseFloat(s.era) || 4.50;
    const whip = parseFloat(s.whip) || 1.35;
    const k9 = parseFloat(s.strikeoutsPer9Inn) || 8.0;
    const bb9 = parseFloat(s.walksPer9Inn) || 3.2;
    const fip = parseFloat(s.fip) || (era * 0.82 + whip * 0.4);
    return { era, whip, k9, bb9, fip };
  } catch { return null; }
}

async function fetchRecentForm(teamId, numGames = 15) {
  const today = new Date().toISOString().split("T")[0];
  const url = `${MLB_API}/schedule?teamId=${teamId}&season=${SEASON}&gameType=S,R&startDate=${SEASON}-01-01&endDate=${today}&hydrate=linescore`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const games = [];
    for (const d of (data?.dates || [])) {
      for (const g of (d.games || [])) {
        if (g.status?.abstractGameState === "Final") {
          const isHome = g.teams?.home?.team?.id === teamId;
          const my = isHome ? g.teams?.home : g.teams?.away;
          const op = isHome ? g.teams?.away : g.teams?.home;
          games.push({ win: my?.isWinner || false, rs: my?.score || 0, ra: op?.score || 0 });
        }
      }
    }
    const recent = games.slice(-numGames);
    if (!recent.length) return null;
    const rf = recent.reduce((s, g) => s + g.rs, 0);
    const ra = recent.reduce((s, g) => s + g.ra, 0);
    const wins = recent.filter(g => g.win).length;
    const pyth = Math.pow(rf, 1.83) / (Math.pow(rf, 1.83) + Math.pow(ra, 1.83));
    const actualWP = wins / recent.length;
    const formScore = recent.slice(-5).reduce((s, g, i) => s + (g.win ? 1 : -0.6) * (i + 1), 0) / 15;
    return { winPct: actualWP, pythWinPct: pyth, luckFactor: actualWP - pyth, formScore };
  } catch { return null; }
}

// ── BANNER COLOR ──────────────────────────────────────────────
function getBannerColor(pred, hasStarter) {
  if (!pred || !hasStarter) return "yellow";
  if (pred.homeWinPct >= 0.60) return "green";
  if (pred.homeWinPct <= 0.40) return "green";
  return "neutral";
}

// ── PARLAY ODDS CALCULATOR ────────────────────────────────────
function mlToDecimal(ml) {
  if (ml >= 100) return ml / 100 + 1;
  return 100 / Math.abs(ml) + 1;
}
function combinedParlayOdds(legs) {
  return legs.reduce((acc, leg) => acc * mlToDecimal(leg.ml), 1);
}
function combinedParlayProbability(legs) {
  return legs.reduce((acc, leg) => acc * leg.prob, 1);
}
function decimalToML(dec) {
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}

// ── ACCURACY HELPERS ──────────────────────────────────────────
function computeAccuracy(records) {
  const withResults = records.filter(r => r.result_entered);
  if (!withResults.length) return null;
  const ml = withResults.filter(r => r.ml_correct !== null);
  const rl = withResults.filter(r => r.rl_correct !== null);
  const ou = withResults.filter(r => r.ou_correct !== null);
  const tiers = { HIGH: { total: 0, correct: 0 }, MEDIUM: { total: 0, correct: 0 }, LOW: { total: 0, correct: 0 } };
  withResults.forEach(r => {
    if (r.confidence && tiers[r.confidence]) {
      tiers[r.confidence].total++;
      if (r.ml_correct) tiers[r.confidence].correct++;
    }
  });
  return {
    total: withResults.length,
    mlAcc: ml.length ? (ml.filter(r => r.ml_correct).length / ml.length * 100).toFixed(1) : null,
    rlAcc: rl.length ? (rl.filter(r => r.rl_correct).length / rl.length * 100).toFixed(1) : null,
    ouAcc: ou.length ? (ou.filter(r => r.ou_correct === "OVER" || r.ou_correct === "UNDER").length / ou.length * 100).toFixed(1) : null,
    tiers,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab] = useState("calendar");
  const tabs = [
    { id: "calendar",  label: "📅 Calendar" },
    { id: "history",   label: "📊 History" },
    { id: "parlay",    label: "🎯 Parlay" },
    { id: "matchup",   label: "⚾ Matchup" },
  ];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#0d1117", minHeight: "100vh", color: "#e6edf3" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #161b22 0%, #1a2332 100%)", borderBottom: "1px solid #30363d", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 28 }}>⚾</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#58a6ff", letterSpacing: 1 }}>MLB PREDICTOR v6</div>
            <div style={{ fontSize: 11, color: "#8b949e", letterSpacing: 2 }}>HISTORY · PARLAY · SEASON ACCURACY</div>
          </div>
        </div>
        {/* Season Accuracy Banner */}
        <SeasonAccuracyBanner />
        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
                background: activeTab === t.id ? "#58a6ff" : "#21262d",
                color: activeTab === t.id ? "#0d1117" : "#8b949e",
                transition: "all 0.15s",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {activeTab === "calendar" && <CalendarTab />}
        {activeTab === "history"  && <HistoryTab />}
        {activeTab === "parlay"   && <ParlayTab />}
        {activeTab === "matchup"  && <MatchupTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEASON ACCURACY BANNER
// ═══════════════════════════════════════════════════════════════
function SeasonAccuracyBanner() {
  const [acc, setAcc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await supabaseQuery(`/mlb_predictions?result_entered=eq.true&select=ml_correct,rl_correct,ou_correct,confidence`);
      if (data && data.length) setAcc(computeAccuracy(data));
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div style={{ background: "#21262d", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#8b949e" }}>
      Loading season accuracy...
    </div>
  );
  if (!acc) return (
    <div style={{ background: "#21262d", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#8b949e" }}>
      📈 Season accuracy will appear once results are logged — enter outcomes in the History tab.
    </div>
  );

  const statBox = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "#58a6ff" }}>{val ?? "—"}%</div>
      <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1 }}>{label}</div>
    </div>
  );

  const tierColor = (t) => {
    if (!t.total) return "#8b949e";
    const pct = t.correct / t.total;
    return pct >= 0.60 ? "#3fb950" : pct >= 0.50 ? "#e3b341" : "#f85149";
  };

  return (
    <div style={{ background: "linear-gradient(90deg, #1a2332, #162032)", border: "1px solid #30363d", borderRadius: 10, padding: "12px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e3b341" }}>📈 SEASON ACCURACY</span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>({acc.total} games graded)</span>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {statBox("MONEYLINE", acc.mlAcc, acc.mlAcc >= 55 ? "#3fb950" : "#f85149")}
          {statBox("RUN LINE", acc.rlAcc, acc.rlAcc >= 52 ? "#3fb950" : "#f85149")}
          {statBox("O/U", acc.ouAcc, acc.ouAcc >= 50 ? "#3fb950" : "#f85149")}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {["HIGH", "MEDIUM", "LOW"].map(tier => (
            <div key={tier} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: tierColor(acc.tiers[tier]) }}>
                {acc.tiers[tier].total ? `${Math.round(acc.tiers[tier].correct / acc.tiers[tier].total * 100)}%` : "—"}
              </div>
              <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: 1 }}>{tier}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════════
function CalendarTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setGames([]);
    const raw = await fetchScheduleForDate(d);
    setGames(raw.map(g => ({ ...g, pred: null, loading: true })));

    // Enrich each game
    const enriched = await Promise.all(raw.map(async (g) => {
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(g.homeTeamId),
          fetchTeamHitting(g.awayTeamId),
          fetchTeamPitching(g.homeTeamId),
          fetchTeamPitching(g.awayTeamId),
          fetchStarterStats(g.homeStarterId),
          fetchStarterStats(g.awayStarterId),
          fetchRecentForm(g.homeTeamId),
          fetchRecentForm(g.awayTeamId),
        ]);
      const pred = predictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm,
      });
      return { ...g, homeHit, awayHit, homePitch, awayPitch, homeStarterStats: homeStarter,
               awayStarterStats: awayStarter, homeForm, awayForm, pred, loading: false };
    }));
    setGames(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  // Check which games are already saved
  useEffect(() => {
    (async () => {
      const existing = await supabaseQuery(`/mlb_predictions?game_date=eq.${dateStr}&select=home_team,away_team`);
      if (existing) {
        setSavedIds(new Set(existing.map(r => `${r.away_team}@${r.home_team}`)));
      }
    })();
  }, [dateStr]);

  const saveGame = async (game) => {
    if (!game.pred) return;
    const homeTeam = teamById(game.homeTeamId);
    const awayTeam = teamById(game.awayTeamId);
    const key = `${awayTeam.abbr}@${homeTeam.abbr}`;
    const row = {
      game_date: dateStr,
      home_team: homeTeam.abbr,
      away_team: awayTeam.abbr,
      model_ml_home: game.pred.modelML_home,
      model_ml_away: game.pred.modelML_away,
      run_line_home: game.pred.runLineHome,
      run_line_away: -game.pred.runLineHome,
      ou_total: game.pred.ouTotal,
      win_pct_home: parseFloat(game.pred.homeWinPct.toFixed(4)),
      confidence: game.pred.confidence,
      pred_home_runs: parseFloat(game.pred.homeRuns.toFixed(2)),
      pred_away_runs: parseFloat(game.pred.awayRuns.toFixed(2)),
    };
    const result = await supabaseQuery("/mlb_predictions", "POST", row);
    if (result) setSavedIds(prev => new Set([...prev, key]));
    else alert("Save failed — check Supabase config");
  };

  const saveAll = async () => {
    for (const g of games) {
      if (!g.loading && g.pred) await saveGame(g);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 14 }} />
        <button onClick={() => loadGames(dateStr)}
          style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>
          🔄 Refresh
        </button>
        {games.length > 0 && (
          <button onClick={saveAll}
            style={{ background: "#1f6feb", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>
            💾 Save All to History
          </button>
        )}
        {loading && <span style={{ color: "#8b949e", fontSize: 13 }}>Loading games...</span>}
      </div>

      {!loading && games.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40, fontSize: 14 }}>
          No games scheduled for {dateStr}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {games.map((game) => {
          const home = teamById(game.homeTeamId);
          const away = teamById(game.awayTeamId);
          const key = `${away.abbr}@${home.abbr}`;
          const color = game.loading ? "yellow" : getBannerColor(game.pred, game.homeStarter && game.awayStarter);
          const bannerBg = color === "green" ? "linear-gradient(135deg, #0d2818, #162d1a)"
            : color === "yellow" ? "linear-gradient(135deg, #2d2500, #2a2200)"
            : color === "neutral" ? "linear-gradient(135deg, #161b22, #1c2128)"
            : "linear-gradient(135deg, #2d0e0e, #2a1010)";
          const borderColor = color === "green" ? "#2ea043"
            : color === "yellow" ? "#e3b341"
            : color === "neutral" ? "#30363d"
            : "#f85149";
          const isOpen = expanded === game.gamePk;

          return (
            <div key={game.gamePk} style={{ background: bannerBg, border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : game.gamePk)}
                style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                {/* Teams */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3" }}>{away.abbr}</div>
                    <div style={{ fontSize: 10, color: "#8b949e" }}>AWAY</div>
                    {game.awayStarter && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{game.awayStarter.split(" ").pop()}</div>}
                  </div>
                  <div style={{ fontSize: 18, color: "#8b949e" }}>@</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e6edf3" }}>{home.abbr}</div>
                    <div style={{ fontSize: 10, color: "#8b949e" }}>HOME</div>
                    {game.homeStarter && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{game.homeStarter.split(" ").pop()}</div>}
                  </div>
                </div>

                {/* Prediction stats */}
                {game.loading ? (
                  <div style={{ color: "#8b949e", fontSize: 12 }}>Calculating...</div>
                ) : game.pred ? (
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <StatPill label="MODEL ML" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    <StatPill label="RUN LINE" value={`${home.abbr} -1.5`} />
                    <StatPill label="O/U" value={game.pred.ouTotal} />
                    <StatPill label="WIN %" value={`${Math.round(game.pred.homeWinPct * 100)}%`} color={game.pred.homeWinPct >= 0.55 ? "#3fb950" : "#e6edf3"} />
                    <StatPill label="CONF" value={game.pred.confidence}
                      color={game.pred.confidence === "HIGH" ? "#3fb950" : game.pred.confidence === "MEDIUM" ? "#e3b341" : "#8b949e"} />
                  </div>
                ) : (
                  <div style={{ color: "#8b949e", fontSize: 12 }}>⚠ Prediction unavailable</div>
                )}

                {/* Save / status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {savedIds.has(key)
                    ? <span style={{ fontSize: 11, color: "#3fb950" }}>✓ Saved</span>
                    : game.pred && !game.loading && (
                      <button onClick={e => { e.stopPropagation(); saveGame(game); }}
                        style={{ background: "#1f6feb", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>
                        💾 Save
                      </button>
                    )
                  }
                  <span style={{ color: "#8b949e", fontSize: 16 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Expanded details */}
              {isOpen && game.pred && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: "16px 20px", background: "rgba(0,0,0,0.3)" }}>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <Detail label="Proj Score" value={`${away.abbr} ${game.pred.awayRuns.toFixed(1)} — ${home.abbr} ${game.pred.homeRuns.toFixed(1)}`} />
                    <Detail label="Home Win %" value={`${(game.pred.homeWinPct * 100).toFixed(1)}%`} />
                    <Detail label="Away Win %" value={`${(game.pred.awayWinPct * 100).toFixed(1)}%`} />
                    <Detail label="Over/Under" value={`${game.pred.ouTotal} total`} />
                    <Detail label="Model ML (H)" value={game.pred.modelML_home > 0 ? `+${game.pred.modelML_home}` : game.pred.modelML_home} />
                    <Detail label="Model ML (A)" value={game.pred.modelML_away > 0 ? `+${game.pred.modelML_away}` : game.pred.modelML_away} />
                    <Detail label="Confidence" value={game.pred.confidence} />
                    <Detail label="Conf Score" value={`${game.pred.confScore}/100`} />
                  </div>
                  {(game.homeStarter || game.awayStarter) && (
                    <div style={{ marginTop: 12, display: "flex", gap: 16 }}>
                      {game.awayStarter && <Detail label={`${away.abbr} SP`} value={game.awayStarter} />}
                      {game.homeStarter && <Detail label={`${home.abbr} SP`} value={game.homeStarter} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════
function HistoryTab() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [entering, setEntering] = useState(null); // id of row being edited
  const [resultForm, setResultForm] = useState({ actual_home: "", actual_away: "" });

  const load = useCallback(async () => {
    setLoading(true);
    let path = "/mlb_predictions?order=game_date.desc&limit=200";
    if (filterDate) path += `&game_date=eq.${filterDate}`;
    const data = await supabaseQuery(path);
    setRecords(data || []);
    setLoading(false);
  }, [filterDate]);

  useEffect(() => { load(); }, [load]);

  const enterResult = async (id) => {
    const home = parseInt(resultForm.actual_home);
    const away = parseInt(resultForm.actual_away);
    if (isNaN(home) || isNaN(away)) return alert("Enter valid scores");
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    const ml_correct = home > away ? true : false;
    const rl_correct = (home - away) > 1.5 ? true : (away - home) > 1.5 ? false : null;
    const ou_correct = (home + away) > rec.ou_total ? "OVER" : (home + away) < rec.ou_total ? "UNDER" : "PUSH";
    const patch = {
      actual_home_runs: home, actual_away_runs: away,
      result_entered: true, ml_correct, rl_correct, ou_correct,
    };
    await supabaseQuery(`/mlb_predictions?id=eq.${id}`, "PATCH", patch);
    setEntering(null);
    setResultForm({ actual_home: "", actual_away: "" });
    load();
  };

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this prediction?")) return;
    await supabaseQuery(`/mlb_predictions?id=eq.${id}`, "DELETE");
    load();
  };

  const grouped = records.reduce((acc, r) => {
    if (!acc[r.game_date]) acc[r.game_date] = [];
    acc[r.game_date].push(r);
    return acc;
  }, {});

  const confColor = (c) => c === "HIGH" ? "#3fb950" : c === "MEDIUM" ? "#e3b341" : "#8b949e";
  const mlSign = (ml) => ml > 0 ? `+${ml}` : ml;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#58a6ff" }}>📊 Prediction History</h2>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", fontSize: 13 }} />
        {filterDate && <button onClick={() => setFilterDate("")}
          style={{ background: "#21262d", color: "#8b949e", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          Clear Filter
        </button>}
        <button onClick={load} style={{ background: "#21262d", color: "#58a6ff", border: "1px solid #30363d", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
          🔄 Refresh
        </button>
      </div>

      {loading && <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>Loading history...</div>}

      {!loading && records.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>
          No predictions saved yet. Use the Calendar tab to generate and save predictions.
        </div>
      )}

      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e3b341", marginBottom: 8, borderBottom: "1px solid #30363d", paddingBottom: 6 }}>
            📅 {date}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8b949e", fontSize: 11, letterSpacing: 1 }}>
                  {["MATCHUP", "MODEL ML", "RUN LINE", "O/U", "WIN %", "CONF", "RESULT", "ML✓", "RL✓", "O/U✓", "ACTIONS"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #21262d", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recs.map(r => {
                  const isEntering = entering === r.id;
                  const resultBg = r.result_entered
                    ? (r.ml_correct ? "rgba(63,185,80,0.08)" : "rgba(248,81,73,0.08)")
                    : "transparent";
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #161b22", background: resultBg }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {r.away_team} @ {r.home_team}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <span style={{ color: "#58a6ff" }}>H: {mlSign(r.model_ml_home)}</span>
                        <span style={{ color: "#8b949e", margin: "0 4px" }}>|</span>
                        <span style={{ color: "#8b949e" }}>A: {mlSign(r.model_ml_away)}</span>
                      </td>
                      <td style={{ padding: "8px 10px", color: "#8b949e", whiteSpace: "nowrap" }}>
                        {r.home_team} {r.run_line_home > 0 ? "+" : ""}{r.run_line_home}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#e3b341" }}>{r.ou_total}</td>
                      <td style={{ padding: "8px 10px", color: "#58a6ff" }}>
                        {r.win_pct_home != null ? `${Math.round(r.win_pct_home * 100)}%` : "—"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ color: confColor(r.confidence), fontWeight: 600, fontSize: 11 }}>{r.confidence}</span>
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {r.result_entered
                          ? <span style={{ color: "#3fb950" }}>{r.away_team} {r.actual_away_runs} — {r.home_team} {r.actual_home_runs}</span>
                          : isEntering ? (
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input placeholder="Home" value={resultForm.actual_home}
                                onChange={e => setResultForm(f => ({ ...f, actual_home: e.target.value }))}
                                style={{ width: 44, background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "2px 6px", fontSize: 12 }} />
                              <input placeholder="Away" value={resultForm.actual_away}
                                onChange={e => setResultForm(f => ({ ...f, actual_away: e.target.value }))}
                                style={{ width: 44, background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, padding: "2px 6px", fontSize: 12 }} />
                              <button onClick={() => enterResult(r.id)}
                                style={{ background: "#238636", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>✓</button>
                              <button onClick={() => setEntering(null)}
                                style={{ background: "#21262d", border: "1px solid #30363d", color: "#8b949e", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 11 }}>✕</button>
                            </div>
                          ) : <span style={{ color: "#8b949e", fontSize: 11 }}>Pending</span>
                        }
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered ? (r.ml_correct ? "✅" : "❌") : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered ? (r.rl_correct === null ? "🔲" : r.rl_correct ? "✅" : "❌") : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        {r.result_entered ? (
                          <span style={{ color: r.ou_correct === "PUSH" ? "#e3b341" : "#e6edf3", fontSize: 11 }}>{r.ou_correct}</span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {!r.result_entered && (
                          <button onClick={() => { setEntering(r.id); setResultForm({ actual_home: "", actual_away: "" }); }}
                            style={{ background: "#21262d", border: "1px solid #30363d", color: "#58a6ff", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11, marginRight: 4 }}>
                            Enter Score
                          </button>
                        )}
                        <button onClick={() => deleteRecord(r.id)}
                          style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13 }}>🗑</button>
                      </td>
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

// ═══════════════════════════════════════════════════════════════
// PARLAY TAB
// ═══════════════════════════════════════════════════════════════
function ParlayTab() {
  const todayStr = new Date().toISOString().split("T")[0];
  const [dateStr, setDateStr] = useState(todayStr);
  const [legCount, setLegCount] = useState(3);
  const [allGames, setAllGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parlay, setParlay] = useState(null);
  const [customLegs, setCustomLegs] = useState([]); // manually toggled legs
  const [mode, setMode] = useState("auto"); // "auto" or "custom"
  const [wager, setWager] = useState(100);

  const loadGames = useCallback(async (d) => {
    setLoading(true);
    setParlay(null);
    const raw = await fetchScheduleForDate(d);
    const enriched = await Promise.all(raw.map(async (g) => {
      const [homeHit, awayHit, homePitch, awayPitch, homeStarter, awayStarter, homeForm, awayForm] =
        await Promise.all([
          fetchTeamHitting(g.homeTeamId), fetchTeamHitting(g.awayTeamId),
          fetchTeamPitching(g.homeTeamId), fetchTeamPitching(g.awayTeamId),
          fetchStarterStats(g.homeStarterId), fetchStarterStats(g.awayStarterId),
          fetchRecentForm(g.homeTeamId), fetchRecentForm(g.awayTeamId),
        ]);
      const pred = predictGame({
        homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
        homeHit, awayHit, homePitch, awayPitch,
        homeStarterStats: homeStarter, awayStarterStats: awayStarter,
        homeForm, awayForm,
      });
      return { ...g, pred };
    }));
    const withPreds = enriched.filter(g => g.pred);
    setAllGames(withPreds);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(dateStr); }, [dateStr]);

  // Build auto parlay from top confidence games
  useEffect(() => {
    if (!allGames.length || mode !== "auto") return;
    buildAutoParlay();
  }, [allGames, legCount, mode]);

  const buildAutoParlay = () => {
    // Score each game: favorite side by highest win prob
    const legs = allGames.map(g => {
      const home = teamById(g.homeTeamId);
      const away = teamById(g.awayTeamId);
      const pickHome = g.pred.homeWinPct >= 0.5;
      return {
        gamePk: g.gamePk,
        label: `${away.abbr} @ ${home.abbr}`,
        pick: pickHome ? home.abbr : away.abbr,
        prob: pickHome ? g.pred.homeWinPct : g.pred.awayWinPct,
        ml: pickHome ? g.pred.modelML_home : g.pred.modelML_away,
        confidence: g.pred.confidence,
        confScore: g.pred.confScore,
      };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, legCount);

    setParlay(legs);
  };

  const toggleCustomLeg = (game, pickHome) => {
    const home = teamById(game.homeTeamId);
    const away = teamById(game.awayTeamId);
    const legId = `${game.gamePk}-${pickHome ? "H" : "A"}`;
    const exists = customLegs.find(l => l.gamePk === game.gamePk);
    if (exists) {
      if ((exists.pick === home.abbr && pickHome) || (exists.pick === away.abbr && !pickHome)) {
        setCustomLegs(customLegs.filter(l => l.gamePk !== game.gamePk));
      } else {
        setCustomLegs(customLegs.map(l => l.gamePk === game.gamePk ? {
          ...l,
          pick: pickHome ? home.abbr : away.abbr,
          prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct,
          ml: pickHome ? game.pred.modelML_home : game.pred.modelML_away,
        } : l));
      }
    } else {
      setCustomLegs([...customLegs, {
        gamePk: game.gamePk,
        label: `${away.abbr} @ ${home.abbr}`,
        pick: pickHome ? home.abbr : away.abbr,
        prob: pickHome ? game.pred.homeWinPct : game.pred.awayWinPct,
        ml: pickHome ? game.pred.modelML_home : game.pred.modelML_away,
        confidence: game.pred.confidence,
        confScore: game.pred.confScore,
      }]);
    }
  };

  const activeLegList = mode === "auto" ? (parlay || []) : customLegs;
  const combinedProb = activeLegList.length ? combinedParlayProbability(activeLegList) : 0;
  const decOdds = activeLegList.length ? combinedParlayOdds(activeLegList) : 1;
  const fairML = activeLegList.length ? decimalToML(decOdds) : null;
  const payout = (wager * decOdds).toFixed(2);
  const ev = activeLegList.length ? ((combinedProb * (decOdds - 1) * wager) - ((1 - combinedProb) * wager)).toFixed(2) : null;

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#58a6ff" }}>🎯 Parlay Builder</h2>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
          style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#8b949e", fontSize: 13 }}>Legs:</span>
          {[2, 3, 4, 5, 6, 7, 8].map(n => (
            <button key={n} onClick={() => { setLegCount(n); setMode("auto"); }}
              style={{
                width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                background: mode === "auto" && legCount === n ? "#58a6ff" : "#21262d",
                color: mode === "auto" && legCount === n ? "#0d1117" : "#8b949e",
              }}>{n}</button>
          ))}
        </div>

        <button onClick={() => setMode(mode === "auto" ? "custom" : "auto")}
          style={{ background: mode === "custom" ? "#58a6ff" : "#21262d", color: mode === "custom" ? "#0d1117" : "#e6edf3",
            border: "1px solid #30363d", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
          {mode === "custom" ? "✏️ Custom Mode" : "⚡ Auto Mode"}
        </button>

        {loading && <span style={{ color: "#8b949e", fontSize: 13 }}>Loading games...</span>}
      </div>

      {/* Parlay Summary Card */}
      {activeLegList.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #1a2332, #162032)", border: "1px solid #58a6ff", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#58a6ff", marginBottom: 12, letterSpacing: 1 }}>
            {mode === "auto" ? `⚡ AUTO ${legCount}-LEG PARLAY` : `✏️ CUSTOM ${activeLegList.length}-LEG PARLAY`}
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <StatPill label="COMBINED PROB" value={`${(combinedProb * 100).toFixed(1)}%`} color={combinedProb > 0.15 ? "#3fb950" : "#f85149"} />
            <StatPill label="FAIR ODDS" value={fairML} color="#e3b341" />
            <StatPill label="PAYOUT (${wager})" value={`$${payout}`} color="#3fb950" />
            <StatPill label="MODEL EV" value={`$${ev}`} color={parseFloat(ev) >= 0 ? "#3fb950" : "#f85149"} />
          </div>
          {/* Wager input */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#8b949e", fontSize: 12 }}>Wager: $</span>
            <input type="number" value={wager} onChange={e => setWager(Number(e.target.value))}
              style={{ width: 80, background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 6, padding: "4px 8px", fontSize: 13 }} />
          </div>

          {/* Legs list */}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {activeLegList.map((leg, i) => (
              <div key={leg.gamePk} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#58a6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#0d1117" }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>{leg.label}</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Pick: <span style={{ color: "#3fb950" }}>{leg.pick}</span></div>
                </div>
                <StatPill label="PROB" value={`${(leg.prob * 100).toFixed(1)}%`} />
                <StatPill label="ML" value={leg.ml > 0 ? `+${leg.ml}` : leg.ml} />
                <span style={{ color: leg.confidence === "HIGH" ? "#3fb950" : leg.confidence === "MEDIUM" ? "#e3b341" : "#8b949e", fontSize: 10, fontWeight: 700 }}>{leg.confidence}</span>
                {mode === "custom" && (
                  <button onClick={() => setCustomLegs(customLegs.filter(l => l.gamePk !== leg.gamePk))}
                    style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 14 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All games with pick buttons (custom mode) or ranked list (auto mode) */}
      {!loading && allGames.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#8b949e", marginBottom: 8, letterSpacing: 1 }}>
            {mode === "auto" ? "ALL GAMES (sorted by model confidence)" : "SELECT YOUR LEGS"}
          </div>
          {[...allGames]
            .sort((a, b) => Math.max(b.pred.homeWinPct, 1 - b.pred.homeWinPct) - Math.max(a.pred.homeWinPct, 1 - a.pred.homeWinPct))
            .map((g, i) => {
              const home = teamById(g.homeTeamId);
              const away = teamById(g.awayTeamId);
              const favHome = g.pred.homeWinPct >= 0.5;
              const customLeg = customLegs.find(l => l.gamePk === g.gamePk);
              const isAutoSelected = mode === "auto" && parlay && parlay.find(l => l.gamePk === g.gamePk);

              return (
                <div key={g.gamePk} style={{
                  background: isAutoSelected ? "linear-gradient(135deg, #1a2d1a, #162d16)" : "#161b22",
                  border: `1px solid ${isAutoSelected ? "#2ea043" : "#30363d"}`,
                  borderRadius: 10, padding: "12px 16px", marginBottom: 8,
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap"
                }}>
                  <div style={{ width: 24, fontSize: 12, color: "#8b949e", textAlign: "center" }}>
                    {isAutoSelected ? "✅" : `#${i + 1}`}
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>{away.abbr} @ {home.abbr}</div>
                    <div style={{ fontSize: 11, color: "#8b949e" }}>
                      Fav: {favHome ? home.abbr : away.abbr} — {(Math.max(g.pred.homeWinPct, g.pred.awayWinPct) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <StatPill label="WIN% H" value={`${(g.pred.homeWinPct * 100).toFixed(0)}%`} />
                  <StatPill label="O/U" value={g.pred.ouTotal} />
                  <span style={{ color: g.pred.confidence === "HIGH" ? "#3fb950" : g.pred.confidence === "MEDIUM" ? "#e3b341" : "#8b949e", fontSize: 10, fontWeight: 700 }}>{g.pred.confidence}</span>
                  {mode === "custom" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => toggleCustomLeg(g, true)}
                        style={{
                          background: customLeg?.pick === home.abbr ? "#3fb950" : "#21262d",
                          color: customLeg?.pick === home.abbr ? "#0d1117" : "#e6edf3",
                          border: "1px solid #30363d", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12
                        }}>
                        {home.abbr}
                      </button>
                      <button
                        onClick={() => toggleCustomLeg(g, false)}
                        style={{
                          background: customLeg?.pick === away.abbr ? "#3fb950" : "#21262d",
                          color: customLeg?.pick === away.abbr ? "#0d1117" : "#e6edf3",
                          border: "1px solid #30363d", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12
                        }}>
                        {away.abbr}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {!loading && allGames.length === 0 && (
        <div style={{ color: "#8b949e", textAlign: "center", marginTop: 40 }}>No games found for {dateStr}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MATCHUP TAB (simplified standalone version)
// ═══════════════════════════════════════════════════════════════
function MatchupTab() {
  const [homeTeam, setHomeTeam] = useState(TEAMS[19]);
  const [awayTeam, setAwayTeam] = useState(TEAMS[11]);
  const [pred, setPred] = useState(null);
  const [loading, setLoading] = useState(false);

  const runPrediction = async () => {
    setLoading(true);
    const [homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm] = await Promise.all([
      fetchTeamHitting(homeTeam.id), fetchTeamHitting(awayTeam.id),
      fetchTeamPitching(homeTeam.id), fetchTeamPitching(awayTeam.id),
      fetchRecentForm(homeTeam.id), fetchRecentForm(awayTeam.id),
    ]);
    const result = predictGame({ homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, homeHit, awayHit, homePitch, awayPitch, homeForm, awayForm });
    setPred(result);
    setLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#58a6ff" }}>⚾ Matchup Predictor</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>AWAY</div>
          <select value={awayTeam.id} onChange={e => setAwayTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ color: "#8b949e", fontSize: 18, marginTop: 16 }}>@</div>
        <div>
          <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>HOME</div>
          <select value={homeTeam.id} onChange={e => setHomeTeam(TEAMS.find(t => t.id === parseInt(e.target.value)))}
            style={{ background: "#21262d", color: "#21262d", border: "1px solid #30363d", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "#e6edf3" }}>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={runPrediction}
          style={{ marginTop: 16, background: "#238636", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
          {loading ? "Computing..." : "⚡ Predict"}
        </button>
      </div>

      {pred && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 20, maxWidth: 560 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3", marginBottom: 12 }}>
            {awayTeam.abbr} {pred.awayRuns.toFixed(1)} — {homeTeam.abbr} {pred.homeRuns.toFixed(1)}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Detail label="Home Win %" value={`${(pred.homeWinPct * 100).toFixed(1)}%`} />
            <Detail label="Away Win %" value={`${(pred.awayWinPct * 100).toFixed(1)}%`} />
            <Detail label="O/U Total" value={pred.ouTotal} />
            <Detail label="Model ML (H)" value={pred.modelML_home > 0 ? `+${pred.modelML_home}` : pred.modelML_home} />
            <Detail label="Run Line" value={`${homeTeam.abbr} -1.5`} />
            <Detail label="Confidence" value={pred.confidence} />
            <Detail label="Conf Score" value={`${pred.confScore}/100`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── SHARED UI COMPONENTS ──────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{ textAlign: "center", minWidth: 48 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || "#e6edf3" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: 1.5 }}>{label}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>{value}</div>
    </div>
  );
}
