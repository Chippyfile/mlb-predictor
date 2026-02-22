import { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import {
  fetchSchedule, fetchTeamHitting, fetchTeamPitching, fetchStarterStats,
  fetchVsTeamSplits, fetchRecentGames, fetchBullpenFatigue, fetchLikelyRelievers
} from './api/mlb.js';
import {
  TEAMS, PARK_FACTORS, UMPIRE_PROFILES,
  teamById, estimateWOBA, estimateWRCPlus, estimateFIP,
  predictGame, getBannerColor,
  modelWinToMoneyline, moneylineToImplied, impliedToMoneyline,
  runDiffToSpread, runLineOdds
} from './data/constants.js';

// ─── Design tokens ────────────────────────────────────────────
const C = {
  bg:'#060a06', card:'#0d140d', border:'#182418', green:'#39d353',
  dkGreen:'#14532d', gold:'#f59e0b', red:'#ef4444', blue:'#60a5fa',
  muted:'#8b9eb0', text:'#e8f8f0', dim:'#1e2e1e',
  bannerGreen:   {bg:'#0d2a0d',border:'#1a5a1a',accent:'#39d353',label:'MODEL EDGE'},
  bannerRed:     {bg:'#2a0d0d',border:'#5a1a1a',accent:'#ef4444',label:'FADE'},
  bannerYellow:  {bg:'#2a220a',border:'#5a4a1a',accent:'#f59e0b',label:'DATA INCOMPLETE'},
  bannerNeutral: {bg:'#0d140d',border:'#1a2a1a',accent:'#8b9eb0',label:'NEAR MARKET'},
};

// ─── Tiny UI components ───────────────────────────────────────
const Badge = ({ text, color=C.dkGreen, textColor=C.green }) => (
  <span style={{background:color,color:textColor,fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:3,letterSpacing:1.5,textTransform:'uppercase',fontFamily:'monospace'}}>{text}</span>
);
const Panel = ({ children, style={} }) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:16,...style}}>{children}</div>
);
const SLabel = ({ children }) => (
  <div style={{color:C.muted,fontSize:10,fontWeight:800,letterSpacing:2.5,textTransform:'uppercase',marginBottom:10,fontFamily:'monospace'}}>{children}</div>
);
const StatRow = ({ label, home, away, higherIsBetter=true, highlight=false }) => {
  const h=parseFloat(home), a=parseFloat(away);
  const hB = !isNaN(h)&&!isNaN(a) ? (higherIsBetter?h>=a:h<=a) : null;
  return (
    <div style={{display:'flex',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.dim}`,background:highlight?'#0d1f0d':'transparent'}}>
      <span style={{minWidth:80,textAlign:'right',fontWeight:700,color:hB===true?C.green:hB===false?C.muted:'#c8d8e8',fontVariantNumeric:'tabular-nums',fontSize:12}}>{home}</span>
      <span style={{flex:1,textAlign:'center',color:C.muted,fontSize:10,letterSpacing:1,fontFamily:'monospace',padding:'0 8px'}}>{label}</span>
      <span style={{minWidth:80,fontWeight:700,color:hB===false?C.green:hB===true?C.muted:'#c8d8e8',fontVariantNumeric:'tabular-nums',fontSize:12}}>{away}</span>
    </div>
  );
};

// ─── Game Banner (calendar) ───────────────────────────────────
function GameBanner({ game, onSelect, isSelected }) {
  const color = getBannerColor(game);
  const theme = C[`banner${color.charAt(0).toUpperCase()+color.slice(1)}`] || C.bannerNeutral;
  const { prediction, homeTeam, awayTeam, homeStarter, awayStarter } = game;
  const gameTime = game.gameTime ? new Date(game.gameTime) : null;
  const timeStr = gameTime ? gameTime.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : 'TBD';
  const isLive = game.status === 'Live';
  const isFinal = game.status === 'Final';

  return (
    <div onClick={() => onSelect(game)} style={{
      background:theme.bg, border:`1px solid ${isSelected?theme.accent:theme.border}`,
      borderLeft:`4px solid ${theme.accent}`, borderRadius:8, padding:'12px 14px',
      cursor:'pointer', transition:'all 0.15s', marginBottom:8, position:'relative'
    }}>
      {/* Top right badges */}
      <div style={{position:'absolute',top:8,right:10,display:'flex',gap:5,alignItems:'center'}}>
        {isLive && <span style={{background:'#3a0000',color:C.red,fontSize:9,fontWeight:800,padding:'2px 6px',borderRadius:3,letterSpacing:1}}>● LIVE</span>}
        {isFinal && <span style={{color:C.muted,fontSize:9,fontWeight:800,letterSpacing:1}}>FINAL</span>}
        {!isLive&&!isFinal && <span style={{color:C.muted,fontSize:9}}>{timeStr}</span>}
        {game.gameType === 'S' && <span style={{background:'#1a2a3a',color:C.blue,fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:2,letterSpacing:1.5}}>SPRING</span>}
        <span style={{background:theme.bg,color:theme.accent,border:`1px solid ${theme.border}`,fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:2,letterSpacing:1.5,textTransform:'uppercase'}}>{theme.label}</span>
      </div>

      {/* Teams + score */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
        <div style={{textAlign:'center',minWidth:46}}>
          <div style={{fontSize:16,fontWeight:900,color:prediction&&prediction.awayRuns>prediction.homeRuns?C.green:'#c8d8e8'}}>{awayTeam?.abbr||'???'}</div>
          <div style={{fontSize:9,color:C.muted}}>AWAY</div>
        </div>
        <div style={{flex:1,textAlign:'center'}}>
          {isFinal ? (
            <div style={{fontSize:20,fontWeight:900,color:C.text}}>{game.awayScore} – {game.homeScore}</div>
          ) : isLive ? (
            <div>
              <div style={{fontSize:20,fontWeight:900,color:C.red}}>{game.awayScore} – {game.homeScore}</div>
              <div style={{fontSize:9,color:C.muted}}>{game.inningHalf?.charAt(0)} {game.inning}</div>
            </div>
          ) : !prediction ? (
            <div style={{color:C.muted,fontSize:11}}>Loading…</div>
          ) : (
            <div>
              <div style={{fontSize:18,fontWeight:900,color:C.text,fontVariantNumeric:'tabular-nums'}}>
                {prediction.awayRuns.toFixed(1)} – {prediction.homeRuns.toFixed(1)}
              </div>
              <div style={{fontSize:9,color:C.muted}}>projected</div>
            </div>
          )}
        </div>
        <div style={{textAlign:'center',minWidth:46}}>
          <div style={{fontSize:16,fontWeight:900,color:prediction&&prediction.homeRuns>=prediction.awayRuns?C.green:'#c8d8e8'}}>{homeTeam?.abbr||'???'}</div>
          <div style={{fontSize:9,color:C.muted}}>HOME</div>
        </div>
      </div>

      {/* Pitchers */}
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:prediction?8:0,color:C.muted}}>
        <span>⚾ {awayStarter?.fullName || <span style={{color:C.gold}}>SP TBD</span>}</span>
        <span style={{color:C.border}}>vs</span>
        <span style={{textAlign:'right'}}>⚾ {homeStarter?.fullName || <span style={{color:C.gold}}>SP TBD</span>}</span>
      </div>

      {/* Stats row */}
      {prediction && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,borderTop:`1px solid ${theme.border}`,paddingTop:8}}>
          {[
            {label:'TOTAL',   main:(prediction.homeRuns+prediction.awayRuns).toFixed(1),sub:'exp. runs'},
            {label:'MODEL RL', main:`${runDiffToSpread(prediction.homeRuns,prediction.awayRuns)>0?'-':'+'}${Math.abs(parseFloat(runDiffToSpread(prediction.homeRuns,prediction.awayRuns))).toFixed(1)}`,sub:`${homeTeam?.abbr} spread`},
            {label:'MODEL ML', main:modelWinToMoneyline(prediction.homeWinPct),sub:`${homeTeam?.abbr} ${(prediction.homeWinPct*100).toFixed(0)}%`},
            {label:'RUN LINE', main:runLineOdds(prediction.homeWinPct,prediction.homeRuns,prediction.awayRuns).homeML,sub:`${homeTeam?.abbr} -1.5`},
          ].map(({label,main,sub})=>(
            <div key={label} style={{textAlign:'center'}}>
              <div style={{fontSize:9,color:C.muted,letterSpacing:1}}>{label}</div>
              <div style={{fontSize:13,fontWeight:800,color:theme.accent,fontFamily:'monospace'}}>{main}</div>
              <div style={{fontSize:9,color:C.muted}}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {color==='yellow' && (
        <div style={{marginTop:6,fontSize:9,color:C.gold}}>
          ⚠️ {!homeStarter||!awayStarter?'Probable starters not yet posted. ':''}Predictions based on season averages only.
        </div>
      )}
    </div>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────
function CalendarTab({ onSelectGame }) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [relievers, setRelievers] = useState({});
  const cacheRef = useRef({});

  const loadGames = useCallback(async (dateStr) => {
    if (cacheRef.current[dateStr]) { setGames(cacheRef.current[dateStr]); return; }
    setLoading(true); setError(null); setGames([]);
    try {
      const rawGames = await fetchSchedule(dateStr);
      if (!rawGames.length) { setGames([]); setLoading(false); return; }
      setGames(rawGames.map(g => ({...g, prediction:null})));

      // Enrich each game in parallel
      const enriched = await Promise.all(rawGames.map(async (game) => {
        try {
          const [homeHit, awayHit, homePitch, awayPitch,
                 homeStarterStats, awayStarterStats,
                 homeVsAway, awayVsHome,
                 homeForm, awayForm,
                 homeBullpen, awayBullpen] = await Promise.all([
            fetchTeamHitting(game.homeTeam.id),
            fetchTeamHitting(game.awayTeam.id),
            fetchTeamPitching(game.homeTeam.id),
            fetchTeamPitching(game.awayTeam.id),
            game.homeStarter?.id ? fetchStarterStats(game.homeStarter.id) : null,
            game.awayStarter?.id ? fetchStarterStats(game.awayStarter.id) : null,
            fetchVsTeamSplits(game.homeTeam.id, game.awayTeam.id),
            fetchVsTeamSplits(game.awayTeam.id, game.homeTeam.id),
            fetchRecentGames(game.homeTeam.id),
            fetchRecentGames(game.awayTeam.id),
            fetchBullpenFatigue(game.homeTeam.id),
            fetchBullpenFatigue(game.awayTeam.id),
          ]);
          const prediction = predictGame({
            homeTeam:game.homeTeam, awayTeam:game.awayTeam,
            homeHit, awayHit, homePitch, awayPitch,
            homeStarterStats, awayStarterStats,
            homeVsAway, awayVsHome,
            homeForm, awayForm, homeBullpen, awayBullpen,
            umpireName:'Default',
          });
          return {...game, prediction, homeStarterStats, awayStarterStats, homeForm, awayForm, homeBullpen, awayBullpen};
        } catch { return game; }
      }));

      cacheRef.current[dateStr] = enriched;
      setGames(enriched);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadGames(selectedDate); }, [selectedDate, loadGames]);

  // Auto-refresh live games every 5 min
  useEffect(() => {
    const iv = setInterval(() => {
      if (games.some(g => g.status === 'Live')) {
        delete cacheRef.current[selectedDate];
        loadGames(selectedDate);
      }
    }, 300000);
    return () => clearInterval(iv);
  }, [games, selectedDate, loadGames]);

  const changeDate = d => {
    const dt = new Date(selectedDate); dt.setDate(dt.getDate() + d);
    setSelectedDate(dt.toISOString().split('T')[0]);
  };
  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  const handleExpand = async (game) => {
    const newId = expandedId === game.gameId ? null : game.gameId;
    setExpandedId(newId);
    onSelectGame(game);
    if (newId && !relievers[game.homeTeam.id]) {
      const [hr, ar] = await Promise.all([fetchLikelyRelievers(game.homeTeam.id), fetchLikelyRelievers(game.awayTeam.id)]);
      setRelievers(p => ({...p, [game.homeTeam.id]:hr, [game.awayTeam.id]:ar}));
    }
  };

  const green = games.filter(g => getBannerColor(g)==='green').length;
  const yellow = games.filter(g => getBannerColor(g)==='yellow').length;

  return (
    <div>
      {/* Date nav */}
      <Panel style={{marginBottom:12}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>changeDate(-1)} style={btnStyle}>← Prev</button>
          <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
            style={{...inputStyle,flex:1}} />
          <button onClick={()=>changeDate(1)} style={btnStyle}>Next →</button>
          {!isToday && <button onClick={()=>setSelectedDate(new Date().toISOString().split('T')[0])} style={{...btnStyle,background:C.dkGreen,color:C.green}}>Today</button>}
          <button onClick={()=>{delete cacheRef.current[selectedDate];loadGames(selectedDate);}} style={{...btnStyle,color:C.muted}}>↺</button>
        </div>
        {games.length > 0 && (
          <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{color:C.muted,fontSize:10}}>Signal:</span>
            <Badge text={`${green} model edge`} color="#0d2a0d" textColor={C.green}/>
            <Badge text={`${yellow} incomplete`} color="#2a220a" textColor={C.gold}/>
            <Badge text={`${games.length} games`} color={C.dim} textColor={C.muted}/>
          </div>
        )}
      </Panel>

      {/* Legend */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',fontSize:10}}>
        {[
          {color:C.bannerGreen, label:'Model win% > 58% (value)'},
          {color:C.bannerYellow,label:'Starters TBD / data loading'},
          {color:C.bannerNeutral,label:'No strong signal'},
        ].map(({color,label})=>(
          <div key={label} style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:10,height:10,background:color.bg,border:`2px solid ${color.accent}`,borderRadius:2}}/>
            <span style={{color:C.muted}}>{label}</span>
          </div>
        ))}
      </div>

      {loading && <Panel><div style={{textAlign:'center',padding:20,color:C.muted}}>
        <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:10}}>
          {[0,1,2].map(i=><div key={i} style={{width:8,height:8,background:C.green,borderRadius:'50%',animation:`pulse 1s ${i*0.2}s ease infinite`}}/>)}
        </div>
        Fetching schedule & running predictions…
      </div></Panel>}

      {error && <Panel style={{borderColor:'#3a1a1a',background:'#0a0505',marginBottom:12}}>
        <div style={{color:C.red,fontSize:12}}>❌ {error}</div>
        <div style={{color:C.muted,fontSize:11,marginTop:6}}>Check that the app is deployed to Vercel — the MLB API proxy requires Vercel's edge network.</div>
      </Panel>}

      {!loading && !error && games.length === 0 && (
        <Panel><div style={{textAlign:'center',color:'#a0b8c8',padding:20}}>No games found for this date.</div></Panel>
      )}

      {games.map(game => (
        <div key={game.gameId}>
          <GameBanner game={game} onSelect={handleExpand} isSelected={expandedId===game.gameId}/>
          {expandedId===game.gameId && game.prediction && (
            <div style={{background:'#080e08',border:`1px solid ${C.border}`,borderRadius:8,padding:14,marginTop:-4,marginBottom:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                {/* Full odds */}
                <div>
                  <SLabel>Full Odds Breakdown</SLabel>
                  {[
                    ['Model ML', modelWinToMoneyline(1-game.prediction.homeWinPct), modelWinToMoneyline(game.prediction.homeWinPct)],
                    ['Run Line -1.5', runLineOdds(1-game.prediction.homeWinPct,game.prediction.awayRuns,game.prediction.homeRuns).homeML, runLineOdds(game.prediction.homeWinPct,game.prediction.homeRuns,game.prediction.awayRuns).homeML],
                    ['O/U Total', `O ${(game.prediction.homeRuns+game.prediction.awayRuns).toFixed(1)}`, `U ${(game.prediction.homeRuns+game.prediction.awayRuns).toFixed(1)}`],
                    ['Win %', `${((1-game.prediction.homeWinPct)*100).toFixed(1)}%`, `${(game.prediction.homeWinPct*100).toFixed(1)}%`],
                    ['Confidence', `${(game.prediction.confidence*100).toFixed(0)}%`, ''],
                  ].map(([lbl,away,home])=>(
                    <div key={lbl} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.dim}`,fontSize:11}}>
                      <span style={{color:C.muted,minWidth:90,fontSize:10}}>{lbl}</span>
                      <span style={{color:'#c8d8e8',fontFamily:'monospace'}}>{away}</span>
                      <span style={{color:C.green,fontFamily:'monospace'}}>{home}</span>
                    </div>
                  ))}
                </div>
                {/* Starters */}
                <div>
                  <SLabel>Starter Stats</SLabel>
                  {[{label:`${game.awayTeam?.abbr}: ${game.awayStarter?.fullName||'TBD'}`,stats:game.awayStarterStats},
                    {label:`${game.homeTeam?.abbr}: ${game.homeStarter?.fullName||'TBD'}`,stats:game.homeStarterStats}].map(({label,stats})=>(
                    <div key={label} style={{marginBottom:8,background:C.dkGreen,borderRadius:6,padding:8}}>
                      <div style={{color:C.text,fontSize:10,fontWeight:700,marginBottom:4}}>{label}</div>
                      {stats ? (
                        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:3}}>
                          {[['ERA',stats.era?.toFixed(2)],['FIP',stats.fip?.toFixed(2)],['xFIP',stats.xfip?.toFixed(2)],['K/9',stats.k9?.toFixed(1)],['BB/9',stats.bb9?.toFixed(1)],['IP',stats.ip?.toFixed(0)]].map(([l,v])=>(
                            <div key={l} style={{textAlign:'center'}}>
                              <div style={{fontSize:8,color:C.muted}}>{l}</div>
                              <div style={{fontSize:11,fontWeight:800,color:C.green,fontFamily:'monospace'}}>{v||'—'}</div>
                            </div>
                          ))}
                        </div>
                      ):<div style={{color:'#a0b8c8',fontSize:10}}>Stats not available (early season / ST)</div>}
                    </div>
                  ))}
                </div>
              </div>
              {/* Relievers */}
              {(relievers[game.homeTeam?.id]||relievers[game.awayTeam?.id]) && (
                <div>
                  <SLabel>Likely Relievers</SLabel>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    {[{team:game.awayTeam,key:game.awayTeam?.id},{team:game.homeTeam,key:game.homeTeam?.id}].map(({team,key})=>(
                      <div key={key}>
                        <div style={{color:C.muted,fontSize:9,marginBottom:4}}>{team?.abbr} BULLPEN</div>
                        {(relievers[key]||[]).map(r=>(
                          <div key={r.name} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:`1px solid ${C.dim}`,fontSize:10}}>
                            <span style={{color:r.isCloser?C.gold:C.text}}>{r.isCloser?'🔒 ':''}{r.name}</span>
                            <span style={{color:r.era<3.5?C.green:r.era>4.5?C.red:C.muted,fontFamily:'monospace'}}>{r.era.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{marginTop:10,textAlign:'right'}}>
                <button onClick={()=>onSelectGame(game)} style={{...btnStyle,background:C.dkGreen,color:C.green,border:`1px solid #1a4a1a`}}>
                  → Full Deep-Dive Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared style helpers ─────────────────────────────────────
const btnStyle = {background:C.dim,border:`1px solid #1e2e1e`,color:'#e8f8f0',borderRadius:5,padding:'7px 12px',cursor:'pointer',fontFamily:'monospace',fontSize:11};
const inputStyle = {background:'#0a120a',color:'#e8f8f0',border:`1px solid #182418`,borderRadius:6,padding:'8px 10px',fontSize:12,fontFamily:'monospace',outline:'none'};
const selectStyle = {...inputStyle,cursor:'pointer'};

// ─── Matchup Tab ──────────────────────────────────────────────
function MatchupTab({ prefillHome, prefillAway, prefillDate }) {
  const [homeTeam, setHomeTeam] = useState(prefillHome || TEAMS.find(t=>t.abbr==='CHC'));
  const [awayTeam, setAwayTeam] = useState(prefillAway || TEAMS.find(t=>t.abbr==='MIL'));
  const [gameDate, setGameDate] = useState(prefillDate || new Date().toISOString().split('T')[0]);
  const [umpire, setUmpire] = useState('Default');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);
  const logRef = useRef([]);
  const addLog = m => { logRef.current=[...logRef.current,m]; setLog([...logRef.current]); };

  // Update teams if prefill changes
  useEffect(() => { if (prefillHome) setHomeTeam(prefillHome); }, [prefillHome]);
  useEffect(() => { if (prefillAway) setAwayTeam(prefillAway); }, [prefillAway]);

  const run = useCallback(async () => {
    if (homeTeam.id===awayTeam.id) return;
    setLoading(true); setError(null); setResult(null);
    logRef.current=[]; setLog([]);
    try {
      addLog('📡 Fetching season stats…');
      const [homeHit,awayHit,homePitch,awayPitch] = await Promise.all([
        fetchTeamHitting(homeTeam.id), fetchTeamHitting(awayTeam.id),
        fetchTeamPitching(homeTeam.id), fetchTeamPitching(awayTeam.id),
      ]);

      addLog('🔍 Fetching vsTeam splits…');
      const [homeVsAway,awayVsHome] = await Promise.all([
        fetchVsTeamSplits(homeTeam.id,awayTeam.id),
        fetchVsTeamSplits(awayTeam.id,homeTeam.id),
      ]);
      addLog(homeVsAway?`✅ vsTeam splits found`:`⚠️ No vsTeam splits — using season averages`);

      addLog('⚾ Fetching probable starters…');
      const fetchSP = async (teamId) => {
        const url = `/mlb/schedule?teamId=${teamId}&season=${new Date(gameDate).getFullYear()}&gameType=S,R&startDate=${gameDate}&endDate=${gameDate}&hydrate=probablePitcher`;
        try { const r=await fetch(url); const d=await r.json();
          const g=d?.dates?.[0]?.games?.[0]; if(!g) return null;
          const isHome=g.teams?.home?.team?.id===teamId;
          return isHome?g.teams?.home?.probablePitcher:g.teams?.away?.probablePitcher;
        } catch { return null; }
      };
      const [homeStarterInfo,awayStarterInfo] = await Promise.all([fetchSP(homeTeam.id),fetchSP(awayTeam.id)]);
      addLog(homeStarterInfo?`✅ ${homeTeam.abbr}: ${homeStarterInfo.fullName}`:`⚠️ ${homeTeam.abbr} starter TBD`);
      addLog(awayStarterInfo?`✅ ${awayTeam.abbr}: ${awayStarterInfo.fullName}`:`⚠️ ${awayTeam.abbr} starter TBD`);

      addLog('📊 Fetching starter stats…');
      const [homeStarterStats,awayStarterStats] = await Promise.all([
        homeStarterInfo?fetchStarterStats(homeStarterInfo.id):null,
        awayStarterInfo?fetchStarterStats(awayStarterInfo.id):null,
      ]);

      addLog('📈 Fetching rolling form…');
      const [homeForm,awayForm] = await Promise.all([fetchRecentGames(homeTeam.id),fetchRecentGames(awayTeam.id)]);
      if (homeForm) addLog(`✅ ${homeTeam.abbr}: ${homeForm.wins}W-${homeForm.losses}L, Pyth ${(homeForm.pythWinPct*100).toFixed(1)}%`);
      if (awayForm) addLog(`✅ ${awayTeam.abbr}: ${awayForm.wins}W-${awayForm.losses}L, Pyth ${(awayForm.pythWinPct*100).toFixed(1)}%`);

      addLog('💪 Fetching bullpen fatigue…');
      const [homeBullpen,awayBullpen] = await Promise.all([fetchBullpenFatigue(homeTeam.id),fetchBullpenFatigue(awayTeam.id)]);

      addLog('👥 Fetching relievers…');
      const [homeRelievers,awayRelievers] = await Promise.all([fetchLikelyRelievers(homeTeam.id),fetchLikelyRelievers(awayTeam.id)]);

      const prediction = predictGame({
        homeTeam,awayTeam,homeHit,awayHit,homePitch,awayPitch,
        homeStarterStats,awayStarterStats,homeVsAway,awayVsHome,
        homeForm,awayForm,homeBullpen,awayBullpen,umpireName:umpire,
      });

      setResult({
        prediction,homeHit,awayHit,homePitch,awayPitch,
        homeStarter:homeStarterInfo,awayStarter:awayStarterInfo,
        homeStarterStats,awayStarterStats,homeVsAway,awayVsHome,
        homeForm,awayForm,homeBullpen,awayBullpen,homeRelievers,awayRelievers,
        dataQuality:{
          'Season Stats':!!(homeHit&&awayHit),
          'vsTeam Splits':!!(homeVsAway||awayVsHome),
          'Starter FIP/xFIP':!!(homeStarterStats&&awayStarterStats),
          'Rolling Form':!!(homeForm&&awayForm),
          'Bullpen Fatigue':!!(homeBullpen&&awayBullpen),
          'Park Factor':true,
          'Umpire':umpire!=='Default',
        }
      });
      addLog('✅ Complete!');
    } catch(e) { setError(e.message); addLog(`❌ ${e.message}`); }
    finally { setLoading(false); }
  }, [homeTeam,awayTeam,gameDate,umpire]);

  return (
    <div>
      <Panel style={{marginBottom:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:10,alignItems:'end',marginBottom:12}}>
          <div>
            <div style={{color:C.muted,fontSize:9,letterSpacing:2,marginBottom:4}}>🏠 HOME TEAM</div>
            <select value={homeTeam.id} onChange={e=>setHomeTeam(TEAMS.find(t=>t.id===+e.target.value))} style={{...selectStyle,width:'100%'}}>
              {[...TEAMS].sort((a,b)=>a.name.localeCompare(b.name)).map(t=><option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>)}
            </select>
          </div>
          <div style={{color:'#1a3a1a',fontWeight:900,fontSize:16,paddingBottom:8,textAlign:'center'}}>VS</div>
          <div>
            <div style={{color:C.muted,fontSize:9,letterSpacing:2,marginBottom:4}}>✈️ AWAY TEAM</div>
            <select value={awayTeam.id} onChange={e=>setAwayTeam(TEAMS.find(t=>t.id===+e.target.value))} style={{...selectStyle,width:'100%'}}>
              {[...TEAMS].sort((a,b)=>a.name.localeCompare(b.name)).map(t=><option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>)}
            </select>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div>
            <div style={{color:C.muted,fontSize:9,letterSpacing:2,marginBottom:4}}>📅 GAME DATE</div>
            <input type="date" value={gameDate} onChange={e=>setGameDate(e.target.value)} style={{...inputStyle,width:'100%'}}/>
          </div>
          <div>
            <div style={{color:C.muted,fontSize:9,letterSpacing:2,marginBottom:4}}>👤 HOME PLATE UMP</div>
            <select value={umpire} onChange={e=>setUmpire(e.target.value)} style={{...selectStyle,width:'100%'}}>
              {Object.keys(UMPIRE_PROFILES).map(u=><option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        {homeTeam.id===awayTeam.id && <div style={{color:C.gold,fontSize:11,marginBottom:8}}>⚠️ Select two different teams</div>}
        <button onClick={run} disabled={loading||homeTeam.id===awayTeam.id}
          style={{width:'100%',padding:'13px',background:loading?C.dim:'linear-gradient(135deg,#14532d,#15803d)',color:loading?C.muted:'#fff',border:'none',borderRadius:7,fontSize:11,fontWeight:900,letterSpacing:2.5,cursor:loading?'not-allowed':'pointer',textTransform:'uppercase',fontFamily:'monospace'}}>
          {loading?'⚡ ANALYZING…':'⚡ GENERATE PREDICTION'}
        </button>
      </Panel>

      {loading && (
        <Panel style={{marginBottom:12}}>
          <div style={{display:'flex',gap:6,justifyContent:'center',marginBottom:10}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,background:C.green,borderRadius:'50%',animation:`pulse 1s ${i*0.2}s ease infinite`}}/>)}
          </div>
          {log.map((m,i)=><div key={i} style={{fontFamily:'monospace',fontSize:11,padding:'2px 0',color:i===log.length-1?C.green:'#4a8a5a'}}>{m}</div>)}
        </Panel>
      )}

      {error && <Panel style={{marginBottom:12,borderColor:'#3a1a1a',background:'#0a0505'}}><div style={{color:C.red,fontSize:12}}>❌ {error}</div></Panel>}

      {result && !loading && (
        <div>
          {/* Score card */}
          <Panel style={{marginBottom:12}}>
            <div style={{textAlign:'center',marginBottom:14}}>
              <SLabel>Projected Final Score</SLabel>
              <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:24}}>
                {[{team:awayTeam,runs:result.prediction.awayRuns,win:result.prediction.awayRuns>result.prediction.homeRuns,tag:'AWAY'},
                  {team:homeTeam,runs:result.prediction.homeRuns,win:result.prediction.homeRuns>=result.prediction.awayRuns,tag:'HOME'}].map(({team,runs,win,tag},i)=>(
                  <div key={i} style={{textAlign:'center'}}>
                    <div style={{fontSize:9,color:C.muted,letterSpacing:2}}>{tag}</div>
                    <div style={{fontSize:13,fontWeight:800,color:C.muted}}>{team.name}</div>
                    <div style={{fontSize:52,fontWeight:900,lineHeight:1,color:win?C.green:'#8b9eb0',fontVariantNumeric:'tabular-nums'}}>{runs.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Win bar */}
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5,fontSize:13,fontWeight:800}}>
                <span style={{color:C.green}}>{homeTeam.abbr} {(result.prediction.homeWinPct*100).toFixed(1)}%</span>
                <span style={{color:C.muted}}>{awayTeam.abbr} {((1-result.prediction.homeWinPct)*100).toFixed(1)}%</span>
              </div>
              <div style={{height:18,background:'#0d0d1a',borderRadius:9,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${result.prediction.homeWinPct*100}%`,background:`linear-gradient(90deg,#14532d,${C.green})`,borderRadius:9,transition:'width 1.2s ease'}}/>
              </div>
            </div>
            {/* Odds grid */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
              {[
                {l:'MODEL ML',   v:modelWinToMoneyline(result.prediction.homeWinPct),s:`${homeTeam.abbr}`},
                {l:'AWAY ML',    v:modelWinToMoneyline(1-result.prediction.homeWinPct),s:`${awayTeam.abbr}`},
                {l:'RUN LINE',   v:`${runLineOdds(result.prediction.homeWinPct,result.prediction.homeRuns,result.prediction.awayRuns).homeML}`,s:`${homeTeam.abbr} -1.5`},
                {l:'O/U TOTAL',  v:(result.prediction.homeRuns+result.prediction.awayRuns).toFixed(1),s:'exp. runs'},
              ].map(({l,v,s})=>(
                <div key={l} style={{textAlign:'center',background:'#0d1a0d',borderRadius:6,padding:8}}>
                  <div style={{fontSize:8,color:C.muted,letterSpacing:1,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:800,color:C.green,fontFamily:'monospace'}}>{v}</div>
                  <div style={{fontSize:9,color:C.muted}}>{s}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,textAlign:'center',fontSize:11,color:C.muted}}>
              Confidence: <span style={{color:result.prediction.confidence>0.75?C.green:result.prediction.confidence>0.65?C.gold:C.muted,fontWeight:800}}>{(result.prediction.confidence*100).toFixed(0)}%</span>
              <span style={{marginLeft:8}}>Park: {result.prediction.park?.name} ({result.prediction.park?.runFactor}×)</span>
            </div>
          </Panel>

          {/* Starters */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            {[{team:homeTeam,sp:result.homeStarter,stats:result.homeStarterStats,tag:'HOME'},
              {team:awayTeam,sp:result.awayStarter,stats:result.awayStarterStats,tag:'AWAY'}].map(({team,sp,stats,tag})=>(
              <Panel key={team.id}>
                <SLabel>{team.abbr} {tag} SP</SLabel>
                <div style={{color:C.text,fontWeight:800,fontSize:13,marginBottom:8}}>{sp?.fullName||'TBD'}</div>
                {stats ? (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:3}}>
                    {[['ERA',stats.era?.toFixed(2)],['FIP',stats.fip?.toFixed(2)],['xFIP',stats.xfip?.toFixed(2)],['K/9',stats.k9?.toFixed(1)],['BB/9',stats.bb9?.toFixed(1)],['WHIP',stats.whip?.toFixed(3)]].map(([l,v])=>(
                      <div key={l} style={{textAlign:'center',background:'#0d1a0d',borderRadius:4,padding:5}}>
                        <div style={{fontSize:8,color:C.muted}}>{l}</div>
                        <div style={{fontSize:12,fontWeight:800,color:C.green,fontFamily:'monospace'}}>{v||'—'}</div>
                      </div>
                    ))}
                  </div>
                ):<div style={{color:'#a0b8c8',fontSize:10}}>Stats unavailable</div>}
              </Panel>
            ))}
          </div>

          {/* Relievers */}
          {(result.homeRelievers?.length||result.awayRelievers?.length) > 0 && (
            <Panel style={{marginBottom:10}}>
              <SLabel>Likely Relievers</SLabel>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[{team:homeTeam,rl:result.homeRelievers},{team:awayTeam,rl:result.awayRelievers}].map(({team,rl})=>(
                  <div key={team.id}>
                    <div style={{color:C.muted,fontSize:9,marginBottom:4,letterSpacing:1}}>{team.abbr} BULLPEN</div>
                    {(rl||[]).map(r=>(
                      <div key={r.name} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:`1px solid ${C.dim}`,fontSize:10}}>
                        <span style={{color:r.isCloser?C.gold:C.text}}>{r.isCloser?'🔒 ':''}{r.name}</span>
                        <span style={{color:r.era<3.5?C.green:r.era>4.5?C.red:C.muted,fontFamily:'monospace'}}>{r.era.toFixed(2)} ERA</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Stats */}
          <Panel style={{marginBottom:10}}>
            <SLabel>Season Stats Comparison</SLabel>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,fontSize:11,fontWeight:800}}>
              <span style={{color:C.green,minWidth:80,textAlign:'right'}}>{homeTeam.abbr}</span>
              <span style={{color:C.muted,flex:1,textAlign:'center'}}>STAT</span>
              <span style={{color:'#c8d8e8',minWidth:80}}>{awayTeam.abbr}</span>
            </div>
            <StatRow label="AVG"       home={result.homeHit?.avg?.toFixed(3)}  away={result.awayHit?.avg?.toFixed(3)}/>
            <StatRow label="OBP"       home={result.homeHit?.obp?.toFixed(3)}  away={result.awayHit?.obp?.toFixed(3)}/>
            <StatRow label="SLG"       home={result.homeHit?.slg?.toFixed(3)}  away={result.awayHit?.slg?.toFixed(3)}/>
            <StatRow label="wOBA"      home={estimateWOBA(result.homeHit)?.toFixed(3)} away={estimateWOBA(result.awayHit)?.toFixed(3)} highlight/>
            <StatRow label="wRC+"      home={estimateWRCPlus(result.homeHit)} away={estimateWRCPlus(result.awayHit)} highlight/>
            <StatRow label="ERA"       home={result.homePitch?.era?.toFixed(2)} away={result.awayPitch?.era?.toFixed(2)} higherIsBetter={false}/>
            <StatRow label="FIP"       home={estimateFIP(result.homePitch)?.toFixed(2)} away={estimateFIP(result.awayPitch)?.toFixed(2)} higherIsBetter={false} highlight/>
            <StatRow label="WHIP"      home={result.homePitch?.whip?.toFixed(3)} away={result.awayPitch?.whip?.toFixed(3)} higherIsBetter={false}/>
            {result.homeStarterStats && <StatRow label="SP FIP"  home={result.homeStarterStats.fip?.toFixed(2)} away={result.awayStarterStats?.fip?.toFixed(2)} higherIsBetter={false}/>}
            {result.homeStarterStats && <StatRow label="SP xFIP" home={result.homeStarterStats.xfip?.toFixed(2)} away={result.awayStarterStats?.xfip?.toFixed(2)} higherIsBetter={false}/>}
          </Panel>

          {/* Form */}
          {(result.homeForm||result.awayForm) && (
            <Panel style={{marginBottom:10}}>
              <SLabel>Rolling Form (last 15 games)</SLabel>
              {[{team:homeTeam,form:result.homeForm},{team:awayTeam,form:result.awayForm}].map(({team,form})=>(
                <div key={team.id} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,alignItems:'center'}}>
                    <span style={{color:C.text,fontWeight:700,fontSize:12}}>{team.name}</span>
                    {form && <div style={{display:'flex',gap:4}}>
                      <Badge text={`${form.wins}W-${form.losses}L`}/>
                      <Badge text={form.luckFactor>0.03?'Overperf':form.luckFactor<-0.03?'Due up':'Stable'} color={form.luckFactor>0.03?'#2a0a0a':form.luckFactor<-0.03?'#0a2a0a':C.dim} textColor={form.luckFactor>0.03?C.red:form.luckFactor<-0.03?C.green:C.muted}/>
                    </div>}
                  </div>
                  {form ? (
                    <>
                      <div style={{display:'flex',gap:2,marginBottom:4}}>
                        {form.games?.map((g,i)=>(
                          <div key={i} style={{flex:1,height:18,borderRadius:2,background:g.win?C.green:C.red,opacity:0.4+(i/form.games.length)*0.6}} title={`${g.rs}-${g.ra}`}/>
                        ))}
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted}}>
                        <span>Actual {(form.winPct*100).toFixed(0)}%</span>
                        <span>Pyth {(form.pythWinPct*100).toFixed(0)}%</span>
                        <span>RF/G {form.avgRF?.toFixed(1)}</span>
                        <span>RA/G {form.avgRA?.toFixed(1)}</span>
                      </div>
                    </>
                  ):<div style={{color:'#a0b8c8',fontSize:11}}>No form data (early season)</div>}
                </div>
              ))}
            </Panel>
          )}

          {/* Data quality */}
          <Panel>
            <SLabel>Data Coverage</SLabel>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {Object.entries(result.dataQuality).map(([k,v])=>(
                <Badge key={k} text={`${v?'✓':'✗'} ${k}`} color={v?'#0d2a0d':'#1a0d0d'} textColor={v?C.green:'#5a3030'}/>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ─── Park Tab ─────────────────────────────────────────────────
function ParkTab() {
  return (
    <div>
      <Panel>
        <SLabel>All 30 Park Run Factors</SLabel>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart layout="vertical" barSize={7}
            data={Object.entries(PARK_FACTORS).map(([id,p])=>({
              name: TEAMS.find(t=>t.id===+id)?.abbr||id,
              run: p.runFactor,
            })).sort((a,b)=>b.run-a.run)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#0d1a0d" horizontal={false}/>
            <XAxis type="number" domain={[0.85,1.2]} tick={{fill:C.muted,fontSize:9,fontFamily:'monospace'}} axisLine={false}/>
            <YAxis type="category" dataKey="name" tick={{fill:C.muted,fontSize:9,fontFamily:'monospace'}} width={30} axisLine={false}/>
            <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:'monospace',fontSize:11}}/>
            <ReferenceLine x={1.0} stroke="#1a3a1a" strokeDasharray="4 4"/>
            <Bar dataKey="run" fill={C.green} radius={[0,3,3,0]}/>
          </BarChart>
        </ResponsiveContainer>
        <div style={{fontSize:10,color:C.muted,marginTop:6}}>
          Run factor vs neutral (1.00). Coors Field 1.16× = ~16% more runs. Oracle Park 0.91× = ~9% fewer runs.
        </div>
      </Panel>
      <Panel style={{marginTop:10}}>
        <SLabel>Park Details</SLabel>
        {Object.entries(PARK_FACTORS).sort((a,b)=>b[1].runFactor-a[1].runFactor).map(([id,p])=>(
          <div key={id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`1px solid ${C.dim}`,fontSize:11}}>
            <span style={{color:C.text,minWidth:50,fontWeight:700}}>{TEAMS.find(t=>t.id===+id)?.abbr||id}</span>
            <span style={{color:C.muted,flex:1,fontSize:10}}>{p.name}</span>
            <span style={{color:p.runFactor>1.04?C.gold:p.runFactor<0.95?C.blue:C.green,fontFamily:'monospace',fontWeight:800,minWidth:36}}>{p.runFactor}</span>
            <span style={{color:'#a0b8c8',fontSize:9,minWidth:90,textAlign:'right'}}>{p.notes}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ─── Deploy Tab ───────────────────────────────────────────────
function DeployTab() {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <Panel style={{background:'#09090f',borderColor:'#1a1a3a'}}>
        <SLabel>🚀 You Are Deployed!</SLabel>
        <div style={{fontSize:12,color:'#c8d8e8',lineHeight:1.9}}>
          Since you're reading this on Vercel, the MLB API proxy is live. All schedule, stats, and pitcher data flows through <code style={{color:'#a5b4fc'}}>/mlb/*</code> → <code style={{color:'#a5b4fc'}}>statsapi.mlb.com/api/v1/*</code> via Vercel's edge network — no CORS, no CSP issues.
        </div>
      </Panel>
      <Panel style={{background:'#09090f',borderColor:'#1a1a3a'}}>
        <SLabel>Live Odds API (Optional)</SLabel>
        <div style={{fontSize:12,color:'#c8d8e8',lineHeight:1.9,marginBottom:10}}>
          Get a free key at <span style={{color:'#a5b4fc'}}>the-odds-api.com</span> (500 req/month free). Add it as a Vercel environment variable:
        </div>
        <div style={{background:'#06060c',borderRadius:8,padding:12,fontFamily:'monospace',fontSize:11,color:'#a5b4fc',lineHeight:2}}>
          {`VITE_ODDS_API_KEY=your_key_here`}<br/>
          {`# In Vercel dashboard → Project → Settings → Environment Variables`}
        </div>
      </Panel>
      <Panel style={{background:'#09090f',borderColor:'#1a1a3a'}}>
        <SLabel>Statcast Backend (Tier 3)</SLabel>
        <div style={{background:'#06060c',borderRadius:8,padding:12,fontFamily:'monospace',fontSize:10,color:'#a5b4fc',lineHeight:1.9,overflowX:'auto'}}>
{`# api/statcast.py — add to this repo
from http.server import BaseHTTPRequestHandler
import json
try:
  import pybaseball; pybaseball.cache.enable()
except: pass

class handler(BaseHTTPRequestHandler):
  def do_GET(self):
    from urllib.parse import urlparse, parse_qs
    qs = parse_qs(urlparse(self.path).query)
    abbr = qs.get("teamAbbr", ["NYY"])[0]
    season = int(qs.get("season", [2026])[0])
    try:
      df = pybaseball.team_batting(season)
      row = df[df["Team"] == abbr].iloc[0]
      out = {
        "xwOBA": float(row.get("xwOBA", 0.320)),
        "barrelRate": float(row.get("Barrel%", 8.5)) / 100,
        "hardHitPct": float(row.get("HardHit%", 38.0)) / 100,
        "exitVelo": float(row.get("EV", 88.5)),
      }
    except Exception as e:
      out = {"error": str(e)}
    self.send_response(200)
    self.send_header("Content-type","application/json")
    self.send_header("Access-Control-Allow-Origin","*")
    self.end_headers()
    self.wfile.write(json.dumps(out).encode())`}
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:8}}>Add <code style={{color:'#a5b4fc'}}>pybaseball</code> to <code style={{color:'#a5b4fc'}}>requirements.txt</code> in the repo root.</div>
      </Panel>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────
const TABS = ['📅 Calendar','⚾ Matchup','🏟️ Parks','🚀 Deploy'];

export default function App() {
  const [activeTab, setActiveTab] = useState('📅 Calendar');
  const [matchupPrefill, setMatchupPrefill] = useState({});

  const handleCalendarSelect = (game) => {
    setMatchupPrefill({
      home: game.homeTeam ? TEAMS.find(t=>t.id===game.homeTeam.id)||game.homeTeam : null,
      away: game.awayTeam ? TEAMS.find(t=>t.id===game.awayTeam.id)||game.awayTeam : null,
      date: game.gameTime ? game.gameTime.split('T')[0] : null,
    });
  };

  return (
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'Courier New',monospace",color:C.text,padding:'18px 14px',maxWidth:900,margin:'0 auto'}}>
      <style>{`
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#060a06;}
        ::-webkit-scrollbar-thumb{background:#1a3a1a;border-radius:3px;}
        option{background:#0d140d;}
        .tab{cursor:pointer;padding:7px 12px;border-radius:5px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;transition:all 0.15s;border:1px solid transparent;font-family:'Courier New',monospace;background:transparent;}
        .tab.active{background:#0d2a0d;color:#39d353;border-color:#1a4a1a;}
        .tab.inactive{color:#4a5568;}
        .tab:hover:not(.active){border-color:#182418;color:#6a7a6a;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Header */}
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{fontSize:9,letterSpacing:5,color:'#1a4a1a',marginBottom:3}}>⚾ ADVANCED ANALYTICS</div>
        <h1 style={{margin:0,fontSize:24,fontWeight:900,letterSpacing:-1}}>
          <span style={{color:C.green}}>MLB PREDICTOR</span>{' '}
          <span style={{color:'#4a8a5a',fontSize:14}}>v5</span>
        </h1>
        <div style={{color:C.muted,fontSize:9,marginTop:4,letterSpacing:3}}>
          LIVE DATA · PARK FACTORS · STARTERS · FORM · BULLPEN · vsTeam SPLITS
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
        {TABS.map(tab=>(
          <button key={tab} className={`tab ${activeTab===tab?'active':'inactive'}`} onClick={()=>setActiveTab(tab)}>{tab}</button>
        ))}
      </div>

      {activeTab==='📅 Calendar' && <CalendarTab onSelectGame={handleCalendarSelect}/>}
      {activeTab==='⚾ Matchup'  && <MatchupTab prefillHome={matchupPrefill.home} prefillAway={matchupPrefill.away} prefillDate={matchupPrefill.date}/>}
      {activeTab==='🏟️ Parks'    && <ParkTab/>}
      {activeTab==='🚀 Deploy'   && <DeployTab/>}

      <div style={{textAlign:'center',marginTop:18,color:'#2a4a3a',fontSize:9,letterSpacing:2,fontFamily:'monospace'}}>
        MLB PREDICTOR v5 · {new Date().getFullYear()} · Vercel Edge Proxy · statsapi.mlb.com
      </div>
    </div>
  );
}
