// src/utils/mlApi.js
// Lines 70–105 of App.jsx (extracted)

const ML_API = "https://sports-predictor-api-production.up.railway.app";
let _mlApiAvailable = true;

export async function mlPredict(sport, gameData) {
  if (!_mlApiAvailable) return null;
  try {
    const res = await fetch(`${ML_API}/predict/${sport.toLowerCase()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gameData),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) return null;
    return data;
  } catch {
    _mlApiAvailable = false;
    setTimeout(() => { _mlApiAvailable = true; }, 60000);
    return null;
  }
}

export async function mlMonteCarlo(sport, homeMean, awayMean, nSims = 10000, ouLine = null, gameId = null) {
  if (!_mlApiAvailable) return null;
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
