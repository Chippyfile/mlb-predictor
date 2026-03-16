import { useState, useMemo } from "react";

const TEAMS = [{"name":"Michigan","seed":1,"region":"midwest","r32":97.12,"s16":80.35,"e8":54.65,"f4":33.52,"ncg":19.98,"champ":11.57},{"name":"Arizona","seed":1,"region":"west","r32":97.09,"s16":79.62,"e8":54.79,"f4":33.5,"ncg":19.43,"champ":11.17},{"name":"Duke","seed":1,"region":"east","r32":97.1,"s16":80.17,"e8":54.72,"f4":34.15,"ncg":19.82,"champ":11.1},{"name":"Florida","seed":1,"region":"south","r32":97.48,"s16":80.33,"e8":54.74,"f4":33.51,"ncg":19.52,"champ":10.87},{"name":"Houston","seed":2,"region":"south","r32":95.16,"s16":74.42,"e8":46.77,"f4":25.49,"ncg":13.66,"champ":7.05},{"name":"Iowa State","seed":2,"region":"midwest","r32":94.99,"s16":72.98,"e8":45.48,"f4":24.91,"ncg":13.39,"champ":6.79},{"name":"UConn","seed":2,"region":"east","r32":95.15,"s16":73.42,"e8":44.79,"f4":23.94,"ncg":12.41,"champ":6.57},{"name":"Purdue","seed":2,"region":"west","r32":95.04,"s16":74.06,"e8":44.56,"f4":23.84,"ncg":12.47,"champ":6.42},{"name":"Virginia","seed":3,"region":"midwest","r32":91.71,"s16":63.97,"e8":32.57,"f4":16.05,"ncg":7.85,"champ":3.94},{"name":"Gonzaga","seed":3,"region":"west","r32":92.19,"s16":65.15,"e8":35.14,"f4":17.61,"ncg":8.35,"champ":3.75},{"name":"Illinois","seed":3,"region":"south","r32":91.86,"s16":64.46,"e8":32.73,"f4":16.53,"ncg":8.22,"champ":3.73},{"name":"Michigan State","seed":3,"region":"east","r32":91.86,"s16":64.04,"e8":33.8,"f4":16.61,"ncg":7.93,"champ":3.66},{"name":"Alabama","seed":4,"region":"midwest","r32":87.64,"s16":52.26,"e8":21.9,"f4":10.44,"ncg":4.52,"champ":1.92},{"name":"Arkansas","seed":4,"region":"west","r32":87.33,"s16":53.32,"e8":21.93,"f4":10.09,"ncg":4.39,"champ":1.88},{"name":"Nebraska","seed":4,"region":"south","r32":86.92,"s16":53.57,"e8":22.83,"f4":10.15,"ncg":4.36,"champ":1.77},{"name":"Kansas","seed":4,"region":"east","r32":87.16,"s16":52.83,"e8":22.55,"f4":10.34,"ncg":4.34,"champ":1.75},{"name":"Texas Tech","seed":5,"region":"midwest","r32":82.18,"s16":41.1,"e8":15.99,"f4":6.58,"ncg":2.52,"champ":0.93},{"name":"Vanderbilt","seed":5,"region":"south","r32":80.95,"s16":39.6,"e8":14.99,"f4":5.89,"ncg":2.41,"champ":0.85},{"name":"Wisconsin","seed":5,"region":"west","r32":80.91,"s16":40.05,"e8":15.39,"f4":6.57,"ncg":2.42,"champ":0.84},{"name":"St. John's","seed":5,"region":"east","r32":80.97,"s16":40.78,"e8":15.43,"f4":6.48,"ncg":2.53,"champ":0.8},{"name":"Tennessee","seed":6,"region":"midwest","r32":73.96,"s16":29.04,"e8":11.39,"f4":3.89,"ncg":1.27,"champ":0.49},{"name":"North Carolina","seed":6,"region":"south","r32":73.69,"s16":28.81,"e8":10.66,"f4":3.77,"ncg":1.15,"champ":0.39},{"name":"Louisville","seed":6,"region":"east","r32":73.65,"s16":29.18,"e8":11.29,"f4":3.72,"ncg":1.13,"champ":0.36},{"name":"BYU","seed":6,"region":"west","r32":73.18,"s16":27.94,"e8":10.83,"f4":3.75,"ncg":1.13,"champ":0.32},{"name":"UCLA","seed":7,"region":"east","r32":64.83,"s16":19.15,"e8":7.27,"f4":2.29,"ncg":0.65,"champ":0.2},{"name":"Saint Mary's","seed":7,"region":"south","r32":65.7,"s16":18.66,"e8":6.99,"f4":2.33,"ncg":0.85,"champ":0.18},{"name":"Miami FL","seed":7,"region":"west","r32":64.79,"s16":18.12,"e8":6.65,"f4":2.02,"ncg":0.54,"champ":0.16},{"name":"Kentucky","seed":7,"region":"midwest","r32":65.3,"s16":19.76,"e8":7.68,"f4":2.35,"ncg":0.68,"champ":0.15},{"name":"Ohio State","seed":8,"region":"east","r32":55.45,"s16":11.56,"e8":4.14,"f4":1.31,"ncg":0.37,"champ":0.14},{"name":"Villanova","seed":8,"region":"west","r32":55.84,"s16":12.02,"e8":4.5,"f4":1.34,"ncg":0.33,"champ":0.07},{"name":"Utah State","seed":9,"region":"west","r32":44.16,"s16":7.86,"e8":2.52,"f4":0.58,"ncg":0.11,"champ":0.04},{"name":"Georgia","seed":8,"region":"midwest","r32":54.5,"s16":11.32,"e8":4.23,"f4":1.17,"ncg":0.33,"champ":0.03},{"name":"Saint Louis","seed":9,"region":"midwest","r32":45.5,"s16":7.87,"e8":2.47,"f4":0.53,"ncg":0.13,"champ":0.03},{"name":"Clemson","seed":8,"region":"south","r32":55.09,"s16":11.41,"e8":4.18,"f4":1.08,"ncg":0.29,"champ":0.03},{"name":"Iowa","seed":9,"region":"south","r32":44.91,"s16":7.7,"e8":2.48,"f4":0.62,"ncg":0.12,"champ":0.02},{"name":"UCF","seed":10,"region":"east","r32":35.17,"s16":6.4,"e8":1.49,"f4":0.25,"ncg":0.05,"champ":0.01},{"name":"Missouri","seed":10,"region":"west","r32":35.21,"s16":6.69,"e8":1.5,"f4":0.34,"ncg":0.06,"champ":0.01},{"name":"Santa Clara","seed":10,"region":"midwest","r32":34.7,"s16":6.36,"e8":1.63,"f4":0.29,"ncg":0.03,"champ":0.01},{"name":"Siena","seed":16,"region":"east","r32":2.9,"s16":0.45,"e8":0.02,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"TCU","seed":9,"region":"east","r32":44.55,"s16":7.82,"e8":2.44,"f4":0.58,"ncg":0.09,"champ":0.0},{"name":"Northern Iowa","seed":12,"region":"east","r32":19.03,"s16":3.71,"e8":0.44,"f4":0.06,"ncg":0.0,"champ":0.0},{"name":"Cal Baptist","seed":13,"region":"east","r32":12.84,"s16":2.68,"e8":0.26,"f4":0.03,"ncg":0.01,"champ":0.0},{"name":"South Florida","seed":11,"region":"east","r32":26.35,"s16":4.91,"e8":1.03,"f4":0.19,"ncg":0.02,"champ":0.0},{"name":"North Dakota State","seed":14,"region":"east","r32":8.14,"s16":1.87,"e8":0.24,"f4":0.04,"ncg":0.0,"champ":0.0},{"name":"Furman","seed":15,"region":"east","r32":4.85,"s16":1.03,"e8":0.09,"f4":0.01,"ncg":0.0,"champ":0.0},{"name":"LIU","seed":16,"region":"west","r32":2.91,"s16":0.5,"e8":0.05,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"High Point","seed":12,"region":"west","r32":19.09,"s16":3.76,"e8":0.56,"f4":0.14,"ncg":0.02,"champ":0.0},{"name":"Hawaii","seed":13,"region":"west","r32":12.67,"s16":2.87,"e8":0.26,"f4":0.02,"ncg":0.0,"champ":0.0},{"name":"Texas","seed":11,"region":"west","r32":26.82,"s16":5.29,"e8":0.99,"f4":0.2,"ncg":0.0,"champ":0.0},{"name":"Kennesaw State","seed":14,"region":"west","r32":7.81,"s16":1.62,"e8":0.2,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"Queens","seed":15,"region":"west","r32":4.96,"s16":1.13,"e8":0.13,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"UMBC","seed":16,"region":"midwest","r32":2.88,"s16":0.46,"e8":0.0,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"Akron","seed":12,"region":"midwest","r32":17.82,"s16":3.91,"e8":0.53,"f4":0.08,"ncg":0.02,"champ":0.0},{"name":"Hofstra","seed":13,"region":"midwest","r32":12.36,"s16":2.73,"e8":0.23,"f4":0.04,"ncg":0.0,"champ":0.0},{"name":"SMU","seed":11,"region":"midwest","r32":26.04,"s16":5.12,"e8":0.96,"f4":0.14,"ncg":0.03,"champ":0.0},{"name":"Wright State","seed":14,"region":"midwest","r32":8.29,"s16":1.87,"e8":0.21,"f4":0.01,"ncg":0.0,"champ":0.0},{"name":"Tennessee State","seed":15,"region":"midwest","r32":5.01,"s16":0.9,"e8":0.08,"f4":0.0,"ncg":0.0,"champ":0.0},{"name":"Lehigh","seed":16,"region":"south","r32":2.52,"s16":0.56,"e8":0.04,"f4":0.01,"ncg":0.01,"champ":0.0},{"name":"McNeese","seed":12,"region":"south","r32":19.05,"s16":3.78,"e8":0.43,"f4":0.09,"ncg":0.01,"champ":0.0},{"name":"Troy","seed":13,"region":"south","r32":13.08,"s16":3.05,"e8":0.31,"f4":0.05,"ncg":0.0,"champ":0.0},{"name":"VCU","seed":11,"region":"south","r32":26.31,"s16":5.2,"e8":1.09,"f4":0.16,"ncg":0.02,"champ":0.0},{"name":"Penn","seed":14,"region":"south","r32":8.14,"s16":1.53,"e8":0.22,"f4":0.03,"ncg":0.0,"champ":0.0},{"name":"Texas A&M","seed":10,"region":"south","r32":34.3,"s16":6.05,"e8":1.47,"f4":0.29,"ncg":0.03,"champ":0.0},{"name":"Idaho","seed":15,"region":"south","r32":4.84,"s16":0.87,"e8":0.07,"f4":0.0,"ncg":0.0,"champ":0.0}];

const BRACKET_ORDER = {
  east: [
    [1,"Duke",16,"Siena"],[8,"Ohio State",9,"TCU"],
    [5,"St. John's",12,"Northern Iowa"],[4,"Kansas",13,"Cal Baptist"],
    [6,"Louisville",11,"South Florida"],[3,"Michigan State",14,"North Dakota State"],
    [7,"UCLA",10,"UCF"],[2,"UConn",15,"Furman"]
  ],
  west: [
    [1,"Arizona",16,"LIU"],[8,"Villanova",9,"Utah State"],
    [5,"Wisconsin",12,"High Point"],[4,"Arkansas",13,"Hawaii"],
    [6,"BYU",11,"Texas"],[3,"Gonzaga",14,"Kennesaw State"],
    [7,"Miami FL",10,"Missouri"],[2,"Purdue",15,"Queens"]
  ],
  midwest: [
    [1,"Michigan",16,"UMBC"],[8,"Georgia",9,"Saint Louis"],
    [5,"Texas Tech",12,"Akron"],[4,"Alabama",13,"Hofstra"],
    [6,"Tennessee",11,"SMU"],[3,"Virginia",14,"Wright State"],
    [7,"Kentucky",10,"Santa Clara"],[2,"Iowa State",15,"Tennessee State"]
  ],
  south: [
    [1,"Florida",16,"Lehigh"],[8,"Clemson",9,"Iowa"],
    [5,"Vanderbilt",12,"McNeese"],[4,"Nebraska",13,"Troy"],
    [6,"North Carolina",11,"VCU"],[3,"Illinois",14,"Penn"],
    [7,"Saint Mary's",10,"Texas A&M"],[2,"Houston",15,"Idaho"]
  ]
};

const REGION_COLORS = {
  east: { bg: "#1a2744", accent: "#3b82f6", light: "#60a5fa" },
  west: { bg: "#1a3324", accent: "#22c55e", light: "#4ade80" },
  midwest: { bg: "#2d1f3d", accent: "#a855f7", light: "#c084fc" },
  south: { bg: "#331a1a", accent: "#ef4444", light: "#f87171" },
};

const ROUNDS = ["r32","s16","e8","f4","ncg","champ"];
const ROUND_LABELS = { r32:"Rd of 32", s16:"Sweet 16", e8:"Elite 8", f4:"Final Four", ncg:"Title Game", champ:"Champion" };

function getTeam(name) {
  return TEAMS.find(t => t.name === name) || { name, seed: 0, r32:0, s16:0, e8:0, f4:0, ncg:0, champ:0, region:"" };
}

function probColor(p) {
  if (p >= 80) return "#22c55e";
  if (p >= 50) return "#84cc16";
  if (p >= 25) return "#eab308";
  if (p >= 10) return "#f97316";
  return "#ef4444";
}

function ProbBar({ value, maxWidth = 100, height = 6 }) {
  const w = Math.max(1, (value / 100) * maxWidth);
  return (
    <div style={{ width: maxWidth, height, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow:"hidden" }}>
      <div style={{ width: w, height: "100%", background: probColor(value), borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );
}

function TeamRow({ seed, name, region, isSelected, onClick }) {
  const t = getTeam(name);
  const rc = REGION_COLORS[region];
  return (
    <div onClick={() => onClick(name)} style={{
      display:"flex", alignItems:"center", gap: 6, padding: "5px 8px", cursor:"pointer",
      background: isSelected ? `${rc.accent}22` : "transparent",
      borderLeft: isSelected ? `3px solid ${rc.accent}` : "3px solid transparent",
      borderRadius: 4, transition: "all 0.15s",
      fontSize: 12, fontFamily: "'JetBrains Mono', 'SF Mono', monospace"
    }}>
      <span style={{ color: "rgba(255,255,255,0.35)", width: 18, textAlign:"right", fontWeight: 600, fontSize:10 }}>{seed}</span>
      <span style={{ flex:1, color: isSelected ? "#fff" : "rgba(255,255,255,0.8)", fontWeight: isSelected ? 700 : 400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</span>
      <span style={{ color: rc.light, fontWeight: 700, fontSize: 11, minWidth: 36, textAlign:"right" }}>
        {t.r32.toFixed(0)}%
      </span>
    </div>
  );
}

function RegionBracket({ region, label, selectedTeam, onSelect }) {
  const rc = REGION_COLORS[region];
  const matchups = BRACKET_ORDER[region];
  return (
    <div style={{
      background: `linear-gradient(135deg, ${rc.bg} 0%, #0d1117 100%)`,
      borderRadius: 12, padding: "14px 10px", border: `1px solid ${rc.accent}33`,
      minWidth: 220
    }}>
      <div style={{ display:"flex", alignItems:"center", gap: 8, marginBottom: 10, paddingLeft: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: rc.accent, boxShadow: `0 0 8px ${rc.accent}` }} />
        <span style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize: 16, letterSpacing: 2, color: rc.light, textTransform:"uppercase" }}>
          {label}
        </span>
      </div>
      {matchups.map(([s1, n1, s2, n2], i) => (
        <div key={i} style={{ marginBottom: i % 2 === 0 ? 0 : 8 }}>
          <TeamRow seed={s1} name={n1} region={region} isSelected={selectedTeam===n1} onClick={onSelect} />
          <TeamRow seed={s2} name={n2} region={region} isSelected={selectedTeam===n2} onClick={onSelect} />
          {i % 2 === 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin:"3px 8px" }} />}
        </div>
      ))}
    </div>
  );
}

function TeamDetail({ team }) {
  if (!team) return null;
  const t = getTeam(team);
  const rc = REGION_COLORS[t.region];
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 20,
      border: `1px solid ${rc.accent}44`, backdropFilter: "blur(10px)"
    }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:16 }}>
        <span style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:28, color:"#fff", letterSpacing:1 }}>{t.name}</span>
        <span style={{ color: rc.light, fontSize: 14, fontWeight: 600 }}>({t.seed}) {t.region.toUpperCase()}</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"120px 60px 1fr", gap:"8px 12px", alignItems:"center" }}>
        {ROUNDS.map(r => (
          <React.Fragment key={r}>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontFamily:"'JetBrains Mono',monospace" }}>
              {ROUND_LABELS[r]}
            </span>
            <span style={{ fontSize:14, fontWeight:700, color: probColor(t[r]), textAlign:"right", fontFamily:"'JetBrains Mono',monospace" }}>
              {t[r].toFixed(1)}%
            </span>
            <ProbBar value={t[r]} maxWidth={180} height={10} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ChampionshipTable({ filter, onSelect, selectedTeam }) {
  const filtered = useMemo(() => {
    let teams = [...TEAMS];
    if (filter !== "all") teams = teams.filter(t => t.region === filter);
    return teams.sort((a,b) => b.champ - a.champ).slice(0, 20);
  }, [filter]);

  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"'JetBrains Mono','SF Mono',monospace" }}>
        <thead>
          <tr style={{ color:"rgba(255,255,255,0.35)", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            {["Team","","R32","S16","E8","F4","Title","Champ"].map(h => (
              <th key={h} style={{ padding:"6px 8px", textAlign: h==="Team"?"left":"right", fontWeight:500, fontSize:10, textTransform:"uppercase", letterSpacing:1 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((t, i) => {
            const rc = REGION_COLORS[t.region];
            const sel = selectedTeam === t.name;
            return (
              <tr key={t.name} onClick={() => onSelect(t.name)} style={{
                cursor:"pointer", background: sel ? `${rc.accent}15` : "transparent",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                transition: "background 0.15s"
              }}>
                <td style={{ padding:"7px 8px", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background: rc.accent, display:"inline-block", flexShrink:0 }} />
                  <span style={{ color: sel ? "#fff" : "rgba(255,255,255,0.8)", fontWeight: sel ? 700 : 400 }}>{t.name}</span>
                </td>
                <td style={{ padding:"7px 4px", textAlign:"right", color:"rgba(255,255,255,0.3)", fontSize:10 }}>({t.seed})</td>
                {[t.r32,t.s16,t.e8,t.f4,t.ncg,t.champ].map((v,j) => (
                  <td key={j} style={{ padding:"7px 8px", textAlign:"right", color: probColor(v), fontWeight: j===5 ? 700 : 400 }}>
                    {v > 0 ? v.toFixed(1)+"%" : "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MarchMadnessPanel() {
  const [selectedTeam, setSelectedTeam] = useState("Duke");
  const [view, setView] = useState("bracket");
  const [regionFilter, setRegionFilter] = useState("all");

  const topFour = useMemo(() =>
    TEAMS.sort((a,b) => b.champ - a.champ).slice(0,4), []);

  const f4Teams = useMemo(() =>
    TEAMS.sort((a,b) => b.f4 - a.f4).slice(0,4), []);

  return (
    <div style={{
      minHeight:"100vh", background:"#0d1117", color:"#e6edf3",
      fontFamily: "'Inter','SF Pro Display',-apple-system,sans-serif",
      padding: "0 0 40px 0"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "24px 20px 16px", marginBottom: 20
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
            <span style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:32, letterSpacing:3, color:"#fff" }}>
              MARCH MADNESS 2026
            </span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:1 }}>
              MONTE CARLO BRACKET SIMULATOR
            </span>
          </div>
          <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"rgba(255,255,255,0.25)", marginRight:4 }}>10,000 SIMS</span>
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.15)" }}>•</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"rgba(255,255,255,0.25)" }}>SEED-BASED SPREADS (σ=11)</span>
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.15)" }}>•</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#f59e0b" }}>
              RUN WITH --api FLAG FOR ML PREDICTIONS
            </span>
          </div>
          {/* Nav */}
          <div style={{ display:"flex", gap:2, marginTop:14 }}>
            {[["bracket","Bracket"],["rankings","Rankings"]].map(([k,l]) => (
              <button key={k} onClick={() => setView(k)} style={{
                padding:"6px 16px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                fontFamily:"'Inter',sans-serif", letterSpacing:0.5,
                background: view===k ? "rgba(255,255,255,0.1)" : "transparent",
                color: view===k ? "#fff" : "rgba(255,255,255,0.4)",
                transition:"all 0.15s"
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px" }}>
        {/* Championship odds cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:10, marginBottom:20 }}>
          {topFour.map(t => {
            const rc = REGION_COLORS[t.region];
            return (
              <div key={t.name} onClick={() => setSelectedTeam(t.name)} style={{
                background: `linear-gradient(135deg, ${rc.bg} 0%, #0d1117 100%)`,
                border: `1px solid ${selectedTeam===t.name ? rc.accent : rc.accent+"33"}`,
                borderRadius: 10, padding: "12px 14px", cursor:"pointer", transition:"all 0.2s",
                transform: selectedTeam===t.name ? "scale(1.02)" : "scale(1)"
              }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>{t.name}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginBottom:6, fontFamily:"'JetBrains Mono',monospace" }}>
                  ({t.seed}) {t.region.toUpperCase()}
                </div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700, color: rc.light }}>
                  {t.champ.toFixed(1)}%
                </div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>
                  TITLE ODDS
                </div>
              </div>
            );
          })}
        </div>

        {/* Most Likely Final Four */}
        <div style={{
          background:"rgba(255,255,255,0.02)", borderRadius:10, padding:"12px 16px", marginBottom:20,
          border:"1px solid rgba(255,255,255,0.06)", display:"flex", gap:16, alignItems:"center", flexWrap:"wrap"
        }}>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, letterSpacing:2, color:"rgba(255,255,255,0.4)" }}>
            MOST LIKELY FINAL FOUR
          </span>
          {f4Teams.map(t => {
            const rc = REGION_COLORS[t.region];
            return (
              <span key={t.name} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:rc.accent }} />
                <span style={{ fontSize:12, fontWeight:600, color:"#fff" }}>{t.name}</span>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontFamily:"'JetBrains Mono',monospace" }}>
                  {t.f4.toFixed(0)}%
                </span>
              </span>
            );
          })}
        </div>

        {view === "bracket" ? (
          <div style={{ display:"flex", gap:16, flexDirection:"column" }}>
            {/* Bracket grid */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(230px, 1fr))", gap:12 }}>
              <RegionBracket region="east" label="East — Washington D.C." selectedTeam={selectedTeam} onSelect={setSelectedTeam} />
              <RegionBracket region="west" label="West — San Jose" selectedTeam={selectedTeam} onSelect={setSelectedTeam} />
              <RegionBracket region="midwest" label="Midwest — Chicago" selectedTeam={selectedTeam} onSelect={setSelectedTeam} />
              <RegionBracket region="south" label="South — Houston" selectedTeam={selectedTeam} onSelect={setSelectedTeam} />
            </div>
            {/* Team detail */}
            <TeamDetail team={selectedTeam} />
          </div>
        ) : (
          <div>
            {/* Region filter */}
            <div style={{ display:"flex", gap:4, marginBottom:14, flexWrap:"wrap" }}>
              {[["all","All Teams"],["east","East"],["west","West"],["midwest","Midwest"],["south","South"]].map(([k,l]) => {
                const rc = k==="all" ? { accent:"#fff" } : REGION_COLORS[k];
                return (
                  <button key={k} onClick={() => setRegionFilter(k)} style={{
                    padding:"5px 14px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:600,
                    background: regionFilter===k ? `${rc.accent}22` : "transparent",
                    color: regionFilter===k ? rc.accent : "rgba(255,255,255,0.35)",
                    transition:"all 0.15s", fontFamily:"'Inter',sans-serif"
                  }}>{l}</button>
                );
              })}
            </div>
            <ChampionshipTable filter={regionFilter} onSelect={setSelectedTeam} selectedTeam={selectedTeam} />
            <div style={{ marginTop:16 }}>
              <TeamDetail team={selectedTeam} />
            </div>
          </div>
        )}

        {/* Footer note */}
        <div style={{
          marginTop: 24, padding: "14px 16px", background: "rgba(245,158,11,0.06)",
          border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8
        }}>
          <div style={{ fontSize:11, color:"#f59e0b", fontWeight:600, marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>
            ⚠ SEED-BASED BASELINE
          </div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.5 }}>
            These probabilities use seed-difference spreads (σ=11). For ML-powered predictions using the full 146-feature model, run:
          </div>
          <code style={{
            display:"block", marginTop:8, padding:"8px 12px", background:"rgba(0,0,0,0.3)",
            borderRadius:6, fontSize:11, color:"#7ee787", fontFamily:"'JetBrains Mono',monospace"
          }}>
            python3 march_madness_sim.py --sims 10000 --output results.json
          </code>
        </div>
      </div>
    </div>
  );
}
