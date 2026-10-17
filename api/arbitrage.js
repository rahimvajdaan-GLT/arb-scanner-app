const ENGINE = 'au-multibook-v9';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;

const HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept':'application/json',
};

const AU_SPORTS = [
  { key:'afl', sb:7, tab:'Australian%20Rules', lb:'AFL' },
  { key:'nrl', sb:8, tab:'Rugby%20League', lb:'NRL' },
  { key:'cricket', sb:5, tab:'Cricket', lb:'Cricket' },
  { key:'soccer', sb:1, tab:'Soccer', lb:'Soccer' },
  { key:'basketball', sb:12, tab:'Basketball', lb:'Basketball' },
  { key:'nfl', sb:15, tab:'American%20Football', lb:'American_Football' },
  { key:'rugby_union', sb:3, tab:'Rugby%20Union', lb:'Rugby_Union' },
  { key:'tennis', sb:14, tab:'Tennis', lb:'Tennis' },
  { key:'nhl', sb:null, tab:'Ice%20Hockey', lb:'Ice_Hockey' },
];

const ALIASES = new Map([
  ['aussierules_afl','afl'],['rugby_league_nrl','nrl'],['basketball_nba','basketball'],
  ['basketball_ncaab','basketball'],['americanfootball_nfl','nfl'],['icehockey_nhl','nhl'],
  ['soccer_epl','soccer'],['soccer_mls','soccer'],['tennis_atp','tennis'],['tennis_wta','tennis'],
]);

async function getJson(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers:{ ...HEADERS, ...extraHeaders },
      signal:controller.signal,
      redirect:'follow',
      cache:'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).hostname}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const raw = String(value || '').trim();
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? n : n * 1000;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : NaN;
}

function iso(value) {
  const t = parseMs(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function norm(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g,' ')
    .replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function sameTeam(a,b) {
  const x=norm(a), y=norm(b);
  if (!x || !y) return false;
  if (x===y || x.replace(/\s/g,'')===y.replace(/\s/g,'')) return true;
  if (x.length>4 && y.length>4 && (x.includes(y)||y.includes(x))) return true;
  const A=new Set(x.split(' ')), B=new Set(y.split(' '));
  const common=[...A].filter(t=>B.has(t)).length;
  return common/Math.max(1,Math.min(A.size,B.size)) >= 0.6;
}

function parseTeams(name) {
  const s=String(name||'');
  for (const sep of [' v ',' vs ',' @ ',' at ']) {
    if (!s.toLowerCase().includes(sep.trim().toLowerCase())) continue;
    const re = new RegExp(`\\s${sep.trim()}\\s`,'i');
    const parts=s.split(re);
    if (parts.length<2) continue;
    if (sep.trim()==='@' || sep.trim()==='at') return { home:parts[1].trim(), away:parts[0].trim() };
    return { home:parts[0].trim(), away:parts[1].trim() };
  }
  return null;
}

function decimal(value) {
  const n=Number(value);
  return Number.isFinite(n) && n>1 ? n : null;
}

function roleFor(name, home, away) {
  const n=String(name||'').trim();
  if (sameTeam(n,home)) return 'home';
  if (sameTeam(n,away)) return 'away';
  if (/^(draw|tie)$/i.test(n)) return 'draw';
  return null;
}

function makeEvent(sport,home,away,time,book,prices,source) {
  const t=iso(time);
  if (!home || !away || !t || parseMs(t)<=Date.now()+FUTURE_BUFFER_MS) return null;
  const offers=[];
  for (const p of prices||[]) {
    const odds=decimal(p.odds);
    const role=p.role || roleFor(p.name,home,away);
    if (role && odds) offers.push({ market:'h2h', role, odds, point:null, book });
  }
  if (offers.length<2) return null;
  return { sport,home,away,time:t,book,offers,source };
}

async function sportsbet(meta) {
  if (!meta.sb) return [];
  const url=`https://www.sportsbet.com.au/apigw/sportsbook-sports/Sportsbook/Sports/Events/${meta.sb}/SportMatches/Filter/0/50`;
  const data=await getJson(url,{
    'Referer':'https://www.sportsbet.com.au/','Origin':'https://www.sportsbet.com.au','X-SB-ClientConfig':'au'
  });
  const rows=Array.isArray(data)?data:(data?.events||[]), out=[];
  for (const ev of rows) {
    if (ev?.inRunning===true || ev?.hasBIRStarted===true) continue;
    const teams=parseTeams(ev?.name || ev?.displayName);
    if (!teams) continue;
    const markets=Array.isArray(ev?.markets)?ev.markets:[];
    const m=markets.find(x=>/head|match odds|match result|winner|win/i.test(`${x?.marketTypeCode||''} ${x?.displayName||x?.name||''}`)) || markets[0] || ev?.primaryMarket;
    const sels=Array.isArray(m?.propositions)?m.propositions:(Array.isArray(m?.selections)?m.selections:[]);
    const prices=sels.slice(0,3).map(s=>({name:s?.displayName||s?.name,odds:s?.winOdds??s?.returnWin??s?.prices?.find?.(p=>p?.priceCode==='L')?.winPrice??s?.prices?.[0]?.winPrice}));
    const item=makeEvent(meta.key,teams.home,teams.away,ev?.startDateTime??ev?.startTime,'Sportsbet',prices,'sportsbet');
    if (item) out.push(item);
  }
  return out;
}

async function tab(meta) {
  const url=`https://api.tab.com.au/v1/tab-info-service/sports/${meta.tab}/matches?jurisdiction=SA&returnOffers=true`;
  const data=await getJson(url,{'Referer':'https://www.tab.com.au/','Origin':'https://www.tab.com.au'});
  const rows=data?.matches||data?.meetings||[], out=[];
  for (const ev of rows) {
    if (ev?.isLive===true) continue;
    const teams=parseTeams(ev?.name);
    if (!teams) continue;
    const markets=Array.isArray(ev?.markets)?ev.markets:[];
    const m=markets.find(x=>/head|h2h|match odds|win/i.test(String(x?.betOption||x?.name||''))) || markets[0];
    const contestants=Array.isArray(m?.contestants)?m.contestants:[];
    const prices=contestants.slice(0,3).map(c=>({name:c?.name,odds:c?.returnWin??c?.winOdds??c?.price}));
    const item=makeEvent(meta.key,teams.home,teams.away,ev?.startTime,'TAB',prices,'tab');
    if (item) out.push(item);
  }
  return out;
}

async function ladbrokes(meta) {
  const url=`https://api.ladbrokes.com.au/v2/sport/competition?sport=${encodeURIComponent(meta.lb)}&betType=WIN&limit=50`;
  const data=await getJson(url,{'Referer':'https://www.ladbrokes.com.au/','Origin':'https://www.ladbrokes.com.au'});
  const rows=data?.events || (data?.competitions||[]).flatMap(c=>c?.events||[]), out=[];
  for (const ev of rows) {
    if (ev?.isLive===true) continue;
    const teams=parseTeams(ev?.name);
    if (!teams) continue;
    const markets=Array.isArray(ev?.markets)?ev.markets:[];
    const m=markets.find(x=>/head|h2h|win|match odds|result/i.test(`${x?.betType||''} ${x?.name||''}`)) || markets[0];
    const entrants=Array.isArray(m?.entrants)?m.entrants:[];
    const prices=entrants.slice(0,3).map(e=>({name:e?.name,odds:e?.returnWin??e?.price}));
    const item=makeEvent(meta.key,teams.home,teams.away,ev?.startTime,'Ladbrokes AU',prices,'ladbrokes');
    if (item) out.push(item);
  }
  return out;
}

function findBucket(buckets,e) {
  const t=parseMs(e.time);
  return buckets.find(b=>b.sport===e.sport && Math.abs(parseMs(b.time)-t)<=90*60*1000 && (
    (sameTeam(b.home,e.home)&&sameTeam(b.away,e.away)) || (sameTeam(b.home,e.away)&&sameTeam(b.away,e.home))
  ));
}

function merge(events) {
  const buckets=[];
  for (const e of events) {
    let b=findBucket(buckets,e);
    if (!b) { b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set(),sources:new Set()}; buckets.push(b); }
    b.books.add(e.book); b.sources.add(e.source);
    const reversed=sameTeam(e.home,b.away)&&sameTeam(e.away,b.home);
    for (const offer of e.offers) {
      let role=offer.role;
      if (reversed && (role==='home'||role==='away')) role=role==='home'?'away':'home';
      b.offers.push({...offer,role});
    }
  }
  return buckets;
}

function arb(bucket) {
  const best={};
  for (const o of bucket.offers) if (!best[o.role] || o.odds>best[o.role].odds) best[o.role]=o;
  const roles=bucket.offers.some(o=>o.role==='draw')?['home','draw','away']:['home','away'];
  if (roles.some(r=>!best[r])) return null;
  const selections=roles.map(r=>({
    name:r==='home'?bucket.home:r==='away'?bucket.away:'Draw',
    point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book,
  }));
  if (new Set(selections.map(x=>x.best_bookmaker)).size<2) return null;
  const inv=selections.reduce((s,x)=>s+1/x.best_price,0);
  if (!Number.isFinite(inv)||inv>=1) return null;
  const roi=(1/inv-1)*100;
  return {
    event_id:`${bucket.sport}-${norm(bucket.home).replace(/\s/g,'')}-${norm(bucket.away).replace(/\s/g,'')}-${Math.round(parseMs(bucket.time)/60000)}`,
    sport_key:bucket.sport,home_team:bucket.home,away_team:bucket.away,commence_time:bucket.time,
    market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),
    selections,
    optimal_stakes:selections.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100})),
  };
}

async function scanMeta(meta) {
  const defs=[['Sportsbet',()=>sportsbet(meta)],['TAB',()=>tab(meta)],['Ladbrokes AU',()=>ladbrokes(meta)]];
  const settled=await Promise.allSettled(defs.map(x=>x[1]()));
  const providers=settled.map((r,i)=>({provider:defs[i][0],ok:r.status==='fulfilled',events:r.status==='fulfilled'?r.value.length:0,error:r.status==='rejected'?String(r.reason?.message||r.reason).slice(0,200):null}));
  const events=settled.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  return {events,providers};
}

export default async function handler(req,res) {
  if (req.method!=='GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'Method not allowed'}); }
  const rawSport=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'';
  const sport=ALIASES.get(rawSport)||rawSport;
  const rawMode=typeof req.query.market_mode==='string'?req.query.market_mode.trim().toLowerCase():'all';
  const debug=String(req.query.debug||'')==='1';
  if (!['all','h2h','lines','spreads','totals'].includes(rawMode)) return res.status(400).json({error:'Unsupported market_mode'});
  if (!['all','h2h'].includes(rawMode) && !debug) return res.status(200).json([]);

  const metas=sport?AU_SPORTS.filter(x=>x.key===sport):AU_SPORTS;
  if (sport && !metas.length) return res.status(400).json({error:`Unsupported sport_key: ${rawSport}`});

  try {
    const scans=await Promise.all(metas.map(scanMeta));
    const raw=scans.flatMap(s=>s.events);
    const merged=merge(raw).filter(b=>parseMs(b.time)>Date.now()+FUTURE_BUFFER_MS);
    const arbs=merged.map(arb).filter(Boolean).sort((a,b)=>Number(b.arb_pct)-Number(a.arb_pct)||parseMs(a.commence_time)-parseMs(b.commence_time)).slice(0,100);

    const providerSummary={};
    for (const scan of scans) for (const p of scan.providers) {
      if (!providerSummary[p.provider]) providerSummary[p.provider]={provider:p.provider,ok:true,events:0,errors:[]};
      providerSummary[p.provider].events+=p.events;
      if (!p.ok) { providerSummary[p.provider].ok=false; if (p.error) providerSummary[p.provider].errors.push(p.error); }
    }

    if (debug) {
      return res.status(200).json({
        engine:ENGINE,
        australian_books:['Sportsbet','TAB','Ladbrokes AU'],
        future_buffer_minutes:FUTURE_BUFFER_MS/60000,
        providers:Object.values(providerSummary),
        raw_events:raw.length,
        merged_games:merged.length,
        cross_book_games:merged.filter(b=>b.books.size>=2).length,
        arbs:arbs.length,
        sample_games:merged.slice(0,8).map(b=>({sport:b.sport,home:b.home,away:b.away,time:b.time,books:[...b.books]})),
      });
    }

    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Odds-Engine',ENGINE);
    res.setHeader('X-AU-Books','Sportsbet,TAB,Ladbrokes AU');
    res.setHeader('X-Game-Count',String(merged.length));
    res.setHeader('X-Cross-Book-Games',String(merged.filter(b=>b.books.size>=2).length));
    res.setHeader('X-Arb-Count',String(arbs.length));
    return res.status(200).json(arbs);
  } catch (error) {
    return res.status(500).json({error:'Australian odds scan failed',detail:error?.message||String(error),engine:ENGINE});
  }
}
