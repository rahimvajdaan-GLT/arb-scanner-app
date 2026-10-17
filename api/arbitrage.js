const ENGINE = 'open-books-v1';
const FUTURE_BUFFER_MS = 20 * 60 * 1000;

const SPORTS = {
  nfl: { p: 889, d: 88808 }, ncaaf: { p: 880, d: 87637 },
  nba: { p: 487, d: 42648 }, ncaab: { p: 493, d: 92483 },
  mlb: { p: 246, d: 84240 }, nhl: { p: 1456, d: 42133 },
  ufc: { p: 8676, d: 9034 }, boxing: { p: 1424, d: 9033 },
  soccer_epl: { p: 1980, d: 40253 }, soccer_laliga: { p: 2196, d: 40031 },
  soccer_bundesliga: { p: 1842, d: 40029 }, soccer_seriea: { p: 2436, d: 40030 },
  soccer_ligue1: { p: 2036, d: 40032 }, soccer_mls: { p: 2143, d: 40828 },
  soccer_uefa_champs_league: { p: 2627, d: 40685 },
  soccer_uefa_europa_league: { p: 2630, d: 40688 },
  tennis_atp: { p: 2417, d: 39992 }, tennis_wta: { p: 2421, d: 39993 },
};
const DEFAULT_SPORTS = ['soccer_epl','soccer_laliga','soccer_bundesliga','soccer_seriea','soccer_uefa_champs_league','nba','nfl','ncaaf','nhl','tennis_atp'];
const PIN_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const DK_BASE = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5';
// Public web-client guest header used by Pinnacle's own browser application; not a user credential.
const PIN_HEADERS = {
  'X-API-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
  'Referer': 'https://www.pinnacle.com/', 'Origin': 'https://www.pinnacle.com',
  'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124 Safari/537.36',
};
const WEB_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124 Safari/537.36' };

async function getJson(url, headers = WEB_HEADERS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const r = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
function startMs(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; }
function decFromAmerican(v) {
  const n = Number(v); if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function cleanName(v) {
  return String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g,' ').replace(/\bunited\b/g,'utd')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function sameTeam(a,b) {
  const x=cleanName(a), y=cleanName(b); if (!x || !y) return false;
  if (x===y || x.replace(/\s/g,'')===y.replace(/\s/g,'')) return true;
  if (x.length>4 && y.length>4 && (x.includes(y)||y.includes(x))) return true;
  const A=new Set(x.split(' ')), B=new Set(y.split(' '));
  return [...A].filter(t=>B.has(t)).length / Math.max(A.size,B.size,1) >= .6;
}
function fullGamePeriod(sport, period) {
  const p=Number(period); return ['nba','ncaab'].includes(sport) ? (p===0||p===3) : p===0;
}

async function pinnacle(sport, league) {
  const [matches, markets] = await Promise.all([
    getJson(`${PIN_BASE}/leagues/${league}/matchups?brandId=0`, PIN_HEADERS),
    getJson(`${PIN_BASE}/leagues/${league}/markets/straight?primaryOnly=false`, PIN_HEADERS),
  ]);
  if (!Array.isArray(matches) || !Array.isArray(markets)) return [];
  const byId=new Map();
  for (const m of markets) {
    if (String(m?.type||'').toLowerCase()!=='moneyline' || !fullGamePeriod(sport,m?.period)) continue;
    if (!byId.has(m.matchupId)) byId.set(m.matchupId,[]); byId.get(m.matchupId).push(m);
  }
  const out=[];
  for (const m of matches) {
    if (!m || m.parent || m.type==='special') continue;
    const home=m.participants?.find(x=>x?.alignment==='home')?.name;
    const away=m.participants?.find(x=>x?.alignment==='away')?.name;
    if (!home||!away||!Number.isFinite(startMs(m.startTime))) continue;
    const prices=[];
    for (const market of byId.get(m.id)||[]) for (const p of market.prices||[]) {
      const d=String(p?.designation||'').toLowerCase(), odds=decFromAmerican(p?.price);
      if (!odds) continue;
      const role=d==='home'?'home':d==='away'?'away':(d==='draw'||d==='tie')?'draw':null;
      if (role) prices.push({role,odds,book:'Pinnacle'});
    }
    if (prices.length>=2) out.push({sport,home,away,time:m.startTime,book:'Pinnacle',prices});
  }
  return out;
}

function isMoneyline(label, cat) {
  const s=`${label||''} ${cat||''}`.toLowerCase();
  return /moneyline|money line|match winner|3-way|3 way|winner|to win/.test(s) && !/first|half|quarter|period|set /.test(s);
}
async function draftkings(sport, groupId) {
  const data=await getJson(`${DK_BASE}/eventgroups/${groupId}?format=json`);
  const root=data?.eventGroup||data, events=root?.events||[], cats=root?.offerCategories||[];
  const offers=new Map();
  for (const cat of cats) for (const desc of cat?.offerSubcategoryDescriptors||[])
    for (const list of desc?.offerSubcategory?.offers||[]) for (const o of Array.isArray(list)?list:[]) {
      if (!o?.eventId || !isMoneyline(o?.label,cat?.name)) continue;
      if (!offers.has(o.eventId)) offers.set(o.eventId,[]); offers.get(o.eventId).push(o);
    }
  const out=[];
  for (const e of events) {
    const home=e?.teamName1||e?.team1, away=e?.teamName2||e?.team2;
    if (!home||!away||!Number.isFinite(startMs(e?.startDate))) continue;
    const prices=[];
    for (const o of offers.get(e.eventId)||[]) for (const p of o?.outcomes||[]) {
      const odds=Number(p?.oddsDecimal), name=String(p?.label||p?.participant||'');
      if (!Number.isFinite(odds)||odds<=1) continue;
      const role=sameTeam(name,home)?'home':sameTeam(name,away)?'away':/^(draw|tie)$/i.test(name)?'draw':null;
      if (role) prices.push({role,odds,book:'DraftKings'});
    }
    if (prices.length>=2) out.push({sport,home,away,time:e.startDate,book:'DraftKings',prices});
  }
  return out;
}

function matchEvent(buckets,e) {
  const t=startMs(e.time);
  return buckets.find(b => b.sport===e.sport && Math.abs(startMs(b.time)-t)<=20*60e3 &&
    ((sameTeam(b.home,e.home)&&sameTeam(b.away,e.away))||(sameTeam(b.home,e.away)&&sameTeam(b.away,e.home))));
}
function merge(events) {
  const buckets=[];
  for (const e of events) {
    let b=matchEvent(buckets,e);
    if (!b) { b={sport:e.sport,home:e.home,away:e.away,time:e.time,prices:[]}; buckets.push(b); }
    for (const p of e.prices) {
      let role=p.role;
      if (sameTeam(e.home,b.away)&&sameTeam(e.away,b.home)) role=role==='home'?'away':role==='away'?'home':role;
      b.prices.push({...p,role});
    }
  }
  return buckets;
}
function opportunity(b) {
  const best={home:null,draw:null,away:null};
  for (const p of b.prices) if (best[p.role]==null || p.odds>best[p.role].odds) best[p.role]=p;
  const hasDraw=b.prices.some(p=>p.role==='draw');
  const roles=hasDraw?['home','draw','away']:['home','away'];
  if (roles.some(r=>!best[r])) return null;
  const picks=roles.map(r=>({
    name:r==='home'?b.home:r==='away'?b.away:'Draw', point:null,
    best_price:Number(best[r].odds), best_bookmaker:best[r].book,
  }));
  if (new Set(picks.map(x=>x.best_bookmaker)).size<2) return null;
  const inv=picks.reduce((s,x)=>s+1/x.best_price,0); if (!Number.isFinite(inv)||inv>=1) return null;
  const roi=(1/inv-1)*100;
  return {
    event_id:`${b.sport}-${cleanName(b.home).replace(/\s/g,'')}-${cleanName(b.away).replace(/\s/g,'')}-${Math.round(startMs(b.time)/60000)}`,
    sport_key:b.sport, home_team:b.home, away_team:b.away, commence_time:b.time,
    market_type:'h2h', source_type:'open_books', is_arb:true, arb_pct:Number(roi.toFixed(3)),
    selections:picks,
    optimal_stakes:picks.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100})),
  };
}
async function scanSport(key) {
  const c=SPORTS[key]; if (!c) return [];
  const settled=await Promise.allSettled([pinnacle(key,c.p),draftkings(key,c.d)]);
  return settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
}

export default async function handler(req,res) {
  if (req.method!=='GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method not allowed'}); }
  const sport=typeof req.query.sport_key==='string'?req.query.sport_key.trim():'';
  const mode=typeof req.query.market_mode==='string'?req.query.market_mode.toLowerCase():'all';
  if (sport&&!SPORTS[sport]) return res.status(400).json({error:`Unsupported sport_key: ${sport}`});
  if (!['all','h2h','lines','spreads','totals'].includes(mode)) return res.status(400).json({error:'Unsupported market_mode'});
  if (!['all','h2h'].includes(mode)) return res.status(200).json([]);
  try {
    const keys=sport?[sport]:DEFAULT_SPORTS;
    const groups=await Promise.all(keys.map(scanSport));
    const arbs=merge(groups.flat())
      .filter(x=>startMs(x.time)>Date.now()+FUTURE_BUFFER_MS)
      .map(opportunity).filter(Boolean)
      .sort((a,b)=>Number(b.arb_pct)-Number(a.arb_pct)||startMs(a.commence_time)-startMs(b.commence_time))
      .slice(0,50);
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Odds-Engine',ENGINE); res.setHeader('X-Odds-Providers','Pinnacle,DraftKings');
    return res.status(200).json(arbs);
  } catch (e) {
    return res.status(500).json({error:'Open odds scan failed',detail:e?.message||String(e),engine:ENGINE});
  }
}
