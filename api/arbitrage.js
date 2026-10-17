const ENGINE = 'open-multibook-v5';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
const ACTION_BASE = 'https://api.actionnetwork.com/web';

const SPORTS = {
  nfl: { slug: 'nfl', days: 7 },
  ncaaf: { slug: 'ncaaf', days: 7 },
  nba: { slug: 'nba', days: 5 },
  ncaab: { slug: 'ncaab', days: 5 },
  nhl: { slug: 'nhl', days: 5 },
  mlb: { slug: 'mlb', days: 4 },
  soccer: { slug: 'soccer', days: 4 },
  soccer_epl: { slug: 'epl', days: 5 },
  soccer_mls: { slug: 'mls', days: 5 },
};

// Avoid duplicate EPL/MLS games in the default scan because the generic soccer
// endpoint already contains those leagues.
const DEFAULT_SPORTS = ['nfl','ncaaf','nba','ncaab','nhl','mlb','soccer'];
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
};

let booksCache = null;
let booksCacheAt = 0;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
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
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toIso(value) {
  const t = parseMs(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function americanToDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return n / 100 + 1;
  return 100 / Math.abs(n) + 1;
}

function toDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Action Network currently returns American prices. This decimal check also
  // keeps the adapter tolerant if a future response already contains decimal odds.
  if (n > 1 && n < 20) return n;
  return americanToDecimal(n);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g, ' ')
    .replace(/\bunited\b/g, 'utd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sameTeam(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/\s/g, '') === y.replace(/\s/g, '')) return true;
  if (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(x.split(' '));
  const B = new Set(y.split(' '));
  const common = [...A].filter(token => B.has(token)).length;
  return common / Math.max(A.size, B.size, 1) >= 0.6;
}

function dateKey(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function marketAllowed(market, mode) {
  if (mode === 'all') return ['h2h', 'spreads', 'totals'].includes(market);
  if (mode === 'lines') return ['spreads', 'totals'].includes(market);
  return market === mode;
}

function addOffer(target, market, role, rawOdds, book, point = null) {
  const odds = toDecimal(rawOdds);
  const numericPoint = point == null ? null : Number(point);
  if (!role || !Number.isFinite(odds) || odds <= 1) return;
  target.push({
    market,
    role,
    odds,
    book,
    point: Number.isFinite(numericPoint) ? numericPoint : null,
  });
}

async function loadBooks() {
  if (booksCache && Date.now() - booksCacheAt < 15 * 60 * 1000) return booksCache;

  const fallback = new Map([
    ['68', 'DraftKings'],
    ['69', 'FanDuel'],
    ['71', 'BetRivers'],
    ['75', 'BetMGM'],
    ['49', 'Caesars'],
  ]);

  try {
    const payload = await getJson(`${ACTION_BASE}/v1/books`);
    const map = new Map();
    for (const book of payload?.books || []) {
      const id = String(book?.id ?? '');
      const name = String(book?.display_name || book?.name || '').trim();
      if (id && name) map.set(id, name);
    }
    booksCache = map.size ? map : fallback;
  } catch (_) {
    booksCache = fallback;
  }

  booksCacheAt = Date.now();
  return booksCache;
}

function isRealBook(bookId, bookName) {
  const id = String(bookId);
  const name = String(bookName || '').toLowerCase();
  // Action Network uses 15 for Consensus and 30 for Open; neither represents
  // a place where the user can actually place a bet.
  if (id === '15' || id === '30') return false;
  if (!bookName || /consensus|\bopen\b/.test(name)) return false;
  return true;
}

function entriesForSide(entries, side) {
  return (Array.isArray(entries) ? entries : []).filter(entry =>
    String(entry?.side || '').toLowerCase() === side &&
    (entry?.period == null || entry?.period === 'event')
  );
}

async function actionNetworkSport(sportKey, config, mode) {
  const books = await loadBooks();
  const dates = Array.from({ length: config.days + 1 }, (_, i) => dateKey(i));
  const responses = await Promise.allSettled(
    dates.map(date => getJson(`${ACTION_BASE}/v2/scoreboard/${encodeURIComponent(config.slug)}?date=${date}`))
  );

  const games = responses
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => Array.isArray(result.value?.games) ? result.value.games : []);

  const output = [];
  const seenBookGames = new Set();

  for (const game of games) {
    const start = toIso(game?.start_time);
    if (!start || parseMs(start) <= Date.now() + FUTURE_BUFFER_MS) continue;

    const teams = new Map((game?.teams || []).map(team => [String(team?.id), team]));
    const homeObj = teams.get(String(game?.home_team_id)) || {};
    const awayObj = teams.get(String(game?.away_team_id)) || {};
    const home = homeObj.full_name || homeObj.name || homeObj.display_name;
    const away = awayObj.full_name || awayObj.name || awayObj.display_name;
    if (!home || !away) continue;

    for (const [bookId, wrappedMarket] of Object.entries(game?.markets || {})) {
      const book = books.get(String(bookId));
      if (!isRealBook(bookId, book)) continue;

      const unique = `${game?.id || `${home}-${away}-${start}`}|${bookId}`;
      if (seenBookGames.has(unique)) continue;
      seenBookGames.add(unique);

      const event = wrappedMarket?.event || wrappedMarket || {};
      const offers = [];

      if (marketAllowed('h2h', mode)) {
        for (const row of entriesForSide(event?.moneyline, 'home')) addOffer(offers, 'h2h', 'home', row?.odds, book);
        for (const row of entriesForSide(event?.moneyline, 'away')) addOffer(offers, 'h2h', 'away', row?.odds, book);
        for (const row of entriesForSide(event?.moneyline, 'draw')) addOffer(offers, 'h2h', 'draw', row?.odds, book);
      }

      if (marketAllowed('spreads', mode)) {
        for (const row of entriesForSide(event?.spread, 'home')) addOffer(offers, 'spreads', 'home', row?.odds, book, row?.value);
        for (const row of entriesForSide(event?.spread, 'away')) addOffer(offers, 'spreads', 'away', row?.odds, book, row?.value);
      }

      if (marketAllowed('totals', mode)) {
        for (const row of entriesForSide(event?.total, 'over')) addOffer(offers, 'totals', 'over', row?.odds, book, row?.value);
        for (const row of entriesForSide(event?.total, 'under')) addOffer(offers, 'totals', 'under', row?.odds, book, row?.value);
      }

      if (offers.length >= 2) {
        output.push({ sport: sportKey, home, away, time: start, book, offers });
      }
    }
  }

  return output;
}

function findBucket(buckets, event) {
  const eventTime = parseMs(event.time);
  return buckets.find(bucket =>
    bucket.sport === event.sport &&
    Math.abs(parseMs(bucket.time) - eventTime) <= 45 * 60 * 1000 &&
    (
      (sameTeam(bucket.home, event.home) && sameTeam(bucket.away, event.away)) ||
      (sameTeam(bucket.home, event.away) && sameTeam(bucket.away, event.home))
    )
  );
}

function mergeEvents(events) {
  const buckets = [];
  for (const event of events) {
    let bucket = findBucket(buckets, event);
    if (!bucket) {
      bucket = {
        sport: event.sport,
        home: event.home,
        away: event.away,
        time: event.time,
        offers: [],
        books: new Set(),
      };
      buckets.push(bucket);
    }

    bucket.books.add(event.book);
    const reversed = sameTeam(event.home, bucket.away) && sameTeam(event.away, bucket.home);

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
  if (market === 'h2h') {
    return [{ offers: bucket.offers.filter(offer => offer.market === 'h2h') }];
  }

  const groups = new Map();
  for (const offer of bucket.offers.filter(item => item.market === market)) {
    if (!Number.isFinite(offer.point)) continue;
    const line = market === 'spreads' ? Math.abs(offer.point) : offer.point;
    const key = Number(line).toFixed(4);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }
  return [...groups.values()].map(offers => ({ offers }));
}

function makeArb(bucket, market, offers) {
  const best = {};
  for (const offer of offers) {
    if (!best[offer.role] || offer.odds > best[offer.role].odds) best[offer.role] = offer;
  }

  let roles;
  if (market === 'totals') roles = ['over', 'under'];
  else if (market === 'spreads') roles = ['home', 'away'];
  else roles = offers.some(offer => offer.role === 'draw') ? ['home', 'draw', 'away'] : ['home', 'away'];

  if (roles.some(role => !best[role])) return null;

  const selections = roles.map(role => {
    const pick = best[role];
    return {
      name: role === 'home' ? bucket.home : role === 'away' ? bucket.away : role === 'draw' ? 'Draw' : role === 'over' ? 'Over' : 'Under',
      point: pick.point,
      best_price: Number(pick.odds),
      best_bookmaker: pick.book,
    };
  });

  if (new Set(selections.map(selection => selection.best_bookmaker)).size < 2) return null;

  const inverseSum = selections.reduce((sum, selection) => sum + 1 / selection.best_price, 0);
  if (!Number.isFinite(inverseSum) || inverseSum >= 1) return null;

  const roi = (1 / inverseSum - 1) * 100;
  return {
    event_id: `${bucket.sport}-${normalizeName(bucket.home).replace(/\s/g, '')}-${normalizeName(bucket.away).replace(/\s/g, '')}-${market}-${Math.round(parseMs(bucket.time) / 60000)}`,
    sport_key: bucket.sport,
    home_team: bucket.home,
    away_team: bucket.away,
    commence_time: bucket.time,
    market_type: market,
    source_type: ENGINE,
    is_arb: true,
    arb_pct: Number(roi.toFixed(3)),
    selections,
    optimal_stakes: selections.map(selection => ({
      name: selection.name,
      point: selection.point,
      price: selection.best_price,
      bookmaker: selection.best_bookmaker,
      stake: ((1 / selection.best_price) / inverseSum) * 100,
    })),
  };
}

function arbsForBucket(bucket, mode) {
  const markets = mode === 'all' ? ['h2h', 'spreads', 'totals'] : mode === 'lines' ? ['spreads', 'totals'] : [mode];
  const output = [];
  for (const market of markets) {
    for (const line of marketLines(bucket, market)) {
      const opportunity = makeArb(bucket, market, line.offers);
      if (opportunity) output.push(opportunity);
    }
  }
  return output;
}

async function scanSport(key, mode, diagnostic = false) {
  const config = SPORTS[key];
  if (!config) return diagnostic ? { events: [], error: 'Unsupported sport' } : [];
  try {
    const events = await actionNetworkSport(key, config, mode);
    return diagnostic ? { events, error: null } : events;
  } catch (error) {
    return diagnostic ? { events: [], error: String(error?.message || error) } : [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sport = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim() : '';
  const rawMode = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const mode = ['all', 'h2h', 'lines', 'spreads', 'totals'].includes(rawMode) ? rawMode : 'all';
  const debug = String(req.query.debug || '') === '1';

  if (sport && !SPORTS[sport]) return res.status(400).json({ error: `Unsupported sport_key: ${sport}` });

  const keys = sport ? [sport] : DEFAULT_SPORTS;

  try {
    if (debug) {
      const scans = await Promise.all(keys.map(key => scanSport(key, mode, true)));
      const details = keys.map((key, index) => {
        const events = scans[index].events;
        const merged = mergeEvents(events).filter(bucket => parseMs(bucket.time) > Date.now() + FUTURE_BUFFER_MS);
        const arbs = merged.flatMap(bucket => arbsForBucket(bucket, mode));
        return {
          sport_key: key,
          provider: 'ActionNetwork',
          provider_ok: !scans[index].error,
          error: scans[index].error,
          bookmaker_rows: events.length,
          games: merged.length,
          cross_book_games: merged.filter(bucket => bucket.books.size >= 2).length,
          bookmakers: [...new Set(events.map(event => event.book))].sort(),
          arbs: arbs.length,
        };
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ engine: ENGINE, future_buffer_minutes: FUTURE_BUFFER_MS / 60000, sports: details });
    }

    const groups = await Promise.all(keys.map(key => scanSport(key, mode, false)));
    const merged = mergeEvents(groups.flat()).filter(bucket => parseMs(bucket.time) > Date.now() + FUTURE_BUFFER_MS);
    const arbs = merged
      .flatMap(bucket => arbsForBucket(bucket, mode))
      .sort((a, b) => Number(b.arb_pct) - Number(a.arb_pct) || parseMs(a.commence_time) - parseMs(b.commence_time))
      .slice(0, 100);

    const bookCount = new Set(groups.flat().map(event => event.book)).size;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Odds-Engine', ENGINE);
    res.setHeader('X-Bookmaker-Count', String(bookCount));
    res.setHeader('X-Cross-Book-Games', String(merged.filter(bucket => bucket.books.size >= 2).length));
    res.setHeader('X-Arb-Count', String(arbs.length));
    return res.status(200).json(arbs);
  } catch (error) {
    return res.status(500).json({
      error: 'Open multi-book scan failed',
      detail: error?.message || String(error),
      engine: ENGINE,
    });
  }
}
