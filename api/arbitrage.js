const ENGINE = 'action-network-v7';
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
const ACTION_BASE = 'https://api.actionnetwork.com/web/v2/scoreboard';

const BOOKS = new Map([
  [68, 'DraftKings'],
  [69, 'FanDuel'],
  [75, 'BetMGM'],
  [123, 'Caesars'],
  [71, 'BetRivers'],
  [79, 'bet365'],
]);
const BOOK_IDS = [...BOOKS.keys()];
const REQUEST_BOOK_IDS = [...BOOK_IDS, 15]; // 15 = consensus, requested only as a fallback reference

const SPORTS = {
  nfl: { slug:'nfl', weekly:true },
  ncaaf: { slug:'ncaaf', weekly:true },
  nba: { slug:'nba', days:7 },
  ncaab: { slug:'ncaab', days:7 },
  wnba: { slug:'wnba', days:7 },
  nhl: { slug:'nhl', days:7 },
  mlb: { slug:'mlb', days:7 },
};
const DEFAULT_SPORTS = ['nba','ncaab','nhl','mlb','nfl','ncaaf','wnba'];

const HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept':'application/json',
  'Referer':'https://www.actionnetwork.com/',
};

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers:HEADERS, signal:controller.signal, redirect:'follow', cache:'no-store' });
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

function toDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 1 && n < 20) return n;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

function ctDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const s = d.toLocaleDateString('en-US', { timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit' });
  const [m, day, y] = s.split('/');
  return `${y}${m}${day}`;
}

function mainLine(list, side) {
  const rows = (Array.isArray(list) ? list : []).filter(row =>
    String(row?.side || '').toLowerCase() === side &&
    !row?.is_alt_market &&
    (row?.period == null || row?.period === 'event')
  );
  return rows.find(row => !row?.is_live) || null;
}

function teamName(game, side) {
  const id = String(side === 'home' ? game?.home_team_id : game?.away_team_id);
  const team = (Array.isArray(game?.teams) ? game.teams : []).find(item => String(item?.id) === id) || {};
  return team.full_name || team.name || team.display_name || '';
}

function marketAllowed(key, mode) {
  if (mode === 'all') return ['h2h','spreads','totals'].includes(key);
  if (mode === 'lines') return ['spreads','totals'].includes(key);
  return key === mode;
}

async function fetchBoard(config, date) {
  const params = new URLSearchParams({ bookIds: REQUEST_BOOK_IDS.join(','), periods:'event' });
  if (date) params.set('date', date);
  const payload = await getJson(`${ACTION_BASE}/${encodeURIComponent(config.slug)}?${params.toString()}`);
  return Array.isArray(payload?.games) ? payload.games : [];
}

async function fetchSport(sportKey, mode) {
  const config = SPORTS[sportKey];
  if (!config) return { events:[], requests:0, errors:['unsupported sport'] };

  const dates = config.weekly ? [null] : Array.from({ length: config.days || 2 }, (_, i) => ctDate(i));
  const settled = await Promise.allSettled(dates.map(date => fetchBoard(config, date)));
  const requests = settled.length;
  const errors = settled.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));
  const raw = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  const seen = new Set();
  const events = [];

  for (const game of raw) {
    if (!game?.id || seen.has(game.id)) continue;
    seen.add(game.id);

    const status = String(game?.status || '').toLowerCase();
    if (['complete','closed','final','cancelled','postponed'].includes(status)) continue;

    const startMs = parseMs(game?.start_time);
    if (!Number.isFinite(startMs) || startMs <= Date.now() + FUTURE_BUFFER_MS) continue;

    const home = teamName(game, 'home');
    const away = teamName(game, 'away');
    if (!home || !away) continue;

    const byBook = [];
    for (const [bookId, bookName] of BOOKS.entries()) {
      const ev = game?.markets?.[String(bookId)]?.event;
      if (!ev) continue;

      const offers = [];
      if (marketAllowed('h2h', mode)) {
        const h = mainLine(ev.moneyline, 'home');
        const a = mainLine(ev.moneyline, 'away');
        const d = mainLine(ev.moneyline, 'draw');
        if (h?.odds != null) offers.push({ market:'h2h', role:'home', odds:toDecimal(h.odds), point:null, book:bookName });
        if (a?.odds != null) offers.push({ market:'h2h', role:'away', odds:toDecimal(a.odds), point:null, book:bookName });
        if (d?.odds != null) offers.push({ market:'h2h', role:'draw', odds:toDecimal(d.odds), point:null, book:bookName });
      }
      if (marketAllowed('spreads', mode)) {
        const h = mainLine(ev.spread, 'home');
        const a = mainLine(ev.spread, 'away');
        if (h?.value != null && h?.odds != null) offers.push({ market:'spreads', role:'home', odds:toDecimal(h.odds), point:Number(h.value), book:bookName });
        if (a?.value != null && a?.odds != null) offers.push({ market:'spreads', role:'away', odds:toDecimal(a.odds), point:Number(a.value), book:bookName });
      }
      if (marketAllowed('totals', mode)) {
        const o = mainLine(ev.total, 'over');
        const u = mainLine(ev.total, 'under');
        if (o?.value != null && o?.odds != null) offers.push({ market:'totals', role:'over', odds:toDecimal(o.odds), point:Number(o.value), book:bookName });
        if (u?.value != null && u?.odds != null) offers.push({ market:'totals', role:'under', odds:toDecimal(u.odds), point:Number(u.value), book:bookName });
      }
      const clean = offers.filter(x => Number.isFinite(x.odds) && x.odds > 1);
      if (clean.length) byBook.push({ book:bookName, offers:clean });
    }

    if (byBook.length) events.push({
      sport:sportKey,
      home,
      away,
      time:new Date(startMs).toISOString(),
      books:byBook,
    });
  }

  return { events, requests, errors };
}

function arbForMarket(event, market) {
  const allOffers = event.books.flatMap(b => b.offers).filter(o => o.market === market);
  if (!allOffers.length) return [];

  const groups = new Map();
  if (market === 'h2h') {
    groups.set('main', allOffers);
  } else if (market === 'spreads') {
    for (const o of allOffers) {
      if (!Number.isFinite(o.point)) continue;
      const key = Math.abs(o.point).toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
  } else if (market === 'totals') {
    for (const o of allOffers) {
      if (!Number.isFinite(o.point)) continue;
      const key = Number(o.point).toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
  }

  const output = [];
  for (const offers of groups.values()) {
    const best = {};
    for (const o of offers) if (!best[o.role] || o.odds > best[o.role].odds) best[o.role] = o;

    const roles = market === 'totals'
      ? ['over','under']
      : market === 'spreads'
        ? ['home','away']
        : offers.some(o => o.role === 'draw') ? ['home','draw','away'] : ['home','away'];

    if (roles.some(role => !best[role])) continue;

    const selections = roles.map(role => {
      const p = best[role];
      return {
        name: role === 'home' ? event.home : role === 'away' ? event.away : role === 'draw' ? 'Draw' : role === 'over' ? 'Over' : 'Under',
        point:p.point,
        best_price:Number(p.odds),
        best_bookmaker:p.book,
      };
    });

    if (new Set(selections.map(x => x.best_bookmaker)).size < 2) continue;
    const inverse = selections.reduce((sum, x) => sum + 1 / x.best_price, 0);
    if (!Number.isFinite(inverse) || inverse >= 1) continue;

    const roi = (1 / inverse - 1) * 100;
    output.push({
      event_id:`${event.sport}-${event.home}-${event.away}-${market}-${event.time}`,
      sport_key:event.sport,
      home_team:event.home,
      away_team:event.away,
      commence_time:event.time,
      market_type:market,
      source_type:ENGINE,
      is_arb:true,
      arb_pct:Number(roi.toFixed(3)),
      selections,
      optimal_stakes:selections.map(x => ({
        name:x.name,
        point:x.point,
        price:x.best_price,
        bookmaker:x.best_bookmaker,
        stake:((1 / x.best_price) / inverse) * 100,
      })),
    });
  }

  return output;
}

function arbsForEvent(event, mode) {
  const markets = mode === 'all' ? ['h2h','spreads','totals'] : mode === 'lines' ? ['spreads','totals'] : [mode];
  return markets.flatMap(m => arbForMarket(event, m));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ error:'Method not allowed' });
  }

  const sport = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim() : '';
  const rawMode = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const mode = ['all','h2h','lines','spreads','totals'].includes(rawMode) ? rawMode : 'all';
  const debug = String(req.query.debug || '') === '1';

  if (sport && !SPORTS[sport]) return res.status(400).json({ error:`Unsupported sport_key: ${sport}` });
  const keys = sport ? [sport] : DEFAULT_SPORTS;

  try {
    const scans = await Promise.all(keys.map(key => fetchSport(key, mode)));

    if (debug) {
      const sports = keys.map((key, i) => {
        const scan = scans[i];
        const games = scan.events.length;
        const crossBookGames = scan.events.filter(e => e.books.length >= 2).length;
        const books = [...new Set(scan.events.flatMap(e => e.books.map(b => b.book)))].sort();
        const arbs = scan.events.flatMap(e => arbsForEvent(e, mode));
        return {
          sport_key:key,
          requests:scan.requests,
          errors:scan.errors,
          games,
          cross_book_games:crossBookGames,
          bookmakers:books,
          bookmaker_count:books.length,
          arbs:arbs.length,
        };
      });
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ engine:ENGINE, book_ids:BOOK_IDS, future_buffer_minutes:FUTURE_BUFFER_MS/60000, sports });
    }

    const events = scans.flatMap(s => s.events);
    const arbs = events
      .flatMap(e => arbsForEvent(e, mode))
      .sort((a,b) => Number(b.arb_pct)-Number(a.arb_pct) || parseMs(a.commence_time)-parseMs(b.commence_time))
      .slice(0,100);

    const books = new Set(events.flatMap(e => e.books.map(b => b.book)));
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Odds-Engine',ENGINE);
    res.setHeader('X-Bookmaker-Count',String(books.size));
    res.setHeader('X-Game-Count',String(events.length));
    res.setHeader('X-Cross-Book-Games',String(events.filter(e => e.books.length >= 2).length));
    res.setHeader('X-Arb-Count',String(arbs.length));
    return res.status(200).json(arbs);
  } catch (error) {
    return res.status(500).json({ error:'Action Network scan failed', detail:error?.message || String(error), engine:ENGINE });
  }
}
