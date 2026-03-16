import React, { useState, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// 2026 BRACKET DATA — Selection Sunday March 15, 2026
// ═══════════════════════════════════════════════════════════════
const REGIONS = {
  east: {
    label: "EAST", city: "Washington D.C.", color: "#3b82f6", dark: "#1a2744",
    teams: [
      { seed: 1, name: "Duke", id: 150 }, { seed: 16, name: "Siena", id: 2547 },
      { seed: 8, name: "Ohio State", id: 194 }, { seed: 9, name: "TCU", id: 2628 },
      { seed: 5, name: "St. John's", id: 2599 }, { seed: 12, name: "N. Iowa", id: 2460 },
      { seed: 4, name: "Kansas", id: 2305 }, { seed: 13, name: "Cal Baptist", id: 2856 },
      { seed: 6, name: "Louisville", id: 97 }, { seed: 11, name: "S. Florida", id: 58 },
      { seed: 3, name: "Mich. State", id: 127 }, { seed: 14, name: "NDSU", id: 2449 },
      { seed: 7, name: "UCLA", id: 26 }, { seed: 10, name: "UCF", id: 2116 },
      { seed: 2, name: "UConn", id: 41 }, { seed: 15, name: "Furman", id: 231 },
    ]
  },
  west: {
    label: "WEST", city: "San Jose", color: "#22c55e", dark: "#1a3324",
    teams: [
      { seed: 1, name: "Arizona", id: 12 }, { seed: 16, name: "LIU", id: 112 },
      { seed: 8, name: "Villanova", id: 2918 }, { seed: 9, name: "Utah State", id: 328 },
      { seed: 5, name: "Wisconsin", id: 275 }, { seed: 12, name: "High Point", id: 2272 },
      { seed: 4, name: "Arkansas", id: 8 }, { seed: 13, name: "Hawaii", id: 62 },
      { seed: 6, name: "BYU", id: 252 }, { seed: 11, name: "Texas", id: 251 },
      { seed: 3, name: "Gonzaga", id: 2250 }, { seed: 14, name: "Kennesaw St", id: 338 },
      { seed: 7, name: "Miami FL", id: 2390 }, { seed: 10, name: "Missouri", id: 142 },
      { seed: 2, name: "Purdue", id: 2509 }, { seed: 15, name: "Queens", id: 2818 },
    ]
  },
  midwest: {
    label: "MIDWEST", city: "Chicago", color: "#a855f7", dark: "#2d1f3d",
    teams: [
      { seed: 1, name: "Michigan", id: 130 }, { seed: 16, name: "UMBC", id: 2692 },
      { seed: 8, name: "Georgia", id: 61 }, { seed: 9, name: "Saint Louis", id: 139 },
      { seed: 5, name: "Texas Tech", id: 2641 }, { seed: 12, name: "Akron", id: 2006 },
      { seed: 4, name: "Alabama", id: 333 }, { seed: 13, name: "Hofstra", id: 2275 },
      { seed: 6, name: "Tennessee", id: 2633 }, { seed: 11, name: "SMU", id: 2567 },
      { seed: 3, name: "Virginia", id: 258 }, { seed: 14, name: "Wright St", id: 2750 },
      { seed: 7, name: "Kentucky", id: 96 }, { seed: 10, name: "Santa Clara", id: 2491 },
      { seed: 2, name: "Iowa State", id: 66 }, { seed: 15, name: "Tenn. State", id: 2634 },
    ]
  },
  south: {
    label: "SOUTH", city: "Houston", color: "#ef4444", dark: "#331a1a",
    teams: [
      { seed: 1, name: "Florida", id: 57 }, { seed: 16, name: "Lehigh", id: 2329 },
      { seed: 8, name: "Clemson", id: 228 }, { seed: 9, name: "Iowa", id: 2294 },
      { seed: 5, name: "Vanderbilt", id: 238 }, { seed: 12, name: "McNeese", id: 2377 },
      { seed: 4, name: "Nebraska", id: 158 }, { seed: 13, name: "Troy", id: 2653 },
      { seed: 6, name: "UNC", id: 153 }, { seed: 11, name: "VCU", id: 2670 },
      { seed: 3, name: "Illinois", id: 356 }, { seed: 14, name: "Penn", id: 219 },
      { seed: 7, name: "Saint Mary's", id: 2608 }, { seed: 10, name: "Texas A&M", id: 245 },
      { seed: 2, name: "Houston", id: 248 }, { seed: 15, name: "Idaho", id: 70 },
    ]
  }
};

// ═══════════════════════════════════════════════════════════════
// SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════

function gaussRandom(mean, std) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function simGame(teamA, teamB, sigma = 11) {
  const spread = (teamB.seed - teamA.seed) * 1.4;
  return gaussRandom(spread, sigma) > 0 ? teamA : teamB;
}

function runFullSim(locked, nSims) {
  // Per-team counters
  const counters = {};
  const allTeams = [];
  for (const [rKey, region] of Object.entries(REGIONS)) {
    for (const t of region.teams) {
      counters[t.id] = { r32: 0, s16: 0, e8: 0, f4: 0, ncg: 0, champ: 0 };
      allTeams.push({ ...t, region: rKey });
    }
  }

  for (let s = 0; s < nSims; s++) {
    const regionWinners = {};

    for (const [rKey, region] of Object.entries(REGIONS)) {
      const teams = region.teams;
      // R64
      const r32 = [];
      for (let i = 0; i < 16; i += 2) {
        const w = locked.get(`${rKey}_r0_${i / 2}`) || simGame(teams[i], teams[i + 1]);
        r32.push(w);
        counters[w.id].r32++;
      }
      // R32
      const s16 = [];
      for (let i = 0; i < 8; i += 2) {
        const w = locked.get(`${rKey}_r1_${i / 2}`) || simGame(r32[i], r32[i + 1]);
        s16.push(w);
        counters[w.id].s16++;
      }
      // S16
      const e8 = [];
      for (let i = 0; i < 4; i += 2) {
        const w = locked.get(`${rKey}_r2_${i / 2}`) || simGame(s16[i], s16[i + 1]);
        e8.push(w);
        counters[w.id].e8++;
      }
      // E8
      const w = locked.get(`${rKey}_r3_0`) || simGame(e8[0], e8[1]);
      counters[w.id].f4++;
      regionWinners[rKey] = w;
    }

    // Final Four: East vs South, West vs Midwest
    const f1 = locked.get("ff_semi1") || simGame(regionWinners.east, regionWinners.south);
    counters[f1.id].ncg++;
    const f2 = locked.get("ff_semi2") || simGame(regionWinners.west, regionWinners.midwest);
    counters[f2.id].ncg++;
    const champ = locked.get("ff_final") || simGame(f1, f2);
    counters[champ.id].champ++;
  }

  return counters;
}

// ═══════════════════════════════════════════════════════════════
// TEAM SLOT
// ═══════════════════════════════════════════════════════════════

const TeamSlot = ({ team, prob, isLocked, isOut, onClick, color, compact }) => {
  if (!team) return (
    <div style={{
      height: compact ? 22 : 26, background: "rgba(255,255,255,0.015)",
      border: "1px dashed rgba(255,255,255,0.06)", borderRadius: 3,
      display: "flex", alignItems: "center", padding: "0 5px",
      fontSize: 9, color: "rgba(255,255,255,0.12)", fontStyle: "italic",
    }}>TBD</div>
  );
  const pct = prob != null ? prob * 100 : null;
  return (
    <div onClick={onClick} style={{
      height: compact ? 22 : 26, display: "flex", alignItems: "center", gap: 3,
      padding: "0 5px", borderRadius: 3, cursor: onClick ? "pointer" : "default",
      background: isLocked ? `${color}30` : "rgba(255,255,255,0.03)",
      border: isLocked ? `1.5px solid ${color}` : "1px solid rgba(255,255,255,0.05)",
      opacity: isOut ? 0.3 : 1, transition: "all 0.15s", position: "relative", overflow: "hidden",
    }}>
      {pct != null && <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: `${pct}%`, background: `${color}0d`, transition: "width 0.3s",
      }} />}
      <span style={{
        fontSize: 8, color: "rgba(255,255,255,0.3)", fontWeight: 700,
        width: 14, textAlign: "right", flexShrink: 0, position: "relative",
        fontFamily: "'JetBrains Mono',monospace",
      }}>{team.seed}</span>
      <span style={{
        fontSize: compact ? 9 : 10, fontWeight: isLocked ? 700 : 500,
        color: isLocked ? "#fff" : isOut ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.8)",
        flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        position: "relative",
      }}>{team.name}</span>
      {pct != null && (
        <span style={{
          fontSize: 8, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace",
          color: pct > 70 ? "#4ade80" : pct > 40 ? "#fbbf24" : "rgba(255,255,255,0.3)",
          position: "relative", flexShrink: 0,
        }}>{pct < 1 ? "<1" : pct.toFixed(0)}%</span>
      )}
      {isLocked && <span style={{ fontSize: 7, position: "relative", color: "#4ade80" }}>✓</span>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// REGION BRACKET
// ═══════════════════════════════════════════════════════════════

function RegionBracket({ regionKey, counters, locked, onLock, nSims }) {
  const region = REGIONS[regionKey];
  const teams = region.teams;
  const color = region.color;
  const prob = (id, rk) => counters && nSims ? (counters[id]?.[rk] || 0) / nSims : null;

  // For each round, figure out who's in it based on locks or highest-prob
  const resolve = (round) => {
    if (round === 0) return teams;
    const prev = resolve(round - 1);
    const roundKeys = ["r32", "s16", "e8", "f4"];
    const rk = roundKeys[round - 1];
    const result = [];
    for (let i = 0; i < prev.length; i += 2) {
      const lockKey = `${regionKey}_r${round - 1}_${Math.floor(i / 2)}`;
      const lk = locked.get(lockKey);
      if (lk) { result.push(lk); continue; }
      const a = prev[i], b = prev[i + 1];
      if (!a || !b) { result.push(a || b || null); continue; }
      const pA = prob(a.id, rk) || 0, pB = prob(b.id, rk) || 0;
      result.push(pA >= pB ? a : b);
    }
    return result;
  };

  const roundKeys = ["r32", "s16", "e8", "f4"];
  const rounds = [0, 1, 2, 3].map(r => resolve(r));
  const winner = resolve(4)?.[0];

  const renderRound = (round, teamsArr, rk, label) => {
    const games = [];
    for (let i = 0; i < teamsArr.length; i += 2) {
      const a = teamsArr[i], b = teamsArr[i + 1];
      const gi = Math.floor(i / 2);
      const lockKey = `${regionKey}_r${round}_${gi}`;
      const w = locked.get(lockKey);
      games.push(
        <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: round === 0 ? 2 : 6 }}>
          <TeamSlot team={a} prob={a ? prob(a.id, rk) : null}
            isLocked={w?.id === a?.id} isOut={w && w.id !== a?.id}
            onClick={a ? () => onLock(lockKey, a) : null} color={color} compact={round === 0} />
          <TeamSlot team={b} prob={b ? prob(b.id, rk) : null}
            isLocked={w?.id === b?.id} isOut={w && w.id !== b?.id}
            onClick={b ? () => onLock(lockKey, b) : null} color={color} compact={round === 0} />
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", minWidth: round === 0 ? 115 : 105, justifyContent: "space-around" }}>
        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginBottom: 3, textAlign: "center", letterSpacing: 1, fontWeight: 600 }}>{label}</div>
        {games}
      </div>
    );
  };

  return (
    <div style={{
      background: `linear-gradient(160deg, ${region.dark} 0%, #0d1117 100%)`,
      borderRadius: 10, padding: "10px 6px", border: `1px solid ${color}22`, overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingLeft: 2 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontFamily: "'Bebas Neue','Impact',sans-serif", fontSize: 13, letterSpacing: 2, color }}>{region.label}</span>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{region.city}</span>
      </div>

      <div style={{ display: "flex", gap: 2, overflowX: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
        {renderRound(0, rounds[0], roundKeys[0], "R64")}
        {renderRound(1, rounds[1], roundKeys[1], "R32")}
        {renderRound(2, rounds[2], roundKeys[2], "S16")}
        {renderRound(3, rounds[3], roundKeys[3], "ELITE 8")}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 95, justifyContent: "center" }}>
          <div style={{ fontSize: 7, color, marginBottom: 3, textAlign: "center", letterSpacing: 1, fontWeight: 700 }}>WINNER</div>
          {winner && (
            <div style={{
              padding: "5px 7px", borderRadius: 5, background: `${color}18`, border: `1px solid ${color}33`,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{winner.name}</div>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono',monospace" }}>
                ({winner.seed}) {prob(winner.id, "f4") != null ? `${(prob(winner.id, "f4") * 100).toFixed(0)}%` : ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FINAL FOUR + CHAMPIONSHIP
// ═══════════════════════════════════════════════════════════════

function FinalFourPanel({ counters, nSims }) {
  if (!counters || !nSims) return null;

  const allTeams = Object.values(REGIONS).flatMap(r => r.teams.map(t => ({
    ...t, region: r.label, regionColor: r.color,
    champPct: (counters[t.id]?.champ || 0) / nSims * 100,
    f4Pct: (counters[t.id]?.f4 || 0) / nSims * 100,
    ncgPct: (counters[t.id]?.ncg || 0) / nSims * 100,
  })));

  const ranked = allTeams.filter(t => t.champPct > 0.05).sort((a, b) => b.champPct - a.champPct);
  const champ = ranked[0];

  return (
    <div style={{
      background: "linear-gradient(160deg, #1a1a2e 0%, #0d1117 100%)",
      borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10,
    }}>
      <div style={{
        fontFamily: "'Bebas Neue','Impact',sans-serif", fontSize: 16,
        letterSpacing: 3, color: "#fbbf24", textAlign: "center", marginBottom: 8,
      }}>FINAL FOUR — INDIANAPOLIS</div>

      {champ && (
        <div style={{
          textAlign: "center", marginBottom: 12, padding: "10px 14px",
          background: "rgba(251,191,36,0.05)", borderRadius: 7, border: "1px solid rgba(251,191,36,0.12)",
        }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2, marginBottom: 2 }}>PREDICTED CHAMPION</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fbbf24", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>{champ.name}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "'JetBrains Mono',monospace" }}>
            ({champ.seed} seed, {champ.region}) — {champ.champPct.toFixed(1)}%
          </div>
        </div>
      )}

      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginBottom: 4, letterSpacing: 1, fontWeight: 600 }}>TOP CONTENDERS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
        {ranked.slice(0, 16).map((t, i) => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 7px",
            background: i === 0 ? "rgba(251,191,36,0.06)" : "rgba(255,255,255,0.015)",
            borderRadius: 3, border: i === 0 ? "1px solid rgba(251,191,36,0.15)" : "1px solid transparent",
          }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: t.regionColor, flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", width: 12 }}>{t.seed}</span>
            <span style={{
              fontSize: 10, fontWeight: i < 4 ? 700 : 400,
              color: i === 0 ? "#fbbf24" : "rgba(255,255,255,0.75)",
              flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{t.name}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
              color: t.champPct > 8 ? "#4ade80" : t.champPct > 3 ? "#fbbf24" : "rgba(255,255,255,0.35)",
              minWidth: 32, textAlign: "right",
            }}>{t.champPct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function MarchMadnessPanel() {
  const [locked, setLocked] = useState(new Map());
  const [counters, setCounters] = useState(null);
  const [nSims, setNSims] = useState(0);
  const [simCount, setSimCount] = useState(10000);
  const [running, setRunning] = useState(false);
  const [activeRegion, setActiveRegion] = useState("east");

  const onLock = useCallback((key, team) => {
    setLocked(prev => {
      const next = new Map(prev);
      if (next.get(key)?.id === team.id) next.delete(key);
      else next.set(key, team);
      return next;
    });
  }, []);

  const handleSim = useCallback(() => {
    setRunning(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        const c = runFullSim(locked, simCount);
        setCounters(c);
        setNSims(simCount);
        setRunning(false);
      }, 20);
    });
  }, [locked, simCount]);

  const handleReset = useCallback(() => {
    setLocked(new Map());
    setCounters(null);
    setNSims(0);
  }, []);

  return (
    <div style={{ fontFamily: "'Archivo','Helvetica Neue',sans-serif", color: "#e6edf3" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Archivo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Controls */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={handleSim} disabled={running} style={{
          padding: "6px 16px", borderRadius: 5, border: "none", cursor: running ? "wait" : "pointer",
          background: running ? "#1a2744" : "linear-gradient(135deg, #3b82f6, #2563eb)",
          color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        }}>
          {running ? "⏳ Running…" : nSims ? "↻ Re-Simulate" : "▶ Run Simulation"}
        </button>
        <select value={simCount} onChange={e => setSimCount(Number(e.target.value))} style={{
          padding: "5px 6px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)",
          background: "#161b22", color: "#e6edf3", fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
        }}>
          <option value={1000}>1K sims</option>
          <option value={5000}>5K sims</option>
          <option value={10000}>10K sims</option>
          <option value={25000}>25K sims</option>
        </select>
        {locked.size > 0 && (
          <React.Fragment>
            <span style={{ fontSize: 9, color: "#4ade80", fontFamily: "'JetBrains Mono',monospace" }}>
              {locked.size} locked
            </span>
            <button onClick={handleReset} style={{
              padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent", color: "rgba(255,255,255,0.35)", fontSize: 9, cursor: "pointer",
            }}>Reset</button>
          </React.Fragment>
        )}
        {nSims > 0 && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono',monospace", marginLeft: "auto" }}>
            {nSims.toLocaleString()} sims · σ=11
          </span>
        )}
      </div>

      {/* Instructions */}
      {!counters && (
        <div style={{
          padding: "8px 12px", marginBottom: 10, borderRadius: 6,
          background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)",
          fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.5,
        }}>
          Hit <strong style={{ color: "#3b82f6" }}>Run Simulation</strong> to predict the tournament.
          Then <strong style={{ color: "#4ade80" }}>click a team</strong> to lock them as a round winner.
          Re-simulate to update all probabilities from that point forward.
        </div>
      )}

      {/* Final Four */}
      <FinalFourPanel counters={counters} nSims={nSims} />

      {/* Region tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
        {Object.entries(REGIONS).map(([key, r]) => (
          <button key={key} onClick={() => setActiveRegion(key)} style={{
            padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer",
            background: activeRegion === key ? `${r.color}1a` : "transparent",
            color: activeRegion === key ? r.color : "rgba(255,255,255,0.3)",
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            borderBottom: activeRegion === key ? `2px solid ${r.color}` : "2px solid transparent",
          }}>{r.label}</button>
        ))}
      </div>

      {/* Bracket */}
      <RegionBracket
        regionKey={activeRegion}
        counters={counters}
        locked={locked}
        onLock={onLock}
        nSims={nSims}
      />
    </div>
  );
}
