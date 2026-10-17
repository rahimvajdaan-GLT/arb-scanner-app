const ENGINE = 'open-books-v3';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;

const SPORTS = {
  nfl:{p:889,d:88808}, ncaaf:{p:880,d:87637},
  nba:{p:487,d:42648,b:3}, ncaab:{p:493,d:92483,b:3},
  mlb:{p:246,d:84240}, nhl:{p:1456,d:42133,b:2},
  ufc:{p:8676,d:9034}, boxing:{p:1424,d:9033},
  soccer_epl:{p:1980,d:40253,b:1}, soccer_laliga:{p:2196,d:40031,b:1},
  soccer_bundesliga:{p:1842,d:40029,b:1}, soccer_seriea:{p:2436,d:40030,b:1},
  soccer_ligue1:{p:2036,d:40032,b:1}, soccer_mls:{p:2143,d:40828,b:1},
  soccer_uefa_champs_league:{p:2627,d:40685,b:1},
  soccer_uefa_europa_league:{p:2630,d:40688,b:1},
  tennis_atp:{p:2417,d:39992,b:4}, tennis_wta:{p:2421,d:39993,b:4},
};

const DEFAULT_SPORTS = [
  'nfl','ncaaf','nba','ncaab','nhl','mlb',
  'soccer_epl','soccer_laliga','soccer_bundesliga','soccer_seriea',
  'soccer_ligue1','soccer_uefa_champs_league','tennis_atp','tennis_wta'
];

const PIN = 'https://guest.api.arcadia.pinnacle.com/0.1';
const DK = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5';
const LB = 'https://linebet.com/service-api/LineFeed/Get1x2_VZip';
const BASE_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
};
const PIN_HEADERS = {
  ...BASE_HEADERS,
  'X-API-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
  Referer: 'https://www.pinnacle.com/',
  Origin: 'https://www.pinnacle.com',
};
const LB_HEADERS = {
  ...BASE_HEADERS,
  Referer: 'https://linebet.com/en/line/football',
  Origin: 'https://linebet.com',
  'x-svc-source': '__BETTING_APP__',
  'x-app-n': '__BETTING_APP__',
  'x-requested-with': 'XMLHttpRequest',
  'is-srv': 'false',
};

async function json(url, headers = BASE_HEADERS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow', cache: 'no-store' });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).hostname}`);
    try { return JSON.parse(body); }
    catch { throw new Error(`Invalid JSON from ${new URL(url).hostname}`); }
  } finally {
    clearTimeout(timer);
  }
}

function ms(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const raw = String(value || '').trim();
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function iso(value) { const t = ms(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function american(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function norm(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g, ' ').replace(/\bunited\b/g, 'utd')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function same(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/\s/g, '') === y.replace(/\s/g, '')) return true;
  if (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  return [...A].filter(t => B.has(t)).length / Math.max(A.size, B.size, 1) >= 0.6;
}
function team(value) { return typeof value === 'string' ? value : (value?.N || value?.name || ''); }
function fullPeriod(sport, period) {
  const p = Number(period);
  return ['nba','ncaab'].includes(sport) ? (p === 0 || p === 3) : p === 0;
}
function marketAllowed(market, mode) {
  if (mode === 'all') return ['h2h','spreads','totals'].includes(market);
  if (mode === 'lines') return ['spreads','totals'].includes(market);
  return market === mode;
}

function addOffer(out, market, role, odds, book, point = null) {
  if (!role || !Number.isFinite(Number(odds)) || Number(odds) <= 1) return;
  out.push({ market, role, odds: Number(odds), book, point: point == null ? null : Number(point) });
}

async function pinnacle(sport, id, mode) {
  if (!id) return [];
  const [matches, markets] = await Promise.all([
    json(`${PIN}/leagues/${id}/matchups?brandId=0`, PIN_HEADERS),
    json(`${PIN}/leagues/${id}/markets/straight?primaryOnly=false`, PIN_HEADERS),
  ]);
  if (!Array.isArray(matches) || !Array.isArray(markets)) return [];

  const byMatchup = new Map();
  for (const market of markets) {
    if (!fullPeriod(sport, market?.period)) continue;
    const type = String(market?.type || '').toLowerCase();
    const mapped = type === 'moneyline' ? 'h2h' : type === 'spread' ? 'spreads' : type === 'total' ? 'totals' : null;
    if (!mapped || !marketAllowed(mapped, mode)) continue;
    if (!byMatchup.has(market.matchupId)) byMatchup.set(market.matchupId, []);
    byMatchup.get(market.matchupId).push({ ...market, _mapped: mapped });
  }

  const out = [];
  for (const match of matches) {
    if (!match || match.parent || match.type === 'special') continue;
    const home = match.participants?.find(x => x?.alignment === 'home')?.name;
    const away = match.participants?.find(x => x?.alignment === 'away')?.name;
    const time = iso(match.startTime);
    if (!home || !away || !time) continue;

    const offers = [];
    for (const market of byMatchup.get(match.id) || []) {
      for (const price of market.prices || []) {
        const odds = american(price?.price);
        if (!odds) continue;
        const d = String(price?.designation || '').toLowerCase();
        let role = null;
        if (market._mapped === 'h2h' || market._mapped === 'spreads') {
          role = d === 'home' ? 'home' : d === 'away' ? 'away' : (d === 'draw' || d === 'tie') ? 'draw' : null;
        } else if (market._mapped === 'totals') {
          role = d === 'over' ? 'over' : d === 'under' ? 'under' : null;
        }
        addOffer(offers, market._mapped, role, odds, 'Pinnacle', price?.points ?? null);
      }
    }
    if (offers.length >= 2) out.push({ sport, home, away, time, book: 'Pinnacle', offers });
  }
  return out;
}

function dkMarketKind(label, categoryName) {
  const s = `${label || ''} ${categoryName || ''}`.toLowerCase();
  if (/first half|1st half|quarter|period|set |team total|player/.test(s)) return null;
  if (/spread|run line|puck line|handicap/.test(s)) return 'spreads';
  if (/game total|total|over\/under|over under/.test(s)) return 'totals';
  if (/moneyline|money line|match winner|3-way|3 way|winner|to win/.test(s)) return 'h2h';
  return null;
}

async function draftkings(sport, id, mode) {
  if (!id) return [];
  const data = await json(`${DK}/eventgroups/${id}?format=json`);
  const root = data?.eventGroup || data;
  const events = root?.events || [];
  const categories = root?.offerCategories || [];
  const offersByEvent = new Map();

  for (const cat of categories) {
    for (const desc of cat?.offerSubcategoryDescriptors || []) {
      for (const list of desc?.offerSubcategory?.offers || []) {
        for (const offer of Array.isArray(list) ? list : []) {
          if (!offer?.eventId) continue;
          const market = dkMarketKind(offer?.label, cat?.name);
          if (!market || !marketAllowed(market, mode)) continue;
          if (!offersByEvent.has(offer.eventId)) offersByEvent.set(offer.eventId, []);
          offersByEvent.get(offer.eventId).push({ ...offer, _market: market });
        }
      }
    }
  }

  const out = [];
  for (const event of events) {
    const home = event?.teamName1 || event?.team1;
    const away = event?.teamName2 || event?.team2;
    const time = iso(event?.startDate);
    if (!home || !away || !time) continue;

    const offers = [];
    for (const market of offersByEvent.get(event.eventId) || []) {
      for (const outcome of market?.outcomes || []) {
        const odds = Number(outcome?.oddsDecimal);
        if (!Number.isFinite(odds) || odds <= 1) continue;
        const name = String(outcome?.label || outcome?.participant || '');
        let role = null;
        if (market._market === 'h2h' || market._market === 'spreads') {
          role = same(name, home) ? 'home' : same(name, away) ? 'away' : /^(draw|tie)$/i.test(name) ? 'draw' : null;
        } else if (market._market === 'totals') {
          role = /^over\b/i.test(name) ? 'over' : /^under\b/i.test(name) ? 'under' : null;
        }
        addOffer(offers, market._market, role, odds, 'DraftKings', outcome?.line ?? null);
      }
    }
    if (offers.length >= 2) out.push({ sport, home, away, time, book: 'DraftKings', offers });
  }
  return out;
}

async function linebet(sport, id, mode) {
  if (!id || !marketAllowed('h2h', mode)) return [];
  const q = new URLSearchParams({ count:'100', lng:'en', mode:'4', country:'87', partner:'189', gr:'650', sports:String(id), virtualSports:'false', noFilterBlockEvent:'true' });
  const data = await json(`${LB}?${q}`, LB_HEADERS);
  const rows = Array.isArray(data?.Value) ? data.Value : [];
  const out = [];
  for (const event of rows) {
    const home = team(event?.O1), away = team(event?.O2), time = iso(event?.S);
    if (!home || !away || !time) continue;
    const offers = [];
    for (const price of event?.E || []) {
      if (Number(price?.G) !== 1) continue;
      const type = Number(price?.T), odds = Number(price?.C ?? price?.P);
      const role = type === 1 ? 'home' : type === 2 ? 'draw' : type === 3 ? 'away' : null;
      addOffer(offers, 'h2h', role, odds, 'Linebet', null);
    }
    if (offers.length >= 2) out.push({ sport, home, away, time, book:'Linebet', offers });
  }
  return out;
}

function findBucket(buckets, event) {
  const eventTime = ms(event.time);
  return buckets.find(bucket => bucket.sport === event.sport && Math.abs(ms(bucket.time) - eventTime) <= 45 * 60 * 1000 && (
    (same(bucket.home, event.home) && same(bucket.away, event.away)) ||
    (same(bucket.home, event.away) && same(bucket.away, event.home))
  ));
}

function merge(events) {
  const buckets = [];
  for (const event of events) {
    let bucket = findBucket(buckets, event);
    if (!bucket) {
      bucket = { sport:event.sport, home:event.home, away:event.away, time:event.time, offers:[], books:new Set() };
      buckets.push(bucket);
    }
    bucket.books.add(event.book);
    const reversed = same(event.home, bucket.away) && same(event.away, bucket.home);
    for (const offer of event.offers) {
      let role = offer.role;
      let point = offer.point;
      if (reversed && (role === 'home' || role === 'away')) {
        role = role === 'home' ? 'away' : 'home';
        if (offer.market === 'spreads' && Number.isFinite(point)) point = -point;
      }
      bucket.offers.push({ ...offer, role, point });
    }
  }
  return buckets;
}

function marketLines(bucket, market) {
  if (market === 'h2h') return [{ key:'h2h', offers:bucket.offers.filter(x => x.market === 'h2h') }];
  const groups = new Map();
  for (const offer of bucket.offers.filter(x => x.market === market)) {
    if (!Number.isFinite(offer.point)) continue;
    const line = market === 'spreads' ? Math.abs(offer.point) : offer.point;
    const key = Number(line).toFixed(4);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }
  return [...groups.entries()].map(([key, offers]) => ({ key, offers }));
}

function buildArb(bucket, market, lineOffers) {
  const best = {};
  for (const offer of lineOffers) {
    if (!best[offer.role] || offer.odds > best[offer.role].odds) best[offer.role] = offer;
  }

  let roles;
  if (market === 'totals') roles = ['over','under'];
  else if (market === 'spreads') roles = ['home','away'];
  else roles = lineOffers.some(x => x.role === 'draw') ? ['home','draw','away'] : ['home','away'];
  if (roles.some(role => !best[role])) return null;

  const picks = roles.map(role => {
    const pick = best[role];
    const name = role === 'home' ? bucket.home : role === 'away' ? bucket.away : role === 'draw' ? 'Draw' : role === 'over' ? 'Over' : 'Under';
    return {
      name,
      point: pick.point,
      best_price: Number(pick.odds),
      best_bookmaker: pick.book,
    };
  });

  if (new Set(picks.map(x => x.best_bookmaker)).size < 2) return null;
  const inverse = picks.reduce((sum, pick) => sum + 1 / pick.best_price, 0);
  if (!Number.isFinite(inverse) || inverse >= 1) return null;

  const roi = (1 / inverse - 1) * 100;
  const lineTag = market === 'h2h' ? '' : `-${lineOffers[0]?.point ?? ''}`;
  return {
    event_id: `${bucket.sport}-${norm(bucket.home).replace(/\s/g,'')}-${norm(bucket.away).replace(/\s/g,'')}-${market}${lineTag}-${Math.round(ms(bucket.time)/60000)}`,
    sport_key: bucket.sport,
    home_team: bucket.home,
    away_team: bucket.away,
    commence_time: bucket.time,
    market_type: market,
    source_type: ENGINE,
    is_arb: true,
    arb_pct: Number(roi.toFixed(3)),
    selections: picks,
    optimal_stakes: picks.map(pick => ({
      name: pick.name,
      point: pick.point,
      price: pick.best_price,
      bookmaker: pick.best_bookmaker,
      stake: ((1 / pick.best_price) / inverse) * 100,
    })),
  };
}

function arbsForBucket(bucket, mode) {
  const markets = mode === 'all' ? ['h2h','spreads','totals'] : mode === 'lines' ? ['spreads','totals'] : [mode];
  const out = [];
  for (const market of markets) {
    for (const line of marketLines(bucket, market)) {
      const found = buildArb(bucket, market, line.offers);
      if (found) out.push(found);
    }
  }
  return out;
}

async function scan(key, mode, diagnostics = false) {
  const config = SPORTS[key];
  if (!config) return diagnostics ? { events:[], providers:[] } : [];
  const defs = [
    ['Pinnacle', () => pinnacle(key, config.p, mode)],
    ['DraftKings', () => draftkings(key, config.d, mode)],
    ...(config.b ? [['Linebet', () => linebet(key, config.b, mode)]] : []),
  ];
  const settled = await Promise.allSettled(defs.map(x => x[1]()));
  const providers = settled.map((result, index) => ({
    provider: defs[index][0],
    ok: result.status === 'fulfilled',
    events: result.status === 'fulfilled' ? result.value.length : 0,
    error: result.status === 'rejected' ? String(result.reason?.message || result.reason).slice(0,220) : null,
  }));
  const events = settled.filter(x => x.status === 'fulfilled').flatMap(x => x.value);
  return diagnostics ? { events, providers } : events;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ error:'Method not allowed' });
  }

  const sport = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim() : '';
  const modeRaw = typeof req.query.market_mode === 'string' ? req.query.market_mode.toLowerCase() : 'all';
  const mode = ['all','h2h','lines','spreads','totals'].includes(modeRaw) ? modeRaw : 'all';
  const debug = String(req.query.debug || '') === '1';
  if (sport && !SPORTS[sport]) return res.status(400).json({ error:`Unsupported sport_key: ${sport}` });

  try {
    const keys = sport ? [sport] : DEFAULT_SPORTS;
    if (debug) {
      const sample = sport ? keys : keys.slice(0,6);
      const scans = await Promise.all(sample.map(key => scan(key, mode, true)));
      const details = sample.map((key,index) => {
        const events = scans[index].events;
        const merged = merge(events).filter(x => ms(x.time) > Date.now() + FUTURE_BUFFER_MS);
        const arbs = merged.flatMap(bucket => arbsForBucket(bucket, mode));
        return { sport_key:key, providers:scans[index].providers, total_events:events.length, merged_events:merged.length, arbs:arbs.length };
      });
      return res.status(200).json({ engine:ENGINE, future_buffer_minutes:FUTURE_BUFFER_MS/60000, sports:details });
    }

    const groups = await Promise.all(keys.map(key => scan(key, mode, false)));
    const merged = merge(groups.flat()).filter(bucket => ms(bucket.time) > Date.now() + FUTURE_BUFFER_MS);
    const arbs = merged
      .flatMap(bucket => arbsForBucket(bucket, mode))
      .sort((a,b) => Number(b.arb_pct) - Number(a.arb_pct) || ms(a.commence_time) - ms(b.commence_time))
      .slice(0,75);

    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Odds-Engine',ENGINE);
    res.setHeader('X-Odds-Providers','Pinnacle,DraftKings,Linebet');
    res.setHeader('X-Merged-Events',String(merged.filter(x => x.books?.size >= 2).length));
    res.setHeader('X-Arb-Count',String(arbs.length));
    return res.status(200).json(arbs);
  } catch (error) {
    return res.status(500).json({ error:'Open odds scan failed', detail:error?.message || String(error), engine:ENGINE });
  }
}
