// src/sports/nba/nbaUtils.js
// Lines 1541–1763 of App.jsx (extracted)

export const NBA_TEAMS_LIST = [
  { id:"ATL",name:"Atlanta Hawks",conf:"East" },{ id:"BOS",name:"Boston Celtics",conf:"East" },
  { id:"BKN",name:"Brooklyn Nets",conf:"East" },{ id:"CHA",name:"Charlotte Hornets",conf:"East" },
  { id:"CHI",name:"Chicago Bulls",conf:"East" },{ id:"CLE",name:"Cleveland Cavaliers",conf:"East" },
  { id:"DAL",name:"Dallas Mavericks",conf:"West" },{ id:"DEN",name:"Denver Nuggets",conf:"West" },
  { id:"DET",name:"Detroit Pistons",conf:"East" },{ id:"GSW",name:"Golden State Warriors",conf:"West" },
  { id:"HOU",name:"Houston Rockets",conf:"West" },{ id:"IND",name:"Indiana Pacers",conf:"East" },
  { id:"LAC",name:"LA Clippers",conf:"West" },{ id:"LAL",name:"Los Angeles Lakers",conf:"West" },
  { id:"MEM",name:"Memphis Grizzlies",conf:"West" },{ id:"MIA",name:"Miami Heat",conf:"East" },
  { id:"MIL",name:"Milwaukee Bucks",conf:"East" },{ id:"MIN",name:"Minnesota Timberwolves",conf:"West" },
  { id:"NOP",name:"New Orleans Pelicans",conf:"West" },{ id:"NYK",name:"New York Knicks",conf:"East" },
  { id:"OKC",name:"Oklahoma City Thunder",conf:"West" },{ id:"ORL",name:"Orlando Magic",conf:"East" },
  { id:"PHI",name:"Philadelphia 76ers",conf:"East" },{ id:"PHX",name:"Phoenix Suns",conf:"West" },
  { id:"POR",name:"Portland Trail Blazers",conf:"West" },{ id:"SAC",name:"Sacramento Kings",conf:"West" },
  { id:"SAS",name:"San Antonio Spurs",conf:"West" },{ id:"TOR",name:"Toronto Raptors",conf:"East" },
  { id:"UTA",name:"Utah Jazz",conf:"West" },{ id:"WAS",name:"Washington Wizards",conf:"East" },
];

export const NBA_ESPN_IDS = {
  ATL:1,BOS:2,BKN:17,CHA:30,CHI:4,CLE:5,DAL:6,DEN:7,DET:8,GSW:9,
  HOU:10,IND:11,LAC:12,LAL:13,MEM:29,MIA:14,MIL:15,MIN:16,NOP:3,NYK:18,
  OKC:25,ORL:19,PHI:20,PHX:21,POR:22,SAC:23,SAS:24,TOR:28,UTA:26,WAS:27,
};

export const NBA_TEAM_COLORS = {
  ATL:"#E03A3E",BOS:"#007A33",BKN:"#000",CHA:"#1D1160",CHI:"#CE1141",
  CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",
  HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",
  MIA:"#98002E",MIL:"#00471B",MIN:"#0C2340",NOP:"#0C2340",NYK:"#006BB6",
  OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#1D1160",POR:"#E03A3E",
  SAC:"#5A2D81",SAS:"#C4CED4",TOR:"#CE1141",UTA:"#002B5C",WAS:"#002B5C",
};

// City coordinates for Haversine travel distance calculation
const NBA_CITY_COORDS = {
  ATL:{lat:33.7490,lng:-84.3880},BOS:{lat:42.3601,lng:-71.0589},BKN:{lat:40.6926,lng:-73.9750},
  CHA:{lat:35.2271,lng:-80.8431},CHI:{lat:41.8819,lng:-87.6278},CLE:{lat:41.4993,lng:-81.6944},
  DAL:{lat:32.7767,lng:-96.7970},DEN:{lat:39.7392,lng:-104.9903},DET:{lat:42.3314,lng:-83.0458},
  GSW:{lat:37.7749,lng:-122.4194},HOU:{lat:29.7604,lng:-95.3698},IND:{lat:39.7684,lng:-86.1581},
  LAC:{lat:34.0430,lng:-118.2673},LAL:{lat:34.0430,lng:-118.2673},MEM:{lat:35.1495,lng:-90.0490},
  MIA:{lat:25.7617,lng:-80.1918},MIL:{lat:43.0389,lng:-87.9065},MIN:{lat:44.9778,lng:-93.2650},
  NOP:{lat:29.9511,lng:-90.0715},NYK:{lat:40.7505,lng:-73.9934},OKC:{lat:35.4676,lng:-97.5164},
  ORL:{lat:28.5383,lng:-81.3792},PHI:{lat:39.9526,lng:-75.1652},PHX:{lat:33.4484,lng:-112.0740},
  POR:{lat:45.5231,lng:-122.6765},SAC:{lat:38.5816,lng:-121.4944},SAS:{lat:29.4241,lng:-98.4936},
  TOR:{lat:43.6532,lng:-79.3832},UTA:{lat:40.7608,lng:-111.8910},WAS:{lat:38.9072,lng:-77.0369},
};

const _nbaStatsCache = {};

export async function fetchNBATeamStats(abbr) {
  if (_nbaStatsCache[abbr]) return _nbaStatsCache[abbr];
  const espnId = NBA_ESPN_IDS[abbr];
  if (!espnId) return null;
  try {
    const [teamData, statsData, schedData] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}`).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule`).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const stats = statsData?.results?.stats?.categories || [];
    const getStat = (...names) => {
      for (const cat of stats) for (const name of names) {
        const s = cat.stats?.find(s => s.name===name||s.displayName===name);
        if (s) return parseFloat(s.value)||null;
      }
      return null;
    };
    const ppg = getStat("avgPoints","pointsPerGame") || 112.0;
    const oppPpg = getStat("avgPointsAllowed","opponentPointsPerGame") || 112.0;
    const estPace = 96 + (ppg-110)*0.3;
    const pace = Math.max(92, Math.min(105, estPace));
    const adjOE = (ppg/pace)*100, adjDE = (oppPpg/pace)*100;
    let formScore=0, wins=0, losses=0;
    try {
      const events = schedData?.events||[];
      const completed = events.filter(e=>e.competitions?.[0]?.status?.type?.completed);
      wins = completed.filter(e=>e.competitions?.[0]?.competitors?.find(c=>c.team?.id===String(espnId))?.winner).length;
      losses = completed.length - wins;
      formScore = completed.slice(-5).reduce((s,e,i)=>{
        const comp=e.competitions?.[0];
        const tc=comp?.competitors?.find(c=>c.team?.id===String(espnId));
        return s+((tc?.winner||false)?1:-0.6)*(i+1);
      },0)/15;
    } catch {}
    const result = {
      abbr, espnId, name: teamData?.team?.displayName||abbr,
      ppg, oppPpg, pace, adjOE, adjDE, netRtg: adjOE-adjDE,
      formScore, wins, losses, totalGames: wins+losses,
    };
    _nbaStatsCache[abbr] = result;
    return result;
  } catch(e) { console.warn("fetchNBATeamStats:", abbr, e); return null; }
}

export async function fetchNBAGamesForDate(dateStr) {
  try {
    const compact = dateStr.replace(/-/g,"");
    const data = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${compact}&limit=50`).then(r=>r.ok?r.json():null).catch(()=>null);
    if (!data?.events) return [];
    const mapAbbr = a => ({"GS":"GSW","NY":"NYK","NO":"NOP","SA":"SAS"}[a]||a);
    return data.events.map(ev=>{
      const comp=ev.competitions?.[0];
      const home=comp?.competitors?.find(c=>c.homeAway==="home");
      const away=comp?.competitors?.find(c=>c.homeAway==="away");
      const status=comp?.status?.type;
      return {
        gameId: ev.id, gameDate: ev.date,
        status: status?.completed?"Final":status?.state==="in"?"Live":"Preview",
        homeAbbr: mapAbbr(home?.team?.abbreviation||""),
        awayAbbr: mapAbbr(away?.team?.abbreviation||""),
        homeTeamName: home?.team?.displayName,
        awayTeamName: away?.team?.displayName,
        homeScore: status?.completed?parseInt(home?.score):null,
        awayScore: status?.completed?parseInt(away?.score):null,
        neutralSite: comp?.neutralSite||false,
      };
    }).filter(g=>g.homeAbbr&&g.awayAbbr);
  } catch(e) { console.warn("fetchNBAGamesForDate:", dateStr, e); return []; }
}

// ─────────────────────────────────────────────────────────────
// NBA v14: Real pace + off/def ratings + rest/travel + lineup impact
// ─────────────────────────────────────────────────────────────
export function nbaPredictGame({
  homeStats, awayStats,
  neutralSite=false,
  homeDaysRest=2, awayDaysRest=2,
  calibrationFactor=1.0,
  homeRealStats=null,
  awayRealStats=null,
  homeAbbr=null, awayAbbr=null,
  awayPrevCityAbbr=null,
  homeInjuries=[], awayInjuries=[],
}) {
  if (!homeStats||!awayStats) return null;
  const homePace   = homeRealStats?.pace   || homeStats.pace;
  const awayPace   = awayRealStats?.pace   || awayStats.pace;
  const homeOffRtg = homeRealStats?.offRtg || homeStats.adjOE;
  const awayOffRtg = awayRealStats?.offRtg || awayStats.adjOE;
  const homeDefRtg = homeRealStats?.defRtg || homeStats.adjDE;
  const awayDefRtg = awayRealStats?.defRtg || awayStats.adjDE;
  const poss = (homePace + awayPace) / 2;
  const lgAvg = 113.0; // 2024-25 NBA final lg avg PPG

  let homeScore = ((homeOffRtg/lgAvg)*(lgAvg/awayDefRtg)*lgAvg/100)*poss;
  let awayScore = ((awayOffRtg/lgAvg)*(lgAvg/homeDefRtg)*lgAvg/100)*poss;

  // True Shooting % proxy
  const tsBoost = (offPpg, offFgPct, ftPct) => {
    if (!offFgPct) return 0;
    const tsa = (ftPct || 0.77) * 0.44;
    const ts = offPpg / (2 * (poss * 2 * (1 - tsa)));
    const lgTS = 0.568;
    return Math.max(-3, Math.min(3, (ts - lgTS) * 18));
  };
  const defQuality = (oppFgPct) => {
    if (!oppFgPct) return 0;
    const lgOppFg = 0.466;
    return (lgOppFg - oppFgPct) * 12;
  };

  homeScore += tsBoost(homeStats.ppg, homeStats.fgPct, homeStats.ftPct) * 0.20;
  awayScore += tsBoost(awayStats.ppg, awayStats.fgPct, awayStats.ftPct) * 0.20;
  homeScore += defQuality(homeStats.oppFgPct) * 0.15;
  awayScore += defQuality(awayStats.oppFgPct) * 0.15;

  // Home court advantage: 2.4 pts (post-2020 research)
  homeScore += (neutralSite ? 0 : 2.4) / 2;
  awayScore -= (neutralSite ? 0 : 2.4) / 2;

  // B2B rest penalties
  if (homeDaysRest === 0) { homeScore -= 1.8; awayScore += 0.8; }
  else if (awayDaysRest === 0) { awayScore -= 2.2; homeScore += 1.0; }
  else if (homeDaysRest - awayDaysRest >= 3) homeScore += 1.4;
  else if (awayDaysRest - homeDaysRest >= 3) awayScore += 1.4;

  // Travel distance penalty (Haversine)
  if (awayPrevCityAbbr && awayAbbr) {
    try {
      const c1 = NBA_CITY_COORDS[awayPrevCityAbbr], c2 = NBA_CITY_COORDS[homeAbbr || awayAbbr];
      if (c1 && c2) {
        const R=3959, toRad=d=>d*Math.PI/180;
        const a=Math.sin(toRad((c2.lat-c1.lat)/2))**2+Math.cos(toRad(c1.lat))*Math.cos(toRad(c2.lat))*Math.sin(toRad((c2.lng-c1.lng)/2))**2;
        const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
        if (dist > 2000) awayScore -= 1.4;
        else if (dist > 1000) awayScore -= 0.7;
      }
    } catch {}
  }

  // Rim protection proxy
  const rimProtection = (blk, foulsAllowed) => {
    const blkBonus = blk != null ? (blk - 4.5) * 0.18 : 0;
    const foulPenalty = foulsAllowed != null ? (foulsAllowed - 20) * -0.06 : 0;
    return blkBonus + foulPenalty;
  };
  homeScore += rimProtection(homeStats.blocks, awayStats.foulsPerGame) * 0.15;
  awayScore += rimProtection(awayStats.blocks, homeStats.foulsPerGame) * 0.15;

  // Lineup injury impact
  const roleWeight = { starter: 3.2, rotation: 1.5, reserve: 0.5 };
  const homeInjPenalty = (homeInjuries||[]).reduce((s,p) => s+(roleWeight[p.role]||1.5), 0);
  const awayInjPenalty = (awayInjuries||[]).reduce((s,p) => s+(roleWeight[p.role]||1.5), 0);
  homeScore -= homeInjPenalty;
  awayScore -= awayInjPenalty;

  // Recent form
  const fw = Math.min(0.10, 0.10*Math.sqrt(Math.min(homeStats.totalGames,30)/30));
  homeScore += homeStats.formScore*fw*3;
  awayScore += awayStats.formScore*fw*3;

  homeScore = Math.max(85, Math.min(148, homeScore));
  awayScore = Math.max(85, Math.min(148, awayScore));

  const spread = parseFloat((homeScore-awayScore).toFixed(1));
  // NBA logistic sigma = 12.0 (calibrated vs 5-season ATS records)
  let hwp = 1/(1+Math.pow(10,-spread/12.0));
  hwp = Math.min(0.93, Math.max(0.07, hwp));
  if (calibrationFactor!==1.0) hwp = Math.min(0.93, Math.max(0.07, 0.5+(hwp-0.5)*calibrationFactor));
  const mml = hwp>=0.5 ? -Math.round((hwp/(1-hwp))*100) : +Math.round(((1-hwp)/hwp)*100);
  const aml = hwp>=0.5 ? +Math.round(((1-hwp)/hwp)*100) : -Math.round((hwp/(1-hwp))*100);
  const netGap = Math.abs((homeRealStats?.netRtg||homeStats.netRtg)-(awayRealStats?.netRtg||awayStats.netRtg));
  const cs = Math.round((Math.min(netGap,8)/8)*40 + Math.abs(hwp-0.5)*2*35 + Math.min(1,homeStats.totalGames/20)*20 + (homeStats.totalGames>=10?5:0));

  return {
    homeScore: parseFloat(homeScore.toFixed(1)),
    awayScore: parseFloat(awayScore.toFixed(1)),
    homeWinPct: hwp, awayWinPct: 1-hwp,
    projectedSpread: spread,
    ouTotal: parseFloat((homeScore+awayScore).toFixed(1)),
    modelML_home: mml, modelML_away: aml,
    confidence: cs>=62?"HIGH":cs>=35?"MEDIUM":"LOW", confScore: cs,
    possessions: parseFloat(poss.toFixed(1)),
    homeNetRtg: parseFloat((homeRealStats?.netRtg||homeStats.netRtg)?.toFixed(2)),
    awayNetRtg: parseFloat((awayRealStats?.netRtg||awayStats.netRtg)?.toFixed(2)),
    neutralSite, usingRealPace: !!(homeRealStats?.pace && awayRealStats?.pace),
  };
}

export function matchNBAOddsToGame(o, g) {
  if (!o||!g) return false;
  const n = s => (s||"").toLowerCase().replace(/[\s\W]/g,"");
  return (n(o.homeTeam).includes(n(g.homeTeamName||"").slice(0,6))||n(g.homeTeamName||"").includes(n(o.homeTeam).slice(0,6))) &&
         (n(o.awayTeam).includes(n(g.awayTeamName||"").slice(0,6))||n(g.awayTeamName||"").includes(n(o.awayTeam).slice(0,6)));
}
