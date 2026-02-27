// api/statcast.js — Vercel Serverless Function
// Fetches Baseball Savant expected statistics CSV server-side (avoids CORS),
// parses team-level xwOBA / barrel rate / hard-hit%, returns JSON.
//
// Query params:
//   teamId  — MLB team ID (e.g. 158 for Brewers)
//   season  — year (defaults to current year)
//
// Response: { xwOBA, barrelRate, hardHitPct } or { error }

const TEAM_ID_TO_SAVANT_NAME = {
  108: "angels",    109: "d-backs",   110: "orioles",   111: "red sox",
  112: "cubs",      113: "reds",      114: "guardians", 115: "rockies",
  116: "tigers",    117: "astros",    118: "royals",    119: "dodgers",
  120: "nationals", 121: "mets",      133: "athletics", 134: "pirates",
  135: "padres",    136: "mariners",  137: "giants",    138: "cardinals",
  139: "rays",      140: "rangers",   141: "blue jays", 142: "twins",
  143: "phillies",  144: "braves",    145: "white sox", 146: "marlins",
  147: "yankees",   158: "brewers",
};

const TEAM_ID_TO_SAVANT_ABBR = {
  108: "LAA", 109: "AZ",  110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC",  119: "LAD", 120: "WSH", 121: "NYM", 133: "OAK",
  134: "PIT", 135: "SD",  136: "SEA", 137: "SF",  138: "STL",
  139: "TB",  140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

// In-memory cache: { [season]: { csv, ts } }
// Caches the full CSV for 6 hours so we only hit Savant once per cold-start window
const _cache = {};
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchSavantCSV(season) {
  const now = Date.now();
  if (_cache[season] && (now - _cache[season].ts) < CACHE_TTL) {
    return _cache[season].csv;
  }

  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter-team&year=${season}&position=&team=&csv=true`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SportsPredictor/1.0)",
      "Accept": "text/csv, text/plain, */*",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Savant returned ${res.status}`);
  }

  const csv = await res.text();
  _cache[season] = { csv, ts: now };
  return csv;
}

function parseCSVForTeam(csvText, teamId) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return null;

  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());

  // Baseball Savant uses "est_woba" for expected wOBA
  let wobaCol = headers.findIndex(h => h === "est_woba");
  if (wobaCol < 0) wobaCol = headers.findIndex(h => h.includes("xwoba"));
  if (wobaCol < 0) return null;

  const teamIdx   = headers.findIndex(h => ["team_name", "team", "team_name_alt", "last_name"].includes(h));
  const abbrIdx   = headers.findIndex(h => ["team_id", "abbreviation", "team_abbr"].includes(h));
  const barrelIdx = headers.findIndex(h => h.includes("barrel") && h.includes("pct"));
  const hardHitIdx = headers.findIndex(h => h.includes("hard_hit") || h === "ev50");

  const targetName = (TEAM_ID_TO_SAVANT_NAME[teamId] || "").toLowerCase();
  const targetAbbr = (TEAM_ID_TO_SAVANT_ABBR[teamId] || "").toUpperCase();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/"/g, ""));
    const rowTeam = (teamIdx >= 0 ? cols[teamIdx] : "").toLowerCase();
    const rowAbbr = (abbrIdx >= 0 ? cols[abbrIdx] : "").toUpperCase();

    const nameMatch = targetName && rowTeam.includes(targetName);
    const abbrMatch = targetAbbr && (rowAbbr === targetAbbr || rowTeam.includes(targetAbbr.toLowerCase()));

    if (nameMatch || abbrMatch) {
      const xwOBA = parseFloat(cols[wobaCol]);
      if (!isNaN(xwOBA) && xwOBA > 0.200 && xwOBA < 0.450) {
        return {
          xwOBA:      Math.round(xwOBA * 1000) / 1000,
          barrelRate:  barrelIdx >= 0 ? (parseFloat(cols[barrelIdx]) || null) : null,
          hardHitPct:  hardHitIdx >= 0 ? (parseFloat(cols[hardHitIdx]) || null) : null,
        };
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { teamId, season } = req.query;

  if (!teamId) {
    return res.status(400).json({ error: "Missing teamId parameter" });
  }

  const tid = parseInt(teamId, 10);
  if (!TEAM_ID_TO_SAVANT_NAME[tid]) {
    return res.status(400).json({ error: `Unknown teamId: ${teamId}` });
  }

  const yr = parseInt(season, 10) || new Date().getFullYear();

  try {
    const csv = await fetchSavantCSV(yr);
    const data = parseCSVForTeam(csv, tid);

    if (!data) {
      return res.status(404).json({
        error: `No Statcast data found for teamId ${tid} in ${yr}`,
        teamId: tid,
        season: yr,
      });
    }

    // Cache at CDN edge for 6 hours, stale-while-revalidate for 12
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=43200");

    return res.status(200).json({
      teamId: tid,
      season: yr,
      ...data,
    });
  } catch (err) {
    console.error("Statcast API error:", err);
    return res.status(502).json({
      error: "Failed to fetch from Baseball Savant",
      detail: err.message,
    });
  }
}
