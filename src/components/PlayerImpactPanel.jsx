/**
 * PlayerImpactPanel.jsx — Player status override UI for NBA game cards
 * 
 * Shows inside expanded game card. Displays OUT/DTD players with toggle
 * buttons (OUT → PARTIAL → PLAYING), manual player add via autocomplete,
 * and recalculate button that calls POST /predict/nba/adjust.
 * 
 * Props:
 *   - gameId: ESPN game ID
 *   - homeAbbr, awayAbbr: team abbreviations
 *   - homeOutPlayers: string[] from stored prediction (e.g. ["Jokic", "Murray (DTD)"])
 *   - awayOutPlayers: string[]
 *   - impactAdjustment: number (current stored impact)
 *   - onAdjusted: callback({ adjustedMargin, adjustedWp, impactDelta }) for parent to update display
 */

import { useState, useEffect, useCallback } from "react";
import { C as _C } from "./Shared.jsx";

// Extend shared colors with red (not in Shared.jsx)
const C = { ..._C, red: "#f85149" };

const API_BASE = import.meta.env.VITE_API_URL || "https://sports-predictor-api-production.up.railway.app";

// Status cycle: OUT → PARTIAL → PLAYING → OUT
const STATUS_CYCLE = { OUT: "PARTIAL", PARTIAL: "PLAYING", PLAYING: "OUT" };
const STATUS_COLORS = {
  OUT: C.red,
  PARTIAL: C.yellow,
  PLAYING: C.green,
};
const STATUS_ICONS = {
  OUT: "✕",
  PARTIAL: "◐",
  PLAYING: "✓",
};

function parseStoredStatus(entry) {
  if (typeof entry !== "string") return { name: String(entry), status: "OUT" };
  if (entry.includes("(DTD)")) {
    return { name: entry.replace("(DTD)", "").trim(), status: "PARTIAL" };
  }
  return { name: entry, status: "OUT" };
}

export default function PlayerImpactPanel({
  gameId, homeAbbr, awayAbbr,
  homeOutPlayers = [], awayOutPlayers = [],
  homeGtdPlayers = [], awayGtdPlayers = [],
  impactAdjustment = 0,
  storedMargin = 0, storedWp = 0.5,
  onAdjusted,
}) {
  // Parse stored OUT/DTD players into structured state
  const initPlayers = () => {
    const players = {};
    for (const entry of homeOutPlayers) {
      const { name, status } = parseStoredStatus(entry);
      players[`${homeAbbr}::${name}`] = { name, team: homeAbbr, status, original: true };
    }
    for (const entry of awayOutPlayers) {
      const { name, status } = parseStoredStatus(entry);
      players[`${awayAbbr}::${name}`] = { name, team: awayAbbr, status, original: true };
    }
    return players;
  };

  const [players, setPlayers] = useState(initPlayers);
  const [adjustResult, setAdjustResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(null); // "home" | "away" | null
  const [addSearch, setAddSearch] = useState("");
  const [roster, setRoster] = useState({ home: [], away: [] });
  const [dirty, setDirty] = useState(false); // true when overrides differ from stored

  // Reset internal state when upstream prediction refreshes (new injury data from ESPN)
  // JSON.stringify provides stable comparison since array refs change on every render
  const upstreamKey = JSON.stringify(homeOutPlayers) + JSON.stringify(awayOutPlayers);
  useEffect(() => {
    setPlayers(initPlayers());
    setAdjustResult(null);
    setDirty(false);
    setError(null);
    setShowAdd(null);
  }, [upstreamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStatus = useCallback((key) => {
    setPlayers(prev => {
      const p = prev[key];
      if (!p) return prev;
      return { ...prev, [key]: { ...p, status: STATUS_CYCLE[p.status] || "OUT" } };
    });
    setDirty(true);
  }, []);

  const removePlayer = useCallback((key) => {
    setPlayers(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDirty(true);
  }, []);

  const addPlayer = useCallback((name, team) => {
    const key = `${team}::${name}`;
    setPlayers(prev => ({
      ...prev,
      [key]: { name, team, status: "OUT", original: false },
    }));
    setShowAdd(null);
    setAddSearch("");
    setDirty(true);
  }, []);

  const recalculate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build player_overrides from current state
      const overrides = {};
      for (const p of Object.values(players)) {
        overrides[p.name] = p.status.toLowerCase();
      }

      const resp = await fetch(`${API_BASE}/predict/nba/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_id: gameId, player_overrides: overrides }),
      });

      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();

      if (data.error) throw new Error(data.error);

      setAdjustResult(data);
      setDirty(false);

      // Update rosters for add-player UI
      if (data.home_roster || data.away_roster) {
        setRoster({ home: data.home_roster || [], away: data.away_roster || [] });
      }

      // Update player statuses from server response (fixes fuzzy name matches)
      if (data.player_statuses) {
        const newPlayers = {};
        for (const ps of data.player_statuses) {
          const key = `${ps.team}::${ps.name}`;
          newPlayers[key] = {
            name: ps.name,
            team: ps.team,
            status: ps.status,
            original: players[key]?.original ?? false,
            serverData: ps,
          };
        }
        setPlayers(newPlayers);
      }

      // Notify parent
      onAdjusted?.({
        adjustedMargin: data.adjusted_margin,
        adjustedWp: data.adjusted_wp,
        impactDelta: data.impact_delta,
        newImpact: data.new_impact,
      });
    } catch (e) {
      setError(e.message);
      console.error("[PlayerImpact] recalc error:", e);
    }
    setLoading(false);
  }, [gameId, players, onAdjusted]);

  // Group players by team
  const homePlayers = Object.entries(players).filter(([_, p]) => p.team === homeAbbr);
  const awayPlayers = Object.entries(players).filter(([_, p]) => p.team === awayAbbr);
  const hasPlayers = homePlayers.length > 0 || awayPlayers.length > 0;

  // Filter roster for add-player autocomplete
  const getFilteredRoster = (side) => {
    const r = side === "home" ? roster.home : roster.away;
    const existingNames = new Set(
      Object.values(players)
        .filter(p => p.team === (side === "home" ? homeAbbr : awayAbbr))
        .map(p => p.name.toLowerCase())
    );
    return r
      .filter(p => !existingNames.has(p.name.toLowerCase()))
      .filter(p => !addSearch || p.name.toLowerCase().includes(addSearch.toLowerCase()));
  };

  return (
    <div style={{
      marginTop: 12,
      borderTop: `1px solid ${C.border}`,
      paddingTop: 12,
    }}>
      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.orange, letterSpacing: 1 }}>
            🏥 PLAYER STATUS
          </span>
          {impactAdjustment !== 0 && !adjustResult && (
            <span style={{ fontSize: 10, color: C.dim }}>
              Current: {impactAdjustment > 0 ? "+" : ""}{impactAdjustment.toFixed(1)} pts
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {dirty && (
            <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600 }}>● unsaved</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); recalculate(); }}
            disabled={loading}
            style={{
              background: dirty ? C.blue : "#21262d",
              color: dirty ? "#fff" : C.dim,
              border: `1px solid ${dirty ? C.blue : C.border}`,
              borderRadius: 5,
              padding: "3px 10px",
              fontSize: 10,
              fontWeight: 700,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            {loading ? "⏳ Calculating…" : hasPlayers ? "⚡ Recalculate" : "⚡ Load Rosters"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 10, color: C.red, marginBottom: 8, padding: "4px 8px",
          background: "rgba(248,81,73,0.1)", borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Player lists by team */}
      {[
        { abbr: homeAbbr, label: "HOME", players: homePlayers, side: "home", gtd: homeGtdPlayers },
        { abbr: awayAbbr, label: "AWAY", players: awayPlayers, side: "away", gtd: awayGtdPlayers },
      ].map(({ abbr, label, players: teamPlayers, side, gtd }) => (
        <div key={abbr} style={{ marginBottom: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 4,
          }}>
            <span style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 1 }}>
              {abbr} ({label})
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAdd(showAdd === side ? null : side);
                setAddSearch("");
                // Auto-fetch rosters if empty
                if (!roster.home.length && !roster.away.length) recalculate();
              }}
              style={{
                background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4,
                color: C.blue, fontSize: 9, padding: "1px 6px", cursor: "pointer",
              }}
            >
              + Add
            </button>
          </div>

          {/* Player rows */}
          {teamPlayers.length === 0 && (!gtd || gtd.length === 0) && (
            <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic", marginBottom: 4 }}>
              No reported injuries
            </div>
          )}
          {teamPlayers.map(([key, p]) => (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: 5,
              marginBottom: 3,
              borderLeft: `3px solid ${STATUS_COLORS[p.status]}`,
            }}>
              {/* Status toggle button */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleStatus(key); }}
                style={{
                  width: 22, height: 22, borderRadius: 4,
                  background: `${STATUS_COLORS[p.status]}22`,
                  border: `1px solid ${STATUS_COLORS[p.status]}`,
                  color: STATUS_COLORS[p.status],
                  fontSize: 11, fontWeight: 800,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
                title={`Click to cycle: ${p.status} → ${STATUS_CYCLE[p.status]}`}
              >
                {STATUS_ICONS[p.status]}
              </button>

              {/* Player info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                    {p.name}
                  </span>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                    color: STATUS_COLORS[p.status],
                    padding: "0 4px",
                    background: `${STATUS_COLORS[p.status]}18`,
                    borderRadius: 3,
                  }}>
                    {p.status}
                  </span>
                  {!p.original && (
                    <span style={{ fontSize: 8, color: C.blue }}>added</span>
                  )}
                </div>
                {p.serverData && (
                  <div style={{ fontSize: 9, color: C.dim }}>
                    {p.serverData.mpg > 0 ? `${p.serverData.mpg} mpg` : ""}
                    {p.serverData.bpm ? ` · BPM ${p.serverData.bpm > 0 ? "+" : ""}${p.serverData.bpm}` : ""}
                    {p.serverData.margin_impact ? ` · ${p.serverData.margin_impact > 0 ? "+" : ""}${p.serverData.margin_impact} pts` : ""}
                  </div>
                )}
              </div>

              {/* Remove button (only for manually added) */}
              {!p.original && (
                <button
                  onClick={(e) => { e.stopPropagation(); removePlayer(key); }}
                  style={{
                    background: "transparent", border: "none", color: C.muted,
                    cursor: "pointer", fontSize: 12, padding: "0 4px",
                  }}
                  title="Remove player"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {/* GTD players (warning display — click ⚠ to toggle to OUT) */}
          {gtd && gtd.length > 0 && gtd.map((g, i) => {
            const gtdKey = `${abbr}::${g.name}`;
            const alreadyAdded = !!players[gtdKey];
            if (alreadyAdded) return null; // already in interactive list above
            return (
            <div key={`gtd-${i}`} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px",
              background: "rgba(210,153,34,0.08)",
              borderRadius: 5,
              marginBottom: 3,
              borderLeft: `3px solid ${C.yellow}`,
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPlayers(prev => ({
                    ...prev,
                    [gtdKey]: { name: g.name, team: abbr, status: "OUT", original: false },
                  }));
                  setDirty(true);
                }}
                style={{
                  width: 22, height: 22, borderRadius: 4,
                  background: `${C.yellow}22`,
                  border: `1px solid ${C.yellow}`,
                  color: C.yellow,
                  fontSize: 10, fontWeight: 800,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
                title="Click to mark as OUT"
              >⚠</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                    {g.name}
                  </span>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                    color: C.yellow,
                    padding: "0 4px",
                    background: `${C.yellow}18`,
                    borderRadius: 3,
                  }}>GTD</span>
                  <span style={{ fontSize: 8, color: C.dim }}>tap to mark OUT</span>
                </div>
                <div style={{ fontSize: 9, color: C.dim }}>
                  {g.impact ? `${g.impact > 0 ? "+" : ""}${g.impact} pts if OUT` : ""}
                  {g.note ? ` · ${g.note.substring(0, 50)}` : ""}
                </div>
              </div>
            </div>
            );
          })}

          {/* Add player dropdown */}
          {showAdd === side && (
            <div style={{
              background: "#161b22",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: 8,
              marginTop: 4,
            }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                placeholder="Search player…"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "#0d1117", color: "#e2e8f0",
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  padding: "5px 8px", fontSize: 11, fontFamily: "inherit",
                  marginBottom: 6, outline: "none",
                }}
              />
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {getFilteredRoster(side).length === 0 ? (
                  <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: 8 }}>
                    {roster[side].length === 0
                      ? "Press ⚡ Recalculate to load rosters"
                      : "No matching players"}
                  </div>
                ) : (
                  getFilteredRoster(side).map(rp => (
                    <div
                      key={rp.name}
                      onClick={() => addPlayer(rp.name, abbr)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                        fontSize: 11, color: "#e2e8f0",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(88,166,255,0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <span>{rp.name}</span>
                      <span style={{ fontSize: 9, color: C.dim }}>
                        {rp.mpg}mpg · {rp.margin_impact > 0 ? "+" : ""}{rp.margin_impact}pts
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Adjustment result */}
      {adjustResult && (
        <div style={{
          marginTop: 8,
          padding: "8px 10px",
          background: "rgba(88,166,255,0.08)",
          border: `1px solid ${C.blue}33`,
          borderRadius: 6,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 10 }}>
              <span style={{ color: C.dim }}>Margin: </span>
              <span style={{ color: C.muted, textDecoration: "line-through", marginRight: 4 }}>
                {adjustResult.original_margin > 0 ? "+" : ""}{adjustResult.original_margin.toFixed(1)}
              </span>
              <span style={{ color: C.blue, fontWeight: 700 }}>
                → {adjustResult.adjusted_margin > 0 ? "+" : ""}{adjustResult.adjusted_margin.toFixed(1)}
              </span>
            </div>
            <div style={{ fontSize: 10 }}>
              <span style={{ color: C.dim }}>Win%: </span>
              <span style={{ color: C.muted, textDecoration: "line-through", marginRight: 4 }}>
                {(adjustResult.original_wp * 100).toFixed(1)}%
              </span>
              <span style={{ color: C.blue, fontWeight: 700 }}>
                → {(adjustResult.adjusted_wp * 100).toFixed(1)}%
              </span>
            </div>
            {adjustResult.impact_delta !== 0 && (
              <div style={{ fontSize: 10 }}>
                <span style={{ color: C.dim }}>Δ impact: </span>
                <span style={{
                  color: adjustResult.impact_delta > 0 ? C.red : C.green,
                  fontWeight: 700,
                }}>
                  {adjustResult.impact_delta > 0 ? "+" : ""}{adjustResult.impact_delta.toFixed(1)} pts
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
