import { useEffect, useState } from "react";
import { supabaseQuery } from "../utils/supabase";

// Council V41 W1 -- the requester's own ledger.
// Writes ONLY to user_bets. Never touches model units (V5); never pooled with them.
// `line` is the number for the side bet, as on a ticket: HOME -3.5 / AWAY +3.5 for
// spreads, 51.5 for totals; ML settles at `price`. Graded by user_bets_grade.py.
const up = (v) => (v ? String(v).toUpperCase() : null);
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export default function LogBetForm({
  sport, season, week, gameId, homeTeam, awayTeam,
  homeSpread, total, homeMl, awayMl,
  modelAts, modelOu, modelMl,
}) {
  const model = { ats: up(modelAts), ou: up(modelOu), ml: up(modelMl) };
  const sidesFor = (m) => (m === "ou" ? ["OVER", "UNDER"] : ["HOME", "AWAY"]);
  const [market, setMarket] = useState("ats");
  const [side, setSide] = useState(model.ats || "HOME");
  const [line, setLine] = useState("");
  const [price, setPrice] = useState("-110");
  const [units, setUnits] = useState("1");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hs = num(homeSpread);
    if (market === "ats") {
      setLine(hs === null ? "" : String(side === "HOME" ? hs : -hs));
      setPrice("-110");
    } else if (market === "ou") {
      setLine(num(total) === null ? "" : String(num(total)));
      setPrice("-110");
    } else {
      setLine("");
      const p = side === "HOME" ? num(homeMl) : num(awayMl);
      setPrice(p === null ? "" : String(p));
    }
    setStatus(null);
  }, [market, side, homeSpread, total, homeMl, awayMl]);

  const pickMarket = (m) => {
    setMarket(m);
    setSide(model[m] && sidesFor(m).includes(model[m]) ? model[m] : sidesFor(m)[0]);
  };

  const submit = async () => {
    const u = num(units), p = num(price), l = num(line);
    if (u === null || u <= 0) return setStatus("units must be > 0");
    if (market !== "ml" && l === null) return setStatus("line required for spread / total");
    if (p === null || !Number.isInteger(p) || Math.abs(p) < 100) return setStatus("price must be American odds, e.g. -110 or +150");
    const body = {
      sport, season: Number(season), week: week == null ? null : Number(week),
      game_id: String(gameId), home_team: homeTeam ?? null, away_team: awayTeam ?? null,
      market, side, line: market === "ml" ? null : l, price: p, units: u,
      model_side: model[market] ?? null,
    };
    setBusy(true);
    try {
      const res = await supabaseQuery("/user_bets", "POST", body);
      const row = Array.isArray(res) ? res[0] : res;
      setStatus(res === null ? "failed -- see console" : row && row.id ? `logged #${row.id}` : "not confirmed -- check user_bets before retrying");
    } catch (e) {
      setStatus(`failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const done = typeof status === "string" && status.startsWith("logged");
  const btn = (active) => ({
    padding: "2px 8px", marginRight: 4, fontSize: 11, cursor: "pointer",
    border: "1px solid #555", borderRadius: 4,
    background: active ? "#2d6cdf" : "transparent", color: active ? "#fff" : "inherit",
  });
  const inp = { width: 64, fontSize: 11, padding: "2px 4px", marginRight: 6 };

  return (
    <div onClick={(e) => e.stopPropagation()}
         style={{ marginTop: 10, padding: 8, border: "1px dashed #555", borderRadius: 6, fontSize: 11 }}>
      <div style={{ marginBottom: 6, opacity: 0.8 }}>
        My bet -- separate ledger (V41 W1); model units stay 0
      </div>
      <div style={{ marginBottom: 6 }}>
        {["ats", "ml", "ou"].map((m) => (
          <button key={m} type="button" style={btn(market === m)} onClick={() => pickMarket(m)}>
            {m.toUpperCase()}
          </button>
        ))}
        <span style={{ marginLeft: 8 }} />
        {sidesFor(market).map((s) => (
          <button key={s} type="button" style={btn(side === s)} onClick={() => setSide(s)}>
            {s === "HOME" ? homeTeam || "HOME" : s === "AWAY" ? awayTeam || "AWAY" : s}
            {model[market] === s ? " *" : ""}
          </button>
        ))}
      </div>
      <div>
        {market !== "ml" && (<>line <input style={inp} value={line} onChange={(e) => { setLine(e.target.value); setStatus(null); }} /></>)}
        price <input style={inp} value={price} onChange={(e) => { setPrice(e.target.value); setStatus(null); }} />
        units <input style={{ ...inp, width: 44 }} value={units} onChange={(e) => { setUnits(e.target.value); setStatus(null); }} />
        <button type="button" style={btn(false)} disabled={busy || done} onClick={submit}>
          {busy ? "..." : done ? "logged" : "Log bet"}
        </button>
        {status && <span style={{ marginLeft: 6 }}>{status}</span>}
      </div>
      <div style={{ marginTop: 4, opacity: 0.6 }}>* = model's side for this market</div>
    </div>
  );
}
