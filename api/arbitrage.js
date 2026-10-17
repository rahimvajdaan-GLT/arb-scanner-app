const ENGINE = 'open-books-v4';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
const ACTION_DAYS_AHEAD = 3;

const SPORTS = {
  nfl:{p:889,d:88808,an:'nfl'}, ncaaf:{p:880,d:87637,an:'ncaaf'},
  nba:{p:487,d:42648,b:3,an:'nba'}, ncaab:{p:493,d:92483,b:3,an:'ncaab'},
  mlb:{p:246,d:84240,an:'mlb'}, nhl:{p:1456,d:42133,b:2,an:'nhl'},
  ufc:{p:8676,d:9034}, boxing:{p:1424,d:9033},
  soccer_epl:{p:1980,d:40253,b:1}, soccer_laliga:{p:2196,d:40031,b:1},
  soccer_bundesliga:{p:1842,d:40029,b:1}, soccer_seriea:{p:2436,d:40030,b:1},
  soccer_ligue1:{p:2036,d:40032,b:1}, soccer_mls:{p:2143,d:40828,b:1},
  soccer_uefa_champs_league:{p:2627,d:40685,b:1}, soccer_uefa_europa_league:{p:2630,d:40688,b:1},
  tennis_atp:{p:2417,d:39992,b:4}, tennis_wta:{p:2421,d:39993,b:4},
};

const DEFAULT_SPORTS = [
  'nfl','ncaaf','nba','ncaab','nhl','mlb',
  'soccer_epl','soccer_laliga','soccer_bundesliga','soccer_seriea',
  'soccer_ligue1','soccer_uefa_champs_league','tennis_atp','tennis_wta'
];

const ACTION = 'https://api.actionnetwork.com/web';
const PIN = 'https://guest.api.arcadia.pinnacle.com/0.1';
const DK = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5';
const LB = 'https://linebet.com/service-api/LineFeed/Get1x2_VZip';
const BASE_HEADERS = { Accept:'application/json', 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' };
const PIN_HEADERS = { ...BASE_HEADERS, 'X-API-Key':'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R', Referer:'https://www.pinnacle.com/', Origin:'https://www.pinnacle.com' };
const LB_HEADERS = { ...BASE_HEADERS, Referer:'https://linebet.com/en/line/football', Origin:'https://linebet.com', 'x-svc-source':'__BETTING_APP__', 'x-app-n':'__BETTING_APP__', 'x-requested-with':'XMLHttpRequest', 'is-srv':'false' };

let actionBooksCache = null;
let actionBooksAt = 0;

async function json(url, headers = BASE_HEADERS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(url, { headers, signal:controller.signal, redirect:'follow', cache:'no-store' });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).hostname}`);
    try { return JSON.parse(body); } catch { throw new Error(`Invalid JSON from ${new URL(url).hostname}`); }
  } finally { clearTimeout(timer); }
}

function ms(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const raw = String(value || '').trim();
  if (/^\d{10,13}$/.test(raw)) { const n=Number(raw); return n > 1e12 ? n : n * 1000; }
  const parsed = Date.parse(raw); return Number.isFinite(parsed) ? parsed : NaN;
}
function iso(value) { const t=ms(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function american(value) {
  const n=Number(value); if (!Number.isFinite(n) || n===0) return null;
  return n > 0 ? n/100+1 : 100/Math.abs(n)+1;
}
function decimalOdds(value) {
  const n=Number(value); if (!Number.isFinite(n)) return null;
  if (n > 1 && n < 20) return n;
  return american(n);
}
function norm(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g,' ').replace(/\bunited\b/g,'utd')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function same(a,b) {
  const x=norm(a), y=norm(b); if (!x || !y) return false;
  if (x===y || x.replace(/\s/g,'')===y.replace(/\s/g,'')) return true;
  if (x.length>4 && y.length>4 && (x.includes(y)||y.includes(x))) return true;
  const A=new Set(x.split(' ')), B=new Set(y.split(' '));
  return [...A].filter(t=>B.has(t)).length / Math.max(A.size,B.size,1) >= 0.6;
}
function team(value) { return typeof value==='string' ? value : (value?.N || value?.name || ''); }
function fullPeriod(sport, period) { const p=Number(period); return ['nba','ncaab'].includes(sport) ? (p===0 || p===3) : p===0; }
function marketAllowed(market, mode) {
  if (mode==='all') return ['h2h','spreads','totals'].includes(market);
  if (mode==='lines') return ['spreads','totals'].includes(market);
  return market===mode;
}
function addOffer(out, market, role, odds, book, point=null) {
  const o=Number(odds), p=point==null?null:Number(point);
  if (!role || !Number.isFinite(o) || o<=1) return;
  out.push({ market, role, odds:o, book, point:Number.isFinite(p)?p:null });
}
function dateKey(offset=0) {
  const d=new Date(Date.now()+offset*86400000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

async function actionBooks() {
  if (actionBooksCache && Date.now()-actionBooksAt < 15*60*1000) return actionBooksCache;
  const fallback = new Map([['68','DraftKings'],['69','FanDuel'],['71','BetRivers'],['75','BetMGM'],['49','Caesars']]);
  try {
    const payload=await json(`${ACTION}/v1/books`);
    const map=new Map();
    for (const book of payload?.books || []) {
      const id=String(book?.id ?? '');
      const name=String(book?.display_name || book?.name || '').trim();
      if (id && name) map.set(id,name);
    }
    actionBooksCache = map.size ? map : fallback;
  } catch { actionBooksCache=fallback; }
  actionBooksAt=Date.now();
  return actionBooksCache;
}
function realActionBook(id,name) {
  const n=String(name||'').toLowerCase();
  if (['15','30'].includes(String(id))) return false;
  if (!name || /consensus|\bopen\b/.test(n)) return false;
  return true;
}
function actionEntries(entries, side) {
  return (Array.isArray(entries)?entries:[]).filter(x => String(x?.side||'').toLowerCase()===side && (x?.period==null || x?.period==='event'));
}
async function actionNetwork(sport, slug, mode) {
  if (!slug) return [];
  const books=await actionBooks();
  const dates=Array.from({length:ACTION_DAYS_AHEAD+1},(_,i)=>dateKey(i));
  const settled=await Promise.allSettled(dates.map(date=>json(`${ACTION}/v2/scoreboard/${encodeURIComponent(slug)}?date=${date}`)));
  const games=settled.filter(x=>x.status==='fulfilled').flatMap(x=>Array.isArray(x.value?.games)?x.value.games:[]);
  const out=[], seen=new Set();
  for (const game of games) {
    const gameId=String(game?.id ?? '');
    const teams=new Map((game?.teams||[]).map(t=>[String(t?.id),t]));
    const homeObj=teams.get(String(game?.home_team_id)) || {}, awayObj=teams.get(String(game?.away_team_id)) || {};
    const home=homeObj.full_name || homeObj.name || homeObj.display_name;
    const away=awayObj.full_name || awayObj.name || awayObj.display_name;
    const time=iso(game?.start_time);
    if (!home || !away || !time || ms(time)<=Date.now()+FUTURE_BUFFER_MS) continue;
    for (const [bookId, marketWrap] of Object.entries(game?.markets || {})) {
      const book=books.get(String(bookId));
      if (!realActionBook(bookId,book)) continue;
      const uniq=`${gameId}|${bookId}`; if (seen.has(uniq)) continue; seen.add(uniq);
      const event=marketWrap?.event || marketWrap || {};
      const offers=[];
      if (marketAllowed('h2h',mode)) {
        for (const row of actionEntries(event?.moneyline,'home')) addOffer(offers,'h2h','home',decimalOdds(row?.odds),book,null);
        for (const row of actionEntries(event?.moneyline,'away')) addOffer(offers,'h2h','away',decimalOdds(row?.odds),book,null);
        for (const row of actionEntries(event?.moneyline,'draw')) addOffer(offers,'h2h','draw',decimalOdds(row?.odds),book,null);
      }
      if (marketAllowed('spreads',mode)) {
        for (const row of actionEntries(event?.spread,'home')) addOffer(offers,'spreads','home',decimalOdds(row?.odds),book,row?.value);
        for (const row of actionEntries(event?.spread,'away')) addOffer(offers,'spreads','away',decimalOdds(row?.odds),book,row?.value);
      }
      if (marketAllowed('totals',mode)) {
        for (const row of actionEntries(event?.total,'over')) addOffer(offers,'totals','over',decimalOdds(row?.odds),book,row?.value);
        for (const row of actionEntries(event?.total,'under')) addOffer(offers,'totals','under',decimalOdds(row?.odds),book,row?.value);
      }
      if (offers.length>=2) out.push({sport,home,away,time,book,offers});
    }
  }
  return out;
}

async function pinnacle(sport,id,mode) {
  if (!id) return [];
  const [matches,markets]=await Promise.all([
    json(`${PIN}/leagues/${id}/matchups?brandId=0`,PIN_HEADERS),
    json(`${PIN}/leagues/${id}/markets/straight?primaryOnly=false`,PIN_HEADERS),
  ]);
  if (!Array.isArray(matches)||!Array.isArray(markets)) return [];
  const by=new Map();
  for (const m of markets) {
    if (!fullPeriod(sport,m?.period)) continue;
    const type=String(m?.type||'').toLowerCase();
    const mapped=type==='moneyline'?'h2h':type==='spread'?'spreads':type==='total'?'totals':null;
    if (!mapped || !marketAllowed(mapped,mode)) continue;
    if (!by.has(m.matchupId)) by.set(m.matchupId,[]); by.get(m.matchupId).push({...m,_mapped:mapped});
  }
  const out=[];
  for (const match of matches) {
    if (!match || match.parent || match.type==='special') continue;
    const home=match.participants?.find(x=>x?.alignment==='home')?.name;
    const away=match.participants?.find(x=>x?.alignment==='away')?.name;
    const time=iso(match.startTime); if (!home||!away||!time) continue;
    const offers=[];
    for (const m of by.get(match.id)||[]) for (const p of m.prices||[]) {
      const odds=american(p?.price); if (!odds) continue;
      const d=String(p?.designation||'').toLowerCase();
      const role=m._mapped==='totals'?(d==='over'?'over':d==='under'?'under':null):(d==='home'?'home':d==='away'?'away':(d==='draw'||d==='tie')?'draw':null);
      addOffer(offers,m._mapped,role,odds,'Pinnacle',p?.points??null);
    }
    if (offers.length>=2) out.push({sport,home,away,time,book:'Pinnacle',offers});
  }
  return out;
}
function dkKind(label,cat) {
  const s=`${label||''} ${cat||''}`.toLowerCase();
  if (/first half|1st half|quarter|period|set |team total|player/.test(s)) return null;
  if (/spread|run line|puck line|handicap/.test(s)) return 'spreads';
  if (/game total|total|over\/under|over under/.test(s)) return 'totals';
  if (/moneyline|money line|match winner|3-way|3 way|winner|to win/.test(s)) return 'h2h';
  return null;
}
async function draftkings(sport,id,mode) {
  if (!id) return [];
  const data=await json(`${DK}/eventgroups/${id}?format=json`), root=data?.eventGroup||data, events=root?.events||[], cats=root?.offerCategories||[], by=new Map();
  for (const cat of cats) for (const desc of cat?.offerSubcategoryDescriptors||[]) for (const list of desc?.offerSubcategory?.offers||[]) for (const offer of Array.isArray(list)?list:[]) {
    const market=dkKind(offer?.label,cat?.name); if (!offer?.eventId||!market||!marketAllowed(market,mode)) continue;
    if (!by.has(offer.eventId)) by.set(offer.eventId,[]); by.get(offer.eventId).push({...offer,_market:market});
  }
  const out=[];
  for (const event of events) {
    const home=event?.teamName1||event?.team1, away=event?.teamName2||event?.team2, time=iso(event?.startDate); if (!home||!away||!time) continue;
    const offers=[];
    for (const m of by.get(event.eventId)||[]) for (const o of m?.outcomes||[]) {
      const odds=Number(o?.oddsDecimal), name=String(o?.label||o?.participant||''); if (!Number.isFinite(odds)||odds<=1) continue;
      const role=m._market==='totals'?(/^over\b/i.test(name)?'over':/^under\b/i.test(name)?'under':null):(same(name,home)?'home':same(name,away)?'away':/^(draw|tie)$/i.test(name)?'draw':null);
      addOffer(offers,m._market,role,odds,'DraftKings',o?.line??null);
    }
    if (offers.length>=2) out.push({sport,home,away,time,book:'DraftKings',offers});
  }
  return out;
}
async function linebet(sport,id,mode) {
  if (!id || !marketAllowed('h2h',mode)) return [];
  const q=new URLSearchParams({count:'100',lng:'en',mode:'4',country:'87',partner:'189',gr:'650',sports:String(id),virtualSports:'false',noFilterBlockEvent:'true'});
  const data=await json(`${LB}?${q}`,LB_HEADERS), rows=Array.isArray(data?.Value)?data.Value:[], out=[];
  for (const e of rows) {
    const home=team(e?.O1), away=team(e?.O2), time=iso(e?.S); if (!home||!away||!time) continue;
    const offers=[]; for (const p of e?.E||[]) {
      if (Number(p?.G)!==1) continue; const t=Number(p?.T), odds=Number(p?.C??p?.P), role=t===1?'home':t===2?'draw':t===3?'away':null;
      addOffer(offers,'h2h',role,odds,'Linebet',null);
    }
    if (offers.length>=2) out.push({sport,home,away,time,book:'Linebet',offers});
  }
  return out;
}

function findBucket(buckets,event) {
  const t=ms(event.time);
  return buckets.find(b=>b.sport===event.sport && Math.abs(ms(b.time)-t)<=45*60*1000 && ((same(b.home,event.home)&&same(b.away,event.away))||(same(b.home,event.away)&&same(b.away,event.home))));
}
function merge(events) {
  const buckets=[];
  for (const event of events) {
    let b=findBucket(buckets,event);
    if (!b) { b={sport:event.sport,home:event.home,away:event.away,time:event.time,offers:[],books:new Set()}; buckets.push(b); }
    b.books.add(event.book);
    const reversed=same(event.home,b.away)&&same(event.away,b.home);
    for (const offer of event.offers) {
      let role=offer.role, point=offer.point;
      if (reversed && (role==='home'||role==='away')) { role=role==='home'?'away':'home'; if (offer.market==='spreads'&&Number.isFinite(point)) point=-point; }
      b.offers.push({...offer,role,point});
    }
  }
  return buckets;
}
function marketLines(bucket,market) {
  if (market==='h2h') return [{offers:bucket.offers.filter(x=>x.market==='h2h')}];
  const groups=new Map();
  for (const o of bucket.offers.filter(x=>x.market===market)) {
    if (!Number.isFinite(o.point)) continue;
    const line=market==='spreads'?Math.abs(o.point):o.point, key=Number(line).toFixed(4);
    if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(o);
  }
  return [...groups.values()].map(offers=>({offers}));
}
function buildArb(bucket,market,offers) {
  const best={}; for (const o of offers) if (!best[o.role]||o.odds>best[o.role].odds) best[o.role]=o;
  const roles=market==='totals'?['over','under']:market==='spreads'?['home','away']:offers.some(x=>x.role==='draw')?['home','draw','away']:['home','away'];
  if (roles.some(r=>!best[r])) return null;
  const picks=roles.map(role=>{const p=best[role];return{name:role==='home'?bucket.home:role==='away'?bucket.away:role==='draw'?'Draw':role==='over'?'Over':'Under',point:p.point,best_price:Number(p.odds),best_bookmaker:p.book}});
  if (new Set(picks.map(x=>x.best_bookmaker)).size<2) return null;
  const inv=picks.reduce((s,x)=>s+1/x.best_price,0); if (!Number.isFinite(inv)||inv>=1) return null;
  const roi=(1/inv-1)*100;
  return {
    event_id:`${bucket.sport}-${norm(bucket.home).replace(/\s/g,'')}-${norm(bucket.away).replace(/\s/g,'')}-${market}-${Math.round(ms(bucket.time)/60000)}`,
    sport_key:bucket.sport, home_team:bucket.home, away_team:bucket.away, commence_time:bucket.time, market_type:market,
    source_type:ENGINE, is_arb:true, arb_pct:Number(roi.toFixed(3)), selections:picks,
    optimal_stakes:picks.map(x=>({name:x.name,point:x.point,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100})),
  };
}
function arbsForBucket(bucket,mode) {
  const markets=mode==='all'?['h2h','spreads','totals']:mode==='lines'?['spreads','totals']:[mode], out=[];
  for (const market of markets) for (const line of marketLines(bucket,market)) { const a=buildArb(bucket,market,line.offers); if (a) out.push(a); }
  return out;
}

async function scan(key,mode,diagnostics=false) {
  const c=SPORTS[key]; if (!c) return diagnostics?{events:[],providers:[]}:[];
  const defs=[];
  if (c.an) defs.push(['ActionNetwork',()=>actionNetwork(key,c.an,mode)]);
  else {
    defs.push(['Pinnacle',()=>pinnacle(key,c.p,mode)],['DraftKings',()=>draftkings(key,c.d,mode)]);
    if (c.b) defs.push(['Linebet',()=>linebet(key,c.b,mode)]);
  }
  const settled=await Promise.allSettled(defs.map(x=>x[1]()));
  const providers=settled.map((r,i)=>({provider:defs[i][0],ok:r.status==='fulfilled',events:r.status==='fulfilled'?r.value.length:0,error:r.status==='rejected'?String(r.reason?.message||r.reason).slice(0,220):null}));
  const events=settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);
  return diagnostics?{events,providers}:events;
}

export default async function handler(req,res) {
  if (req.method!=='GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method not allowed'}); }
  const sport=typeof req.query.sport_key==='string'?req.query.sport_key.trim():'';
  const raw=typeof req.query.market_mode==='string'?req.query.market_mode.toLowerCase():'all';
  const mode=['all','h2h','lines','spreads','totals'].includes(raw)?raw:'all';
  const debug=String(req.query.debug||'')==='1';
  if (sport&&!SPORTS[sport]) return res.status(400).json({error:`Unsupported sport_key: ${sport}`});
  try {
    const keys=sport?[sport]:DEFAULT_SPORTS;
    if (debug) {
      const sample=sport?keys:keys.slice(0,6), scans=await Promise.all(sample.map(k=>scan(k,mode,true)));
      const details=sample.map((k,i)=>{const events=scans[i].events, merged=merge(events).filter(x=>ms(x.time)>Date.now()+FUTURE_BUFFER_MS), arbs=merged.flatMap(b=>arbsForBucket(b,mode));return{sport_key:k,providers:scans[i].providers,total_events:events.length,merged_events:merged.length,cross_book_events:merged.filter(x=>x.books.size>=2).length,arbs:arbs.length}});
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({engine:ENGINE,future_buffer_minutes:FUTURE_BUFFER_MS/60000,sports:details});
    }
    const groups=await Promise.all(keys.map(k=>scan(k,mode,false)));
    const merged=merge(groups.flat()).filter(x=>ms(x.time)>Date.now()+FUTURE_BUFFER_MS);
    const arbs=merged.flatMap(b=>arbsForBucket(b,mode)).sort((a,b)=>Number(b.arb_pct)-Number(a.arb_pct)||ms(a.commence_time)-ms(b.commence_time)).slice(0,100);
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Odds-Engine',ENGINE); res.setHeader('X-Odds-Providers','ActionNetwork,Pinnacle,DraftKings,Linebet');
    res.setHeader('X-Merged-Events',String(merged.filter(x=>x.books?.size>=2).length)); res.setHeader('X-Arb-Count',String(arbs.length));
    return res.status(200).json(arbs);
  } catch (error) { return res.status(500).json({error:'Open odds scan failed',detail:error?.message||String(error),engine:ENGINE}); }
}
