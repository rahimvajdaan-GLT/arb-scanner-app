async function readPayload(url, apiKey) {
  const upstream = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  const contentType = upstream.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await upstream.json()
    : { detail: await upstream.text() };

  if (!upstream.ok) {
    const error = new Error(payload?.title || payload?.error || 'PuntersEdge request failed');
    error.status = upstream.status;
    error.detail = payload?.detail || payload;
    throw error;
  }
  return payload;
}

async function readArray(url, apiKey) {
  const payload = await readPayload(url, apiKey);
  return Array.isArray(payload) ? payload : [];
}

function deriveOptimalStakes(selections) {
  const usable = (Array.isArray(selections) ? selections : [])
    .map(sel => ({
      name: sel.name,
      point: sel.point,
      price: Number(sel.best_price || sel.price || sel.odds || 0),
      bookmaker: sel.best_bookmaker || sel.bookmaker || '',
    }))
    .filter(sel => sel.name && Number.isFinite(sel.price) && sel.price > 1);

  if (usable.length < 2) return [];
  const inverseSum = usable.reduce((sum, sel) => sum + (1 / sel.price), 0);
  if (!Number.isFinite(inverseSum) || inverseSum <= 0) return [];

  return usable.map(sel => ({
    ...sel,
    stake: ((1 / sel.price) / inverseSum) * 100,
  }));
}

function normalizeHeadToHead(events) {
  return events.map(event => ({
    ...event,
    raw_event_id: event.event_id || event.id || '',
    market_type: event.market_type || 'h2h',
    source_type: 'arb_sports',
  }));
}

function normalizeLineArbs(events, requestedMode) {
  const flattened = [];

  events.forEach(event => {
    const marketType = String(event.market_type || '').toLowerCase();
    if (requestedMode === 'spreads' && marketType !== 'spreads') return;
    if (requestedMode === 'totals' && marketType !== 'totals') return;

    const opportunities = Array.isArray(event.opportunities) ? event.opportunities : [];
    opportunities.forEach((opp, index) => {
      const sides = [opp.side_a, opp.side_b].filter(Boolean);
      const selections = sides.map(side => ({
        name: side.name,
        point: side.point,
        best_price: Number(side.price || 0),
        best_bookmaker: side.bookmaker || '',
      }));

      let optimalStakes = (Array.isArray(opp.optimal_stakes) ? opp.optimal_stakes : []).map(stake => {
        const matchingSide = sides.find(side =>
          String(side.name) === String(stake.name) &&
          (stake.point == null || side.point == null || Number(side.point) === Number(stake.point))
        ) || sides.find(side => String(side.name) === String(stake.name)) || {};

        return {
          ...stake,
          price: Number(matchingSide.price || stake.price || stake.odds || 0),
          point: stake.point ?? matchingSide.point,
          bookmaker: stake.bookmaker || matchingSide.bookmaker || '',
        };
      });

      if (!optimalStakes.length) optimalStakes = deriveOptimalStakes(selections);

      flattened.push({
        event_id: `${event.event_id || 'line'}-${marketType}-${index}`,
        raw_event_id: event.event_id || event.id || '',
        sport_key: event.sport_key,
        home_team: event.home_team,
        away_team: event.away_team,
        commence_time: event.commence_time,
        market_type: marketType || 'lines',
        source_type: 'arb_lines',
        status: opp.status ?? event.status,
        state: opp.state ?? event.state,
        is_live: opp.is_live ?? event.is_live,
        in_play: opp.in_play ?? event.in_play,
        is_inplay: opp.is_inplay ?? event.is_inplay,
        started: opp.started ?? event.started,
        completed: opp.completed ?? event.completed,
        is_arb: opp.is_arb === true,
        is_middle: opp.is_middle === true,
        arb_pct: Number(opp.arb_pct || 0),
        max_overlay_pct: Number(opp.max_overlay_pct || 0),
        selections,
        optimal_stakes: optimalStakes,
      });
    });
  });

  return flattened;
}

function eventKey(event) {
  return [
    event.sport_key || '',
    event.home_team || '',
    event.away_team || '',
    event.market_type || 'h2h',
  ].join('|').toLowerCase();
}

function uniqueEvents(events) {
  const seen = new Set();
  const output = [];
  for (const event of events) {
    const key = eventKey(event);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

function parseStartMs(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;

  const raw = String(value).trim();
  if (!raw) return NaN;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return Date.parse(hasZone ? raw : `${raw}Z`);
}

function isInPlayOrStarted(event) {
  if (!event) return true;

  const liveFlags = [
    event.is_live,
    event.live,
    event.in_play,
    event.inplay,
    event.is_inplay,
    event.started,
    event.has_started,
    event.completed,
  ];
  if (liveFlags.some(value => value === true || value === 1 || String(value).toLowerCase() === 'true')) return true;

  const statusText = [
    event.status,
    event.state,
    event.match_status,
    event.event_status,
    event.phase,
    event.market_status,
  ].filter(Boolean).join(' ').toLowerCase();

  return /(in[-_ ]?play|live|started|playing|ongoing|half[-_ ]?time|halftime|finished|completed|ended)/i.test(statusText);
}

function isFuturePositiveArb(event, minProfitPct = 0) {
  if (!event || event.is_arb !== true || isInPlayOrStarted(event)) return false;

  const profitPct = Number(event.arb_pct || event.arb_profit_pct || 0);
  if (!Number.isFinite(profitPct) || profitPct <= Math.max(0, minProfitPct)) return false;

  const startMs = parseStartMs(event.commence_time);
  if (!Number.isFinite(startMs)) return false;

  return startMs > Date.now() + 10 * 60_000;
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamTokens(value) {
  const stop = new Set(['fc', 'club', 'the', 'united', 'city', 'team']);
  return normalizeName(value).split(' ').filter(token => token && !stop.has(token));
}

function similarTeam(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  const common = ta.filter(token => tb.includes(token)).length;
  return common / Math.min(ta.length, tb.length) >= 0.5;
}

function sameFixture(candidate, rawEvent) {
  const candidateId = String(candidate.raw_event_id || candidate.event_id || '');
  const rawId = String(rawEvent.id || rawEvent.event_id || '');
  if (candidateId && rawId && candidateId === rawId) return true;

  const cStart = parseStartMs(candidate.commence_time);
  const rStart = parseStartMs(rawEvent.commence_time);
  const closeTime = Number.isFinite(cStart) && Number.isFinite(rStart) && Math.abs(cStart - rStart) <= 60 * 60_000;
  const sameTeams = similarTeam(candidate.home_team, rawEvent.home_team) && similarTeam(candidate.away_team, rawEvent.away_team);

  return closeTime && sameTeams;
}

function rawEventHasFreshMarket(rawEvent, marketType) {
  const books = Array.isArray(rawEvent.bookmakers) ? rawEvent.bookmakers : [];
  return books.some(book => {
    const age = Number(book.age_seconds);
    if (book.stale === true) return false;
    if (Number.isFinite(age) && age > 360 * 60) return false;
    const markets = Array.isArray(book.markets) ? book.markets : [];
    return markets.some(market => String(market.key || '').toLowerCase() === marketType);
  });
}

async function verifyAgainstPrematchFeed(candidates, apiKey) {
  if (!candidates.length) return [];

  const grouped = new Map();
  for (const candidate of candidates) {
    const sport = String(candidate.sport_key || '').trim();
    const market = String(candidate.market_type || 'h2h').toLowerCase();
    if (!sport || !['h2h', 'spreads', 'totals'].includes(market)) continue;
    if (!grouped.has(sport)) grouped.set(sport, new Set());
    grouped.get(sport).add(market);
  }

  const verifiedBySport = new Map();
  await Promise.all([...grouped.entries()].map(async ([sport, marketSet]) => {
    const markets = [...marketSet].join(',');
    const url = `https://api.puntersedge.online/v1/sports/${encodeURIComponent(sport)}/odds?markets=${encodeURIComponent(markets)}&oddsFormat=decimal&maxAgeMinutes=360`;
    try {
      const events = await readArray(url, apiKey);
      verifiedBySport.set(sport, events);
    } catch (error) {
      verifiedBySport.set(sport, []);
    }
  }));

  return candidates.filter(candidate => {
    const sportEvents = verifiedBySport.get(String(candidate.sport_key || '').trim()) || [];
    const rawEvent = sportEvents.find(raw => sameFixture(candidate, raw));
    if (!rawEvent) return false;

    const rawStart = parseStartMs(rawEvent.commence_time);
    if (!Number.isFinite(rawStart) || rawStart <= Date.now() + 10 * 60_000) return false;
    if (rawEvent.stale === true) return false;
    return rawEventHasFreshMarket(rawEvent, String(candidate.market_type || 'h2h').toLowerCase());
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PUNTERSEDGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PUNTERSEDGE_API_KEY is not configured on the server.' });
  }

  const sportKey = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim() : '';
  const minProfitRaw = typeof req.query.min_profit_pct === 'string' ? req.query.min_profit_pct.trim() : '0';
  const minProfit = Number(minProfitRaw);
  const effectiveMinProfit = Number.isFinite(minProfit) ? Math.max(0, minProfit) : 0;
  const modeRaw = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const allowedModes = new Set(['all', 'h2h', 'lines', 'spreads', 'totals']);
  const marketMode = allowedModes.has(modeRaw) ? modeRaw : 'all';

  const params = new URLSearchParams({ min_profit_pct: String(effectiveMinProfit), maxAgeMinutes: '360' });
  if (sportKey) params.set('sport_key', sportKey);

  try {
    const requests = [];

    if (marketMode === 'all' || marketMode === 'h2h') {
      requests.push(
        readArray(`https://api.puntersedge.online/v1/arb/sports?${params.toString()}`, apiKey)
          .then(normalizeHeadToHead)
      );
    }

    if (marketMode === 'all' || marketMode === 'lines' || marketMode === 'spreads' || marketMode === 'totals') {
      requests.push(
        readArray(`https://api.puntersedge.online/v1/arb/lines?${params.toString()}`, apiKey)
          .then(events => normalizeLineArbs(events, marketMode))
      );
    }

    const groups = await Promise.all(requests);
    let combined = uniqueEvents(groups.flat().filter(Boolean))
      .filter(event => isFuturePositiveArb(event, effectiveMinProfit));

    combined = await verifyAgainstPrematchFeed(combined, apiKey);

    combined.sort((a, b) => {
      const timeDiff = parseStartMs(a.commence_time) - parseStartMs(b.commence_time);
      if (timeDiff !== 0) return timeDiff;
      return Number(b.arb_pct || 0) - Number(a.arb_pct || 0);
    });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(combined);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to reach PuntersEdge',
      detail: error.detail || error.message,
    });
  }
}
