// src/utils/mlApi.js

const ML_API = "https://sports-predictor-api-production.up.railway.app";

// Per-sport circuit breakers — a 500 on MLB must NOT block NCAA/NBA calls
const _available = {};
const _resetTimers = {};

function isAvailable(sport) {
  return _available[sport] !== false;
}

function markFailed(sport) {
  _available[sport] = false;
  clearTimeout(_resetTimers[sport]);
  _resetTimers[sport] = setTimeout(() => {
    _available[sport] = true;
    console.log(`[mlApi] Circuit breaker reset for ${sport}`);
  }, 60000);
}

export async function mlPredict(sport, gameData) {
  const key = sport.toLowerCase();
  if (!isAvailable(key)) {
    console.warn(`[mlApi] ${sport} circuit breaker open — skipping ML call`);
    return null;
  }
  try {
    const res = await fetch(`${ML_API}/predict/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gameData),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.error(`[mlApi] /predict/${key} returned ${res.status} — circuit breaker tripped for ${sport}`);
      markFailed(key);
      return null;
    }
    const data = await res.json();
    if (data?.error) {
      console.error(`[mlApi] /predict/${key} error:`, data.error);
      return null;
    }
    console.log(`[mlApi] /predict/${key} OK — win_prob_home: ${data.ml_win_prob_home?.toFixed(3)}, margin: ${data.ml_margin?.toFixed(1)}`);
    return data;
  } catch (e) {
    console.error(`[mlApi] /predict/${key} exception:`, e.message);
    markFailed(key);
    return null;
  }
}

// Hits /predict/ncaa/full — backend fetches all data server-side.
// Use this in ncaaSync where only team IDs are reliably available.
export async function mlPredictFull(homeTeamId, awayTeamId, { neutralSite = false, gameDate = null, gameId = null } = {}) {
  if (!isAvailable("ncaa")) {
    console.warn(`[mlApi] ncaa circuit breaker open — skipping mlPredictFull`);
    return null;
  }
  try {
    const res = await fetch(`${ML_API}/predict/ncaa/full`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        neutral_site: neutralSite,
        game_date: gameDate,
        game_id: gameId,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error(`[mlApi] /predict/ncaa/full returned ${res.status}`);
      markFailed("ncaa");
      return null;
    }
    const data = await res.json();
    if (data?.error) {
      console.error(`[mlApi] /predict/ncaa/full error:`, data.error);
      return null;
    }
    console.log(`[mlApi] /predict/ncaa/full OK — win_prob: ${data.ml_win_prob_home?.toFixed(3)}, margin: ${data.ml_margin?.toFixed(1)}, coverage: ${data.feature_coverage}`);
    return data;
  } catch (e) {
    console.error(`[mlApi] /predict/ncaa/full exception:`, e.message);
    markFailed("ncaa");
    return null;
  }
}

export async function mlMonteCarlo(sport, homeMean, awayMean, nSims = 10000, ouLine = null, gameId = null) {
  if (!isAvailable("monte-carlo")) return null;
  try {
    const res = await fetch(`${ML_API}/monte-carlo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport,
        home_mean: homeMean,
        away_mean: awayMean,
        n_sims: nSims,
        ou_line: ouLine,
        game_id: gameId,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
