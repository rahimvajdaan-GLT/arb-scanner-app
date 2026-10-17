const ENGINE = 'au-openbooks-v11';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
const MAX_DETAIL_EVENTS = 18;

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const TAB_SPORTS = [
  { key:'afl', name:'AFL Football' },
  { key:'nrl', name:'Rugby League' },
  { key:'cricket', name:'Cricket' },
  { key:'soccer', name:'Soccer' },
  { key:'basketball', name:'Basketball' },
  { key:'nfl', name:'American Football' },
  { key:'rugby_union', name:'Rugby Union' },
  { key:'tennis', name:'Tennis' },
  { key:'nhl', name:'Ice Hockey' },
];

// Category ids observed in working open-source Neds integrations.
const NEDS_CATEGORIES = [
  { key:'basketball', id:'3c34d075-dc14-436d-bfc4-9272a49c2b39' }, // NBA / basketball
  { key:'nhl', id:'b7c1f944-d02b-4d9b-b6f3-cb31389cfe36' },       // NHL
  { key:'afl', id:'23d497e6-8aab-4309-905b-9421f42c9bc5' },       // AFLW / Aussie rules
  { key:'cricket', id:'94984918-dbac-432b-b420-c219ec9203f4' },   // cricket
  { key:'soccer', id:'71955b54-62f6-4ac5-abaa-df88cad0aeef' },    // EPL
  { key:'baseball', id:'02721435-4671-4cd0-98f7-15d41ee4103e' },  // MLB
];

const ALIASES = new Map([
  ['aussierules_afl','afl'],['rugby_league_nrl','nrl'],['basketball_nba','basketball'],
  ['basketball_ncaab','basketball'],['americanfootball_nfl','nfl'],['icehockey_nhl','nhl'],
  ['soccer_epl','soccer'],['soccer_mls','soccer'],['tennis_atp','tennis'],['tennis_wta','tennis'],
]);

async function getJson(url, extraHeaders = {}, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...BASE_HEADERS, ...extraHeaders },
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).hostname}${text ? `: ${text.slice(0,120)}` : ''}`);
    try { return JSON.parse(text); }
    catch { throw new Error(`Invalid JSON from ${new URL(url).hostname}`); }
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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g, ' ')
    .replace(/\bunited\b/g, 'utd')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function sameTeam(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/\s/g,'') === y.replace(/\s/g,'')) return true;
  if (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  const common = [...A].filter(t => B.has(t)).length;
  return common / Math.max(1, Math.min(A.size, B.size)) >= 0.6;
}

function parseTeams(name) {
  const s = String(name || '').trim();
  for (const sep of [' vs ', ' v ', ' @ ', ' at ']) {
    const re = new RegExp(`\\s${sep.trim()}\\s`, 'i');
    if (!re.test(s)) continue;
    const parts = s.split(re);
    if (parts.length < 2) continue;
    if (['@','at'].includes(sep.trim())) return { home: parts[1].trim(), away: parts[0].trim() };
    return { home: parts[0].trim(), away: parts[1].trim() };
  }
  return null;
}

function decimal(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
}

function roleFor(name, home, away) {
  const n = String(name || '').trim();
  if (sameTeam(n, home)) return 'home';
  if (sameTeam(n, away)) return 'away';
  if (/^(draw|tie)$/i.test(n)) return 'draw';
  return null;
}

function makeEvent({sport, home, away, time, book, selections, source}) {
  const t = iso(time);
  if (!home || !away || !t || parseMs(t) <= Date.now() + FUTURE_BUFFER_MS) return null;
  const offers = [];
  for (const s of selections || []) {
    const odds = decimal(s.odds);
    const role = s.role || roleFor(s.name, home, away);
    if (role && odds) offers.push({ market:'h2h', role, odds, point:null, book });
  }
  if (offers.length < 2) return null;
  return { sport, home, away, time:t, book, offers, source };
}

function classifySport(text) {
  const s = String(text || '').toLowerCase();
  if (/aflw?|australian rules/.test(s)) return 'afl';
  if (/nrl|rugby league/.test(s)) return 'nrl';
  if (/cricket|big bash|ipl/.test(s)) return 'cricket';
  if (/soccer|premier league|epl/.test(s) && !/american/.test(s)) return 'soccer';
  if (/basketball|nba|nbl/.test(s)) return 'basketball';
  if (/american football|nfl|ncaaf/.test(s)) return 'nfl';
  if (/rugby union/.test(s)) return 'rugby_union';
  if (/tennis|atp|wta/.test(s)) return 'tennis';
  if (/ice hockey|nhl/.test(s)) return 'nhl';
  if (/baseball|mlb/.test(s)) return 'baseball';
  return 'other';
}

async function pointsBet() {
  const headers = { 'Origin':'https://pointsbet.com.au', 'Referer':'https://pointsbet.com.au/' };
  const feed = await getJson('https://api.au.pointsbet.com/api/v2/events/nextup?v2Limit=40', headers);
  const rows = Array.isArray(feed?.events) ? feed.events : (Array.isArray(feed) ? feed : []);
  const future = rows
    .filter(e => e && e.key && e.isLive !== true && parseMs(e.startsAt) > Date.now() + FUTURE_BUFFER_MS)
    .slice(0, MAX_DETAIL_EVENTS);

  const details = await Promise.allSettled(future.map(e =>
    getJson(`https://api.au.pointsbet.com/api/mes/v3/events/${encodeURIComponent(e.key)}`, headers, 16000)
      .then(d => ({ head:e, detail:d }))
  ));

  const out = [];
  for (const result of details) {
    if (result.status !== 'fulfilled') continue;
    const { head, detail } = result.value;
    const home = typeof detail?.homeTeam === 'string' ? detail.homeTeam : (detail?.homeTeam?.name || head?.homeTeam?.name || head?.homeTeam);
    const away = typeof detail?.awayTeam === 'string' ? detail.awayTeam : (detail?.awayTeam?.name || head?.awayTeam?.name || head?.awayTeam);
    const teams = home && away ? {home,away} : parseTeams(detail?.name || head?.name);
    if (!teams) continue;
    const markets = Array.isArray(detail?.fixedOddsMarkets) ? detail.fixedOddsMarkets : [];
    const market = markets.find(m => /^(match result|match betting|head to head|moneyline|winner)$/i.test(String(m?.name || '').trim()))
      || markets.find(m => /match result|match betting|head to head|moneyline/i.test(String(m?.name || '')));
    if (!market) continue;
    const selections = (Array.isArray(market.outcomes) ? market.outcomes : [])
      .filter(o => o?.isOpenForBetting !== false)
      .map(o => ({ name:o?.name, odds:o?.price }));
    const item = makeEvent({
      sport: classifySport(`${head?.sportKey || ''} ${head?.competitionName || ''} ${detail?.competitionName || ''}`),
      home:teams.home, away:teams.away,
      time:detail?.startsAt || head?.startsAt,
      book:'PointsBet AU', selections, source:'pointsbet'
    });
    if (item) out.push(item);
  }
  return out;
}

function nedsDecimal(price) {
  if (!price) return null;
  const direct = decimal(price?.decimal || price?.price || price?.returnWin);
  if (direct) return direct;
  const num = Number(price?.odds?.numerator), den = Number(price?.odds?.denominator);
  if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return 1 + num / den;
  return null;
}

async function nedsCategory(meta) {
  const encoded = encodeURIComponent(JSON.stringify([meta.id]));
  const listUrl = `https://api.neds.com.au/v2/sport/event-request?category_ids=${encoded}&include_any_team_vs_any_team_events=true`;
  const headers = { 'Origin':'https://www.neds.com.au', 'Referer':'https://www.neds.com.au/' };
  const list = await getJson(listUrl, headers);
  const values = Array.isArray(list?.events) ? list.events : (list?.events && typeof list.events === 'object' ? Object.values(list.events) : []);
  const future = values
    .filter(e => e?.id && parseMs(e?.start_time || e?.startTime || e?.advertised_start_time) > Date.now() + FUTURE_BUFFER_MS)
    .slice(0, 8);

  const cards = await Promise.allSettled(future.map(e =>
    getJson(`https://api.neds.com.au/v2/sport/event-card?id=${encodeURIComponent(e.id)}`, headers, 14000)
      .then(card => ({ event:e, card }))
  ));

  const out = [];
  for (const result of cards) {
    if (result.status !== 'fulfilled') continue;
    const { event, card } = result.value;
    const teams = parseTeams(event?.name || card?.event?.name || card?.name);
    if (!teams) continue;
    const marketMap = new Map((Array.isArray(card?.markets) ? card.markets : []).map(m => [String(m?.id), String(m?.name || '')]));
    const entrants = Array.isArray(card?.entrants) ? card.entrants : [];
    const prices = Array.isArray(card?.prices) ? card.prices : [];
    const selections = [];
    for (let i = 0; i < entrants.length; i++) {
      const entrant = entrants[i];
      const marketName = marketMap.get(String(entrant?.market_id || entrant?.marketId)) || '';
      if (!/^match betting$/i.test(marketName) && !/head to head|match result|moneyline/i.test(marketName)) continue;
      const odds = nedsDecimal(prices[i] || entrant?.price);
      if (odds) selections.push({ name:entrant?.name, odds });
    }
    const item = makeEvent({
      sport:meta.key,
      home:teams.home, away:teams.away,
      time:event?.start_time || event?.startTime || card?.event?.start_time || card?.start_time,
      book:'Neds', selections, source:'neds'
    });
    if (item) out.push(item);
  }
  return out;
}

async function neds(sport) {
  const metas = sport ? NEDS_CATEGORIES.filter(x => x.key === sport) : NEDS_CATEGORIES;
  const settled = await Promise.allSettled(metas.map(nedsCategory));
  const events = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const errors = settled.filter(r => r.status === 'rejected').map((r,i) => String(r.reason?.message || r.reason));
  return { events, errors };
}

async function tabSport(meta) {
  const headers = {
    'Origin':'https://www.tab.com.au', 'Referer':'https://www.tab.com.au/',
    'sec-ch-ua':'"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile':'?0', 'sec-ch-ua-platform':'"macOS"',
    'sec-fetch-dest':'empty', 'sec-fetch-mode':'cors', 'sec-fetch-site':'same-site',
  };
  const sportName = encodeURIComponent(meta.name);
  const url = `https://api.beta.tab.com.au/v1/tab-info-service/sports/${sportName}/matches?jurisdiction=NSW&returnOffers=true&limit=40&openOnly=true`;
  const data = await getJson(url, headers, 18000);
  const rows = Array.isArray(data?.matches) ? data.matches : [];
  const out = [];
  for (const ev of rows) {
    if (ev?.isLive === true || ev?.inPlay === true) continue;
    const teams = parseTeams(ev?.name);
    if (!teams) continue;
    const markets = Array.isArray(ev?.markets) ? ev.markets : [];
    const m = markets.find(x => /head to head|match betting|match odds|moneyline|result/i.test(String(x?.name || x?.betOption || ''))) || markets[0];
    const contestants = Array.isArray(m?.contestants) ? m.contestants : (Array.isArray(m?.selections) ? m.selections : []);
    const selections = contestants.map(c => ({ name:c?.name || c?.runnerName, odds:c?.returnWin ?? c?.winOdds ?? c?.price }));
    const item = makeEvent({ sport:meta.key, home:teams.home, away:teams.away, time:ev?.startTime, book:'TAB', selections, source:'tab' });
    if (item) out.push(item);
  }
  return out;
}

async function tab(sport) {
  const metas = sport ? TAB_SPORTS.filter(x => x.key === sport) : TAB_SPORTS;
  const settled = await Promise.allSettled(metas.map(tabSport));
  const events = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const errors = settled.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));
  return { events, errors };
}

function findBucket(buckets, event) {
  const t = parseMs(event.time);
  return buckets.find(b => Math.abs(parseMs(b.time) - t) <= 90 * 60 * 1000 && (
    (sameTeam(b.home,event.home) && sameTeam(b.away,event.away)) ||
    (sameTeam(b.home,event.away) && sameTeam(b.away,event.home))
  ));
}

function merge(events) {
  const buckets = [];
  for (const e of events) {
    let b = findBucket(buckets, e);
    if (!b) {
      b = { sport:e.sport, home:e.home, away:e.away, time:e.time, offers:[], books:new Set() };
      buckets.push(b);
    }
    b.books.add(e.book);
    const reversed = sameTeam(e.home,b.away) && sameTeam(e.away,b.home);
    for (const offer of e.offers) {
      let role = offer.role;
      if (reversed && (role === 'home' || role === 'away')) role = role === 'home' ? 'away' : 'home';
      b.offers.push({ ...offer, role });
    }
  }
  return buckets;
}

function arb(bucket) {
  const best = {};
  for (const o of bucket.offers) if (!best[o.role] || o.odds > best[o.role].odds) best[o.role] = o;
  const roles = bucket.offers.some(o => o.role === 'draw') ? ['home','draw','away'] : ['home','away'];
  if (roles.some(r => !best[r])) return null;
  const selections = roles.map(r => ({
    name:r === 'home' ? bucket.home : r === 'away' ? bucket.away : 'Draw',
    point:null, best_price:Number(best[r].odds), best_bookmaker:best[r].book,
  }));
  if (new Set(selections.map(x => x.best_bookmaker)).size < 2) return null;
  const inverse = selections.reduce((sum,x) => sum + 1 / x.best_price, 0);
  if (!Number.isFinite(inverse) || inverse >= 1) return null;
  const roi = (1 / inverse - 1) * 100;
  return {
    event_id:`${norm(bucket.home).replace(/\s/g,'')}-${norm(bucket.away).replace(/\s/g,'')}-${Math.round(parseMs(bucket.time)/60000)}`,
    sport_key:bucket.sport,
    home_team:bucket.home,
    away_team:bucket.away,
    commence_time:bucket.time,
    market_type:'h2h',
    source_type:ENGINE,
    is_arb:true,
    arb_pct:Number(roi.toFixed(3)),
    selections,
    optimal_stakes:selections.map(x => ({
      name:x.name, point:null, price:x.best_price, bookmaker:x.best_bookmaker,
      stake:((1 / x.best_price) / inverse) * 100,
    })),
  };
}

export default async function handler(req,res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }

  const rawSport = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim().toLowerCase() : '';
  const sport = ALIASES.get(rawSport) || rawSport;
  const mode = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const debug = String(req.query.debug || '') === '1';
  if (!['all','h2h','lines','spreads','totals'].includes(mode)) return res.status(400).json({error:'Unsupported market_mode'});
  if (!['all','h2h'].includes(mode) && !debug) return res.status(200).json([]);

  const providerRuns = [
    ['PointsBet AU', async () => ({ events:await pointsBet(), errors:[] })],
    ['Neds', async () => neds(sport)],
    ['TAB', async () => tab(sport)],
  ];

  const settled = await Promise.allSettled(providerRuns.map(x => x[1]()));
  const providers = [];
  let raw = [];
  settled.forEach((r,i) => {
    const name = providerRuns[i][0];
    if (r.status === 'fulfilled') {
      const value = r.value || {events:[],errors:[]};
      providers.push({provider:name,ok:true,events:value.events?.length || 0,errors:value.errors || []});
      raw.push(...(value.events || []));
    } else {
      providers.push({provider:name,ok:false,events:0,errors:[String(r.reason?.message || r.reason).slice(0,300)]});
    }
  });

  if (sport) raw = raw.filter(e => e.sport === sport);
  const merged = merge(raw).filter(b => parseMs(b.time) > Date.now() + FUTURE_BUFFER_MS);
  const arbs = merged.map(arb).filter(Boolean)
    .sort((a,b) => Number(b.arb_pct) - Number(a.arb_pct) || parseMs(a.commence_time) - parseMs(b.commence_time))
    .slice(0,100);

  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Odds-Engine',ENGINE);
  res.setHeader('X-Game-Count',String(merged.length));
  res.setHeader('X-Cross-Book-Games',String(merged.filter(b => b.books.size >= 2).length));
  res.setHeader('X-Arb-Count',String(arbs.length));

  if (debug) {
    return res.status(200).json({
      engine:ENGINE,
      australian_books:['PointsBet AU','Neds','TAB'],
      future_buffer_minutes:FUTURE_BUFFER_MS/60000,
      providers,
      raw_events:raw.length,
      merged_games:merged.length,
      cross_book_games:merged.filter(b => b.books.size >= 2).length,
      arbs:arbs.length,
      sample_games:merged.slice(0,12).map(b => ({sport:b.sport,home:b.home,away:b.away,time:b.time,books:[...b.books]})),
    });
  }

  return res.status(200).json(arbs);
}
