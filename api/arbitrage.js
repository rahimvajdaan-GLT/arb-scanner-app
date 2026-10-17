const ENGINE = 'au-multibook-v10';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;

const HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept':'application/json',
};

const META = [
  { key:'afl', tab:'Australian%20Rules', lb:'AFL' },
  { key:'nrl', tab:'Rugby%20League', lb:'NRL' },
  { key:'cricket', tab:'Cricket', lb:'Cricket' },
  { key:'soccer', tab:'Soccer', lb:'Soccer' },
  { key:'basketball', tab:'Basketball', lb:'Basketball' },
  { key:'nfl', tab:'American%20Football', lb:'American_Football' },
  { key:'rugby_union', tab:'Rugby%20Union', lb:'Rugby_Union' },
  { key:'tennis', tab:'Tennis', lb:'Tennis' },
  { key:'nhl', tab:'Ice%20Hockey', lb:'Ice_Hockey' },
];

const ALIASES = new Map([
  ['aussierules_afl','afl'],['rugby_league_nrl','nrl'],['basketball_nba','basketball'],
  ['basketball_ncaab','basketball'],['americanfootball_nfl','nfl'],['icehockey_nhl','nhl'],
  ['soccer_epl','soccer'],['soccer_mls','soccer'],['tennis_atp','tennis'],['tennis_wta','tennis'],
]);

async function getJson(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const r = await fetch(url, { headers:{...HEADERS,...extraHeaders}, signal:controller.signal, redirect:'follow', cache:'no-store' });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).hostname}${text ? `: ${text.slice(0,100)}` : ''}`);
    try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON from ${new URL(url).hostname}`); }
  } finally { clearTimeout(timer); }
}

function parseMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  const s = String(v || '').trim();
  if (/^\d{10,13}$/.test(s)) { const n=Number(s); return n>1e12?n:n*1000; }
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
}
function iso(v){ const t=parseMs(v); return Number.isFinite(t)?new Date(t).toISOString():null; }
function norm(v){ return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g,' ').replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
function sameTeam(a,b){ const x=norm(a),y=norm(b); if(!x||!y)return false; if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true; if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true; const A=new Set(x.split(' ')),B=new Set(y.split(' ')); return [...A].filter(t=>B.has(t)).length/Math.max(1,Math.min(A.size,B.size))>=0.6; }
function parseTeams(name){ const s=String(name||''); for(const sep of [' v ',' vs ',' @ ',' at ']){ const re=new RegExp(`\\s${sep.trim()}\\s`,'i'); if(!re.test(s))continue; const p=s.split(re); if(p.length<2)continue; if(['@','at'].includes(sep.trim()))return{home:p[1].trim(),away:p[0].trim()}; return{home:p[0].trim(),away:p[1].trim()}; } return null; }
function decimal(v){ const n=Number(v); return Number.isFinite(n)&&n>1?n:null; }
function roleFor(name,home,away){ const n=String(name||'').trim(); if(sameTeam(n,home))return'home'; if(sameTeam(n,away))return'away'; if(/^(draw|tie)$/i.test(n))return'draw'; return null; }
function classifySport(ev){ const text=`${ev?.className||''} ${ev?.competitionName||''} ${ev?.name||''}`.toLowerCase(); if(/afl|australian rules/.test(text))return'afl'; if(/nrl|rugby league/.test(text))return'nrl'; if(/cricket/.test(text))return'cricket'; if(/soccer|football/.test(text)&&!/american/.test(text))return'soccer'; if(/basketball|nba|nbl/.test(text))return'basketball'; if(/american football|nfl|ncaaf/.test(text))return'nfl'; if(/rugby union/.test(text))return'rugby_union'; if(/tennis/.test(text))return'tennis'; if(/ice hockey|nhl/.test(text))return'nhl'; return'other'; }

function selectionPrice(s){
  if(!s)return null;
  const direct=s.winOdds??s.returnWin??s.price??s.odds;
  if(decimal(direct))return Number(direct);
  const ps=Array.isArray(s.prices)?s.prices:[];
  const p=ps.find(x=>x?.priceCode==='L')||ps[0];
  return decimal(p?.winPrice??p?.price??p?.odds);
}
function makeEvent(sport,home,away,time,book,selections,source){
  const t=iso(time); if(!home||!away||!t||parseMs(t)<=Date.now()+FUTURE_BUFFER_MS)return null;
  const offers=[];
  for(const s of selections||[]){ const odds=selectionPrice(s); const role=s.role||roleFor(s?.displayName||s?.name||s?.entrantName,home,away); if(role&&odds)offers.push({market:'h2h',role,odds,point:null,book}); }
  if(offers.length<2)return null;
  return{sport,home,away,time:t,book,offers,source};
}

async function sportsbetAll(){
  const url='https://www.sportsbet.com.au/apigw/sportsbook-sports/Sportsbook/Sports/UpComingEvents?includePrimaryMarket=true&maxEvents=250';
  const data=await getJson(url,{'Referer':'https://www.sportsbet.com.au/','Origin':'https://www.sportsbet.com.au'});
  const rows=Array.isArray(data)?data:(Array.isArray(data?.events)?data.events:[]);
  const out=[];
  for(const ev of rows){
    if(ev?.hasBIRStarted===true||ev?.inRunning===true||String(ev?.bettingStatus||'').toUpperCase()==='OFF')continue;
    const teams=(ev?.participant1&&ev?.participant2)?{home:ev.participant1,away:ev.participant2}:parseTeams(ev?.displayName||ev?.name);
    if(!teams)continue;
    const m=ev?.primaryMarket || (Array.isArray(ev?.marketList)?ev.marketList.find(x=>/head|match betting|match odds|result/i.test(String(x?.name||''))):null);
    const sels=Array.isArray(m?.selections)?m.selections:(Array.isArray(m?.propositions)?m.propositions:[]);
    const sport=classifySport(ev);
    const item=makeEvent(sport,teams.home,teams.away,ev?.startTime??ev?.startDateTime,'Sportsbet',sels,'sportsbet');
    if(item)out.push(item);
  }
  return out;
}

async function tab(meta){
  const url=`https://api.tab.com.au/v1/tab-info-service/sports/${meta.tab}/matches?jurisdiction=NSW&returnOffers=true`;
  const data=await getJson(url,{'Referer':'https://www.tab.com.au/','Origin':'https://www.tab.com.au'});
  const rows=data?.matches||data?.meetings||[]; const out=[];
  for(const ev of rows){
    if(ev?.isLive===true)continue;
    const teams=parseTeams(ev?.name); if(!teams)continue;
    const markets=Array.isArray(ev?.markets)?ev.markets:[];
    const m=markets.find(x=>/head|h2h|match odds|win|result/i.test(String(x?.betOption||x?.name||'')))||markets[0];
    const sels=Array.isArray(m?.contestants)?m.contestants:[];
    const item=makeEvent(meta.key,teams.home,teams.away,ev?.startTime,'TAB',sels,'tab'); if(item)out.push(item);
  }
  return out;
}

async function ladbrokes(meta){
  const url=`https://api.ladbrokes.com.au/v2/sport/competition?sport=${encodeURIComponent(meta.lb)}&betType=WIN&limit=100`;
  const data=await getJson(url,{'Referer':'https://www.ladbrokes.com.au/','Origin':'https://www.ladbrokes.com.au'});
  const rows=data?.events||(data?.competitions||[]).flatMap(c=>c?.events||[]); const out=[];
  for(const ev of rows){
    if(ev?.isLive===true)continue;
    const teams=parseTeams(ev?.name); if(!teams)continue;
    const markets=Array.isArray(ev?.markets)?ev.markets:[];
    const m=markets.find(x=>/head|h2h|win|match odds|result/i.test(`${x?.betType||''} ${x?.name||''}`))||markets[0];
    const sels=Array.isArray(m?.entrants)?m.entrants:[];
    const item=makeEvent(meta.key,teams.home,teams.away,ev?.startTime,'Ladbrokes AU',sels,'ladbrokes'); if(item)out.push(item);
  }
  return out;
}

function findBucket(buckets,e){ const t=parseMs(e.time); return buckets.find(b=>b.sport===e.sport&&Math.abs(parseMs(b.time)-t)<=90*60*1000&&((sameTeam(b.home,e.home)&&sameTeam(b.away,e.away))||(sameTeam(b.home,e.away)&&sameTeam(b.away,e.home)))); }
function merge(events){ const buckets=[]; for(const e of events){ let b=findBucket(buckets,e); if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set()};buckets.push(b);} b.books.add(e.book); const rev=sameTeam(e.home,b.away)&&sameTeam(e.away,b.home); for(const o of e.offers){let role=o.role;if(rev&&(role==='home'||role==='away'))role=role==='home'?'away':'home';b.offers.push({...o,role});} } return buckets; }
function arb(b){ const best={}; for(const o of b.offers)if(!best[o.role]||o.odds>best[o.role].odds)best[o.role]=o; const roles=b.offers.some(o=>o.role==='draw')?['home','draw','away']:['home','away']; if(roles.some(r=>!best[r]))return null; const selections=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book})); if(new Set(selections.map(x=>x.best_bookmaker)).size<2)return null; const inv=selections.reduce((s,x)=>s+1/x.best_price,0); if(!Number.isFinite(inv)||inv>=1)return null; const roi=(1/inv-1)*100; return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections,optimal_stakes:selections.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))}; }

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const rawSport=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'';
  const sport=ALIASES.get(rawSport)||rawSport;
  const rawMode=typeof req.query.market_mode==='string'?req.query.market_mode.trim().toLowerCase():'all';
  const debug=String(req.query.debug||'')==='1';
  if(!['all','h2h','lines','spreads','totals'].includes(rawMode))return res.status(400).json({error:'Unsupported market_mode'});
  if(!['all','h2h'].includes(rawMode)&&!debug)return res.status(200).json([]);
  const metas=sport?META.filter(x=>x.key===sport):META;
  if(sport&&!metas.length)return res.status(400).json({error:`Unsupported sport_key: ${rawSport}`});

  const providerRuns=[['Sportsbet',sportsbetAll],...metas.flatMap(m=>[[`TAB:${m.key}`,()=>tab(m)],[`Ladbrokes:${m.key}`,()=>ladbrokes(m)]])];
  const settled=await Promise.allSettled(providerRuns.map(x=>x[1]()));
  const providers=settled.map((r,i)=>({provider:providerRuns[i][0],ok:r.status==='fulfilled',events:r.status==='fulfilled'?r.value.length:0,error:r.status==='rejected'?String(r.reason?.message||r.reason).slice(0,240):null}));
  let raw=settled.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  if(sport)raw=raw.filter(e=>e.sport===sport);
  const merged=merge(raw).filter(b=>parseMs(b.time)>Date.now()+FUTURE_BUFFER_MS&&b.sport!=='other');
  const arbs=merged.map(arb).filter(Boolean).sort((a,b)=>Number(b.arb_pct)-Number(a.arb_pct)||parseMs(a.commence_time)-parseMs(b.commence_time)).slice(0,100);

  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Odds-Engine',ENGINE);
  res.setHeader('X-Game-Count',String(merged.length));
  res.setHeader('X-Cross-Book-Games',String(merged.filter(b=>b.books.size>=2).length));
  res.setHeader('X-Arb-Count',String(arbs.length));

  if(debug)return res.status(200).json({engine:ENGINE,region_hint:'syd1',future_buffer_minutes:10,providers,raw_events:raw.length,merged_games:merged.length,cross_book_games:merged.filter(b=>b.books.size>=2).length,arbs:arbs.length,sample_games:merged.slice(0,12).map(b=>({sport:b.sport,home:b.home,away:b.away,time:b.time,books:[...b.books]}))});
  return res.status(200).json(arbs);
}
