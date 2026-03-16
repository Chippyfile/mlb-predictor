import React, { useState, useCallback, useRef, useEffect } from "react";

const ML_API = "https://sports-predictor-api-production.up.railway.app";

// ═══════════════════════════════════════════════════════════════
// 2026 BRACKET
// ═══════════════════════════════════════════════════════════════
const REGIONS = {
  east: {
    label: "EAST", city: "Washington D.C.", color: "#3b82f6", dark: "#1a2744",
    teams: [
      { seed:1,name:"Duke",id:150,full:"Duke Blue Devils" },
      { seed:16,name:"Siena",id:2547,full:"Siena Saints" },
      { seed:8,name:"Ohio State",id:194,full:"Ohio State Buckeyes" },
      { seed:9,name:"TCU",id:2628,full:"TCU Horned Frogs" },
      { seed:5,name:"St. John's",id:2599,full:"St. John's Red Storm" },
      { seed:12,name:"N. Iowa",id:2460,full:"Northern Iowa Panthers" },
      { seed:4,name:"Kansas",id:2305,full:"Kansas Jayhawks" },
      { seed:13,name:"Cal Baptist",id:2856,full:"California Baptist Lancers" },
      { seed:6,name:"Louisville",id:97,full:"Louisville Cardinals" },
      { seed:11,name:"S. Florida",id:58,full:"South Florida Bulls" },
      { seed:3,name:"Mich. State",id:127,full:"Michigan State Spartans" },
      { seed:14,name:"NDSU",id:2449,full:"North Dakota State Bison" },
      { seed:7,name:"UCLA",id:26,full:"UCLA Bruins" },
      { seed:10,name:"UCF",id:2116,full:"UCF Knights" },
      { seed:2,name:"UConn",id:41,full:"UConn Huskies" },
      { seed:15,name:"Furman",id:231,full:"Furman Paladins" },
    ]
  },
  west: {
    label: "WEST", city: "San Jose", color: "#22c55e", dark: "#1a3324",
    teams: [
      { seed:1,name:"Arizona",id:12,full:"Arizona Wildcats" },
      { seed:16,name:"LIU",id:112,full:"LIU Sharks" },
      { seed:8,name:"Villanova",id:2918,full:"Villanova Wildcats" },
      { seed:9,name:"Utah State",id:328,full:"Utah State Aggies" },
      { seed:5,name:"Wisconsin",id:275,full:"Wisconsin Badgers" },
      { seed:12,name:"High Point",id:2272,full:"High Point Panthers" },
      { seed:4,name:"Arkansas",id:8,full:"Arkansas Razorbacks" },
      { seed:13,name:"Hawaii",id:62,full:"Hawai'i Rainbow Warriors" },
      { seed:6,name:"BYU",id:252,full:"BYU Cougars" },
      { seed:11,name:"Texas",id:251,full:"Texas Longhorns" },
      { seed:3,name:"Gonzaga",id:2250,full:"Gonzaga Bulldogs" },
      { seed:14,name:"Kennesaw St",id:338,full:"Kennesaw State Owls" },
      { seed:7,name:"Miami FL",id:2390,full:"Miami Hurricanes" },
      { seed:10,name:"Missouri",id:142,full:"Missouri Tigers" },
      { seed:2,name:"Purdue",id:2509,full:"Purdue Boilermakers" },
      { seed:15,name:"Queens",id:2818,full:"Queens Royals" },
    ]
  },
  midwest: {
    label: "MIDWEST", city: "Chicago", color: "#a855f7", dark: "#2d1f3d",
    teams: [
      { seed:1,name:"Michigan",id:130,full:"Michigan Wolverines" },
      { seed:16,name:"UMBC",id:2692,full:"UMBC Retrievers" },
      { seed:8,name:"Georgia",id:61,full:"Georgia Bulldogs" },
      { seed:9,name:"Saint Louis",id:139,full:"Saint Louis Billikens" },
      { seed:5,name:"Texas Tech",id:2641,full:"Texas Tech Red Raiders" },
      { seed:12,name:"Akron",id:2006,full:"Akron Zips" },
      { seed:4,name:"Alabama",id:333,full:"Alabama Crimson Tide" },
      { seed:13,name:"Hofstra",id:2275,full:"Hofstra Pride" },
      { seed:6,name:"Tennessee",id:2633,full:"Tennessee Volunteers" },
      { seed:11,name:"SMU",id:2567,full:"SMU Mustangs" },
      { seed:3,name:"Virginia",id:258,full:"Virginia Cavaliers" },
      { seed:14,name:"Wright St",id:2750,full:"Wright State Raiders" },
      { seed:7,name:"Kentucky",id:96,full:"Kentucky Wildcats" },
      { seed:10,name:"Santa Clara",id:2491,full:"Santa Clara Broncos" },
      { seed:2,name:"Iowa State",id:66,full:"Iowa State Cyclones" },
      { seed:15,name:"Tenn. State",id:2634,full:"Tennessee State Tigers" },
    ]
  },
  south: {
    label: "SOUTH", city: "Houston", color: "#ef4444", dark: "#331a1a",
    teams: [
      { seed:1,name:"Florida",id:57,full:"Florida Gators" },
      { seed:16,name:"Lehigh",id:2329,full:"Lehigh Mountain Hawks" },
      { seed:8,name:"Clemson",id:228,full:"Clemson Tigers" },
      { seed:9,name:"Iowa",id:2294,full:"Iowa Hawkeyes" },
      { seed:5,name:"Vanderbilt",id:238,full:"Vanderbilt Commodores" },
      { seed:12,name:"McNeese",id:2377,full:"McNeese Cowboys" },
      { seed:4,name:"Nebraska",id:158,full:"Nebraska Cornhuskers" },
      { seed:13,name:"Troy",id:2653,full:"Troy Trojans" },
      { seed:6,name:"UNC",id:153,full:"North Carolina Tar Heels" },
      { seed:11,name:"VCU",id:2670,full:"VCU Rams" },
      { seed:3,name:"Illinois",id:356,full:"Illinois Fighting Illini" },
      { seed:14,name:"Penn",id:219,full:"Pennsylvania Quakers" },
      { seed:7,name:"Saint Mary's",id:2608,full:"Saint Mary's Gaels" },
      { seed:10,name:"Texas A&M",id:245,full:"Texas A&M Aggies" },
      { seed:2,name:"Houston",id:248,full:"Houston Cougars" },
      { seed:15,name:"Idaho",id:70,full:"Idaho Vandals" },
    ]
  }
};

const ROUND_DATE = ["2026-03-19","2026-03-21","2026-03-27","2026-03-29","2026-04-04","2026-04-06"];

// ═══════════════════════════════════════════════════════════════
// DATA FETCHERS
// ═══════════════════════════════════════════════════════════════

async function fetchRatings() {
  try {
    const res = await fetch(`${ML_API}/ratings/ncaa`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data?.ratings;
    if (!arr?.length) return null;
    const map = new Map();
    for (const r of arr) map.set(String(r.team_id), r);
    return map;
  } catch { return null; }
}

async function fetchMLPred(a, b, date) {
  try {
    const res = await fetch(`${ML_API}/predict/ncaa/full`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        home_team_id: a.id, away_team_id: b.id, game_date: date,
        neutral_site: true, home_team_name: a.full || a.name, away_team_name: b.full || b.name,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error) return null;
    return { spread: d.ml_margin||0, sigma: d.sigma||11, winProb: d.ml_win_prob_home||0.5,
      homeScore: d.pred_home_score, awayScore: d.pred_away_score, coverage: d.feature_coverage||"?" };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// POSSIBLE MATCHUPS ENGINE
// Given current locks, compute which team pairings could occur
// in each round. Locks narrow the tree dramatically.
// ═══════════════════════════════════════════════════════════════

function possibleWinners(regionKey, round, gameIdx, locked) {
  // Returns array of teams that could win this game slot
  const lockKey = `${regionKey}_r${round}_${gameIdx}`;
  const lk = locked.get(lockKey);
  if (lk) return [lk];

  if (round === 0) {
    const teams = REGIONS[regionKey].teams;
    return [teams[gameIdx * 2], teams[gameIdx * 2 + 1]];
  }

  const left = possibleWinners(regionKey, round - 1, gameIdx * 2, locked);
  const right = possibleWinners(regionKey, round - 1, gameIdx * 2 + 1, locked);
  return [...left, ...right];
}

function getAllPossibleMatchups(locked, maxPerRound = 200) {
  const matchups = []; // {a, b, date, round, region}
  const seen = new Set();
  const addPair = (a, b, date, round, region) => {
    const k = a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    matchups.push({ a, b, date, round, region });
  };

  // Regional rounds
  for (const [rKey, region] of Object.entries(REGIONS)) {
    const teams = region.teams;
    const roundGames = [8, 4, 2, 1]; // games per round

    for (let round = 0; round < 4; round++) {
      let roundCount = 0;
      for (let gi = 0; gi < roundGames[round]; gi++) {
        let leftTeams, rightTeams;
        if (round === 0) {
          leftTeams = [teams[gi * 2]];
          rightTeams = [teams[gi * 2 + 1]];
        } else {
          leftTeams = possibleWinners(rKey, round - 1, gi * 2, locked);
          rightTeams = possibleWinners(rKey, round - 1, gi * 2 + 1, locked);
        }
        // Cartesian product
        for (const a of leftTeams) {
          for (const b of rightTeams) {
            if (a.id !== b.id) {
              addPair(a, b, ROUND_DATE[round] || ROUND_DATE[0], round, rKey);
              roundCount++;
            }
          }
        }
      }
    }
  }

  // Final Four: East vs South, West vs Midwest
  const eastW = possibleWinners("east", 3, 0, locked);
  const southW = possibleWinners("south", 3, 0, locked);
  const westW = possibleWinners("west", 3, 0, locked);
  const midwestW = possibleWinners("midwest", 3, 0, locked);

  for (const a of eastW) for (const b of southW) addPair(a, b, ROUND_DATE[4], 4, "f4");
  for (const a of westW) for (const b of midwestW) addPair(a, b, ROUND_DATE[4], 4, "f4");

  // Championship: any F4 winner vs any F4 winner from opposite semi
  const semi1possible = [...eastW, ...southW];
  const semi2possible = [...westW, ...midwestW];
  for (const a of semi1possible) for (const b of semi2possible) addPair(a, b, ROUND_DATE[5], 5, "ncg");

  return matchups;
}

// ═══════════════════════════════════════════════════════════════
// SPREAD LOOKUP — ML → adj_em → seed fallback
// ═══════════════════════════════════════════════════════════════

function mkKey(idA, idB) { return `${idA}_${idB}`; }

function lookupSpread(ml, ratings, a, b) {
  const k1 = mkKey(a.id, b.id), k2 = mkKey(b.id, a.id);
  if (ml.has(k1)) { const c = ml.get(k1); return { spread: c.spread, sigma: c.sigma, tier: "ml", detail: c }; }
  if (ml.has(k2)) { const c = ml.get(k2); return { spread: -c.spread, sigma: c.sigma, tier: "ml", detail: { ...c, spread: -c.spread, homeScore: c.awayScore, awayScore: c.homeScore } }; }
  const rA = ratings?.get(String(a.id)), rB = ratings?.get(String(b.id));
  if (rA?.adj_em != null && rB?.adj_em != null) {
    const t = ((rA.adj_tempo||68)+(rB.adj_tempo||68))/2;
    const sp = (rA.adj_em - rB.adj_em) * t / 100;
    const sA = (rA.adj_oe*(rB.adj_de||100)/100)*t/100, sB = (rB.adj_oe*(rA.adj_de||100)/100)*t/100;
    return { spread: sp, sigma: 11, tier: "em", detail: { spread: sp, homeScore: sA, awayScore: sB, rankA: rA.rank_adj_em, rankB: rB.rank_adj_em } };
  }
  return { spread: (b.seed - a.seed) * 1.4, sigma: 11, tier: "seed", detail: null };
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════════

function gaussR(m, s) { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return m+s*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function runSim(locked, n, ml, ratings) {
  const C = {};
  for (const r of Object.values(REGIONS)) for (const t of r.teams) C[t.id] = { r32:0,s16:0,e8:0,f4:0,ncg:0,champ:0 };
  const sim = (a,b) => { const{spread,sigma}=lookupSpread(ml,ratings,a,b); return gaussR(spread,sigma)>0?a:b; };

  for (let s = 0; s < n; s++) {
    const rW = {};
    for (const [rK,reg] of Object.entries(REGIONS)) {
      const T = reg.teams;
      const r32=[]; for(let i=0;i<16;i+=2){const w=locked.get(`${rK}_r0_${i/2}`)||sim(T[i],T[i+1]);r32.push(w);C[w.id].r32++;}
      const s16=[]; for(let i=0;i<8;i+=2){const w=locked.get(`${rK}_r1_${i/2}`)||sim(r32[i],r32[i+1]);s16.push(w);C[w.id].s16++;}
      const e8=[]; for(let i=0;i<4;i+=2){const w=locked.get(`${rK}_r2_${i/2}`)||sim(s16[i],s16[i+1]);e8.push(w);C[w.id].e8++;}
      const w=locked.get(`${rK}_r3_0`)||sim(e8[0],e8[1]); C[w.id].f4++; rW[rK]=w;
    }
    const f1=locked.get("ff_semi1")||sim(rW.east,rW.south); C[f1.id].ncg++;
    const f2=locked.get("ff_semi2")||sim(rW.west,rW.midwest); C[f2.id].ncg++;
    const ch=locked.get("ff_final")||sim(f1,f2); C[ch.id].champ++;
  }
  return C;
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

const Slot = ({team,prob,isLocked,isOut,onClick,color,compact,rating}) => {
  if(!team) return <div style={{height:compact?24:28,background:"rgba(255,255,255,0.015)",border:"1px dashed rgba(255,255,255,0.06)",borderRadius:3,display:"flex",alignItems:"center",padding:"0 5px",fontSize:9,color:"rgba(255,255,255,0.12)",fontStyle:"italic"}}>TBD</div>;
  const pct = prob!=null?prob*100:null;
  return (
    <div onClick={onClick} style={{height:compact?24:28,display:"flex",alignItems:"center",gap:3,padding:"0 5px",borderRadius:3,cursor:onClick?"pointer":"default",background:isLocked?`${color}30`:"rgba(255,255,255,0.03)",border:isLocked?`1.5px solid ${color}`:"1px solid rgba(255,255,255,0.05)",opacity:isOut?0.3:1,transition:"all 0.15s",position:"relative",overflow:"hidden"}}>
      {pct!=null&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:`${pct}%`,background:`${color}0d`,transition:"width 0.3s"}}/>}
      <span style={{fontSize:8,color:"rgba(255,255,255,0.3)",fontWeight:700,width:14,textAlign:"right",flexShrink:0,position:"relative",fontFamily:"'JetBrains Mono',monospace"}}>{team.seed}</span>
      <span style={{fontSize:compact?9.5:10.5,fontWeight:isLocked?700:500,color:isLocked?"#fff":isOut?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.8)",flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",position:"relative"}}>{team.name}</span>
      {rating&&<span style={{fontSize:7,color:"rgba(255,255,255,0.18)",position:"relative",flexShrink:0,fontFamily:"'JetBrains Mono',monospace"}}>#{rating.rank_adj_em}</span>}
      {pct!=null&&<span style={{fontSize:8,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:pct>70?"#4ade80":pct>40?"#fbbf24":"rgba(255,255,255,0.3)",position:"relative",flexShrink:0,minWidth:22,textAlign:"right"}}>{pct<1?"<1":pct.toFixed(0)}%</span>}
      {isLocked&&<span style={{fontSize:7,position:"relative",color:"#4ade80"}}>✓</span>}
    </div>
  );
};

const MInfo = ({a,b,ml,ratings,color}) => {
  if(!a||!b) return null;
  const{spread,tier,detail}=lookupSpread(ml,ratings,a,b);
  const fav=spread>0?a.name:b.name, abs=Math.abs(spread);
  const tc=tier==="ml"?"#4ade80":tier==="em"?"#60a5fa":"rgba(255,255,255,0.15)";
  const sA=detail?.homeScore,sB=detail?.awayScore;
  return (
    <div style={{fontSize:7.5,padding:"1px 4px",display:"flex",gap:5,justifyContent:"center",fontFamily:"'JetBrains Mono',monospace",color:"rgba(255,255,255,0.25)"}}>
      {sA!=null&&sB!=null&&<span>{Math.round(sA)}-{Math.round(sB)}</span>}
      <span style={{color:`${color}88`}}>{fav} -{abs.toFixed(1)}</span>
      <span style={{color:tc,fontWeight:700,fontSize:6.5}}>{tier.toUpperCase()}</span>
    </div>
  );
};

function RegionBracket({regionKey,counters,locked,onLock,nSims,ml,ratings}) {
  const reg=REGIONS[regionKey],teams=reg.teams,color=reg.color;
  const prob=(id,rk)=>counters&&nSims?(counters[id]?.[rk]||0)/nSims:null;
  const resolve=(round)=>{
    if(round===0) return teams;
    const prev=resolve(round-1), rk=["r32","s16","e8","f4"][round-1], result=[];
    for(let i=0;i<prev.length;i+=2){
      const lk=locked.get(`${regionKey}_r${round-1}_${Math.floor(i/2)}`);
      if(lk){result.push(lk);continue;}
      const a=prev[i],b=prev[i+1];
      if(!a||!b){result.push(a||b||null);continue;}
      result.push((prob(a.id,rk)||0)>=(prob(b.id,rk)||0)?a:b);
    }
    return result;
  };
  const rks=["r32","s16","e8","f4"];
  const rounds=[0,1,2,3].map(r=>resolve(r));
  const winner=resolve(4)?.[0];

  const renderRound=(round,arr,rk,label)=>{
    const games=[];
    for(let i=0;i<arr.length;i+=2){
      const a=arr[i],b=arr[i+1],gi=Math.floor(i/2);
      const lockKey=`${regionKey}_r${round}_${gi}`, w=locked.get(lockKey);
      games.push(
        <div key={gi} style={{display:"flex",flexDirection:"column",gap:1,marginBottom:round===0?0:3}}>
          <Slot team={a} prob={a?prob(a.id,rk):null} isLocked={w?.id===a?.id} isOut={w&&w.id!==a?.id} onClick={a?()=>onLock(lockKey,a):null} color={color} compact={round===0} rating={ratings?.get(String(a?.id))}/>
          <Slot team={b} prob={b?prob(b.id,rk):null} isLocked={w?.id===b?.id} isOut={w&&w.id!==b?.id} onClick={b?()=>onLock(lockKey,b):null} color={color} compact={round===0} rating={ratings?.get(String(b?.id))}/>
          <MInfo a={a} b={b} ml={ml} ratings={ratings} color={color}/>
        </div>
      );
    }
    return (
      <div style={{display:"flex",flexDirection:"column",minWidth:round===0?135:120,justifyContent:"space-around"}}>
        <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",marginBottom:3,textAlign:"center",letterSpacing:1,fontWeight:600}}>{label}</div>
        {games}
      </div>
    );
  };

  return (
    <div style={{background:`linear-gradient(160deg,${reg.dark} 0%,#0d1117 100%)`,borderRadius:10,padding:"10px 6px",border:`1px solid ${color}22`,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,paddingLeft:2}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:color,boxShadow:`0 0 6px ${color}`}}/>
        <span style={{fontFamily:"'Bebas Neue','Impact',sans-serif",fontSize:13,letterSpacing:2,color}}>{reg.label}</span>
        <span style={{fontSize:8,color:"rgba(255,255,255,0.2)"}}>{reg.city}</span>
      </div>
      <div style={{display:"flex",gap:3,overflowX:"auto",alignItems:"flex-start",paddingBottom:4}}>
        {renderRound(0,rounds[0],rks[0],"R64")}
        {renderRound(1,rounds[1],rks[1],"R32")}
        {renderRound(2,rounds[2],rks[2],"SWEET 16")}
        {renderRound(3,rounds[3],rks[3],"ELITE 8")}
        <div style={{display:"flex",flexDirection:"column",minWidth:100,justifyContent:"center"}}>
          <div style={{fontSize:7,color,marginBottom:3,textAlign:"center",letterSpacing:1,fontWeight:700}}>WINNER</div>
          {winner&&(<div style={{padding:"5px 7px",borderRadius:5,background:`${color}18`,border:`1px solid ${color}33`,textAlign:"center"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#fff"}}>{winner.name}</div>
            <div style={{fontSize:8,color:"rgba(255,255,255,0.35)",fontFamily:"'JetBrains Mono',monospace"}}>({winner.seed}) {prob(winner.id,"f4")!=null?`${(prob(winner.id,"f4")*100).toFixed(0)}%`:""}</div>
          </div>)}
        </div>
      </div>
    </div>
  );
}

function F4Panel({counters,nSims,ratings}) {
  if(!counters||!nSims) return null;
  const all=Object.values(REGIONS).flatMap(r=>r.teams.map(t=>{const rt=ratings?.get(String(t.id));return{...t,region:r.label,rc:r.color,cp:(counters[t.id]?.champ||0)/nSims*100,f4p:(counters[t.id]?.f4||0)/nSims*100,em:rt?.adj_em,rk:rt?.rank_adj_em};}));
  const ranked=all.filter(t=>t.cp>0.05).sort((a,b)=>b.cp-a.cp);
  const ch=ranked[0];
  return (
    <div style={{background:"linear-gradient(160deg,#1a1a2e 0%,#0d1117 100%)",borderRadius:10,padding:12,border:"1px solid rgba(255,255,255,0.06)",marginBottom:10}}>
      <div style={{fontFamily:"'Bebas Neue','Impact',sans-serif",fontSize:16,letterSpacing:3,color:"#fbbf24",textAlign:"center",marginBottom:8}}>FINAL FOUR — INDIANAPOLIS</div>
      {ch&&(<div style={{textAlign:"center",marginBottom:12,padding:"10px 14px",background:"rgba(251,191,36,0.05)",borderRadius:7,border:"1px solid rgba(251,191,36,0.12)"}}>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:2,marginBottom:2}}>PREDICTED CHAMPION</div>
        <div style={{fontSize:20,fontWeight:800,color:"#fbbf24",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>{ch.name}</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:"'JetBrains Mono',monospace"}}>
          ({ch.seed} seed, {ch.region}) — {ch.cp.toFixed(1)}%{ch.rk&&<span style={{color:"rgba(255,255,255,0.25)"}}> · #{ch.rk} · EM {ch.em?.toFixed(1)}</span>}
        </div>
      </div>)}
      <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",marginBottom:4,letterSpacing:1,fontWeight:600}}>TOP CONTENDERS</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
        {ranked.slice(0,16).map((t,i)=>(
          <div key={t.id} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 7px",background:i===0?"rgba(251,191,36,0.06)":"rgba(255,255,255,0.015)",borderRadius:3,border:i===0?"1px solid rgba(251,191,36,0.15)":"1px solid transparent"}}>
            <span style={{width:4,height:4,borderRadius:"50%",background:t.rc,flexShrink:0}}/>
            <span style={{fontSize:8,color:"rgba(255,255,255,0.2)",width:12}}>{t.seed}</span>
            <span style={{fontSize:10,fontWeight:i<4?700:400,color:i===0?"#fbbf24":"rgba(255,255,255,0.75)",flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</span>
            {t.rk&&<span style={{fontSize:7,color:"rgba(255,255,255,0.18)",fontFamily:"'JetBrains Mono',monospace"}}>#{t.rk}</span>}
            <span style={{fontSize:9,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:t.cp>8?"#4ade80":t.cp>3?"#fbbf24":"rgba(255,255,255,0.35)",minWidth:32,textAlign:"right"}}>{t.cp.toFixed(1)}%</span>
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
  const [locked,setLocked]=useState(new Map());
  const [counters,setCounters]=useState(null);
  const [nSims,setNSims]=useState(0);
  const [simCount,setSimCount]=useState(10000);
  const [running,setRunning]=useState(false);
  const [activeRegion,setActiveRegion]=useState("east");
  const [ratings,setRatings]=useState(null);
  const [ready,setReady]=useState(false);
  const mlRef=useRef(new Map());
  const [mlCount,setMlCount]=useState(0);
  const [prog,setProg]=useState("");

  useEffect(()=>{(async()=>{const r=await fetchRatings();if(r?.size>100)setRatings(r);setReady(true);})();},[]);

  const onLock=useCallback((key,team)=>{
    setLocked(prev=>{const n=new Map(prev);if(n.get(key)?.id===team.id)n.delete(key);else n.set(key,team);return n;});
  },[]);

  const handleSim=useCallback(async()=>{
    setRunning(true);

    // Compute all possible matchups given current locks
    const all=getAllPossibleMatchups(locked);
    // Filter to uncached
    const toFetch=all.filter(m=>{
      const k1=mkKey(m.a.id,m.b.id),k2=mkKey(m.b.id,m.a.id);
      return !mlRef.current.has(k1)&&!mlRef.current.has(k2);
    });

    // Cap at 250 calls per run to keep it reasonable
    const LIMIT=250;
    const batch=toFetch.slice(0,LIMIT);
    if(batch.length>0){
      const BSIZE=4;
      let done=0;
      for(let i=0;i<batch.length;i+=BSIZE){
        const sl=batch.slice(i,i+BSIZE);
        setProg(`Fetching ML ${done}/${batch.length}${toFetch.length>LIMIT?` (${toFetch.length-LIMIT} deferred)`:""}`);
        const results=await Promise.all(sl.map(async({a,b,date})=>{
          const r=await fetchMLPred(a,b,date);
          return {a,b,r};
        }));
        for(const{a,b,r}of results){done++;if(r)mlRef.current.set(mkKey(a.id,b.id),r);}
        setMlCount(mlRef.current.size);
      }
    }

    setProg("Simulating…");
    await new Promise(r=>setTimeout(r,30));
    const c=runSim(locked,simCount,mlRef.current,ratings);
    setCounters(c);setNSims(simCount);setRunning(false);setProg("");
  },[locked,simCount,ratings]);

  const handleReset=useCallback(()=>{setLocked(new Map());setCounters(null);setNSims(0);},[]);

  // Stats
  const allPossible=getAllPossibleMatchups(locked);
  const cached=allPossible.filter(m=>mlRef.current.has(mkKey(m.a.id,m.b.id))||mlRef.current.has(mkKey(m.b.id,m.a.id)));
  const uncached=allPossible.length-cached.length;

  return (
    <div style={{fontFamily:"'Archivo','Helvetica Neue',sans-serif",color:"#e6edf3"}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Archivo:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>

      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        <button onClick={handleSim} disabled={running||!ready} style={{padding:"6px 16px",borderRadius:5,border:"none",cursor:(running||!ready)?"wait":"pointer",background:running?"#1a2744":"linear-gradient(135deg,#3b82f6,#2563eb)",color:"#fff",fontSize:10,fontWeight:700,letterSpacing:0.5}}>
          {!ready?"⏳ Loading…":prog?`⏳ ${prog}`:nSims?"↻ Re-Simulate":"▶ Run Simulation"}
        </button>
        <select value={simCount} onChange={e=>setSimCount(Number(e.target.value))} style={{padding:"5px 6px",borderRadius:5,border:"1px solid rgba(255,255,255,0.08)",background:"#161b22",color:"#e6edf3",fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>
          <option value={1000}>1K sims</option>
          <option value={5000}>5K sims</option>
          <option value={10000}>10K sims</option>
          <option value={25000}>25K sims</option>
        </select>
        {locked.size>0&&(
          <React.Fragment>
            <span style={{fontSize:9,color:"#4ade80",fontFamily:"'JetBrains Mono',monospace"}}>{locked.size} locked</span>
            <button onClick={handleReset} style={{padding:"4px 10px",borderRadius:4,border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"rgba(255,255,255,0.35)",fontSize:9,cursor:"pointer"}}>Reset</button>
          </React.Fragment>
        )}
        {nSims>0&&<span style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:"'JetBrains Mono',monospace",marginLeft:"auto"}}>{nSims.toLocaleString()} sims · {mlRef.current.size} ML cached</span>}
      </div>

      {/* Tier legend + fetch status */}
      {ready&&(
        <div style={{display:"flex",gap:8,marginBottom:8,fontSize:8,fontFamily:"'JetBrains Mono',monospace",flexWrap:"wrap",alignItems:"center"}}>
          <span><span style={{color:"#4ade80",fontWeight:700}}>ML</span> <span style={{color:"rgba(255,255,255,0.3)"}}>146-feature model</span></span>
          <span><span style={{color:"#60a5fa",fontWeight:700}}>EM</span> <span style={{color:"rgba(255,255,255,0.3)"}}>adj_em efficiency</span></span>
          <span style={{color:"rgba(255,255,255,0.15)"}}>|</span>
          <span style={{color:"rgba(255,255,255,0.25)"}}>
            {allPossible.length} possible matchups · {cached.length} ML · {uncached} will fetch{locked.size>0?" (lock more to reduce)":""}
          </span>
        </div>
      )}

      {!counters&&!prog&&ready&&(
        <div style={{padding:"8px 12px",marginBottom:10,borderRadius:6,background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.1)",fontSize:10,color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>
          <strong style={{color:"#3b82f6"}}>Run Simulation</strong> fetches full ML predictions for every possible matchup, then runs 10,000 Monte Carlo tournaments.
          <strong style={{color:"#4ade80"}}> Lock obvious winners</strong> (click a team) to eliminate branches — this reduces API calls on re-simulation.
          E.g., locking all 1-seeds in R64 cuts R32 calls from 64 to 48.
        </div>
      )}

      <F4Panel counters={counters} nSims={nSims} ratings={ratings}/>

      <div style={{display:"flex",gap:2,marginBottom:6}}>
        {Object.entries(REGIONS).map(([k,r])=>(
          <button key={k} onClick={()=>setActiveRegion(k)} style={{padding:"4px 12px",borderRadius:5,border:"none",cursor:"pointer",background:activeRegion===k?`${r.color}1a`:"transparent",color:activeRegion===k?r.color:"rgba(255,255,255,0.3)",fontSize:10,fontWeight:700,letterSpacing:1,borderBottom:activeRegion===k?`2px solid ${r.color}`:"2px solid transparent"}}>{r.label}</button>
        ))}
      </div>

      <RegionBracket regionKey={activeRegion} counters={counters} locked={locked} onLock={onLock} nSims={nSims} ml={mlRef.current} ratings={ratings}/>
    </div>
  );
}
