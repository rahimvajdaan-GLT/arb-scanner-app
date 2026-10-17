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
  if (!Number.isFinite(inverseSum) || inverseSum >= 1) return [];

  return usable.map(sel => ({
    ...sel,
    stake: ((1 / sel.price) / inverseSum) * 100,
  }));
}

function normalizeHeadToHead(events) {
  return (Array.isArray(events) ? events : []).map(event => ({
    ...event,
    raw_event_id: event.event_id || event.id || '',
    market_type: event.market_type || 'h2h',
    source_type: 'arb_sports',
  }));
}

function normalizeBestOdds(events) {
  return (Array.isArray(events) ? events : []).map(event => {
    const selections = (Array.isArray(event.selections) ? event.selections : []).map(sel => ({
      name: sel.name,
      point: sel.point,
      best_price: Number(sel.best_price || sel.price || 0),
      best_bookmaker: sel.best_bookmaker || sel.bookmaker || '',
    }));
    const arbPct = Number(event.arb_profit_pct || event.arb_pct || 0);
    return {
      event_id: event.id || event.event_id || '',
      raw_event_id: event.id || event.event_id || '',
      sport_key: event.sport_key,
      home_team: event.home_team,
      away_team: event.away_team,
      commence_time: event.commence_time,
      market_type: 'h2h',
      source_type: 'best_odds',
      is_arb: event.arb_exists === true || arbPct > 0,
      arb_pct: Number.isFinite(arbPct) ? arbPct : 0,
      stale: event.stale === true,
      data_age_seconds: Number(event.data_age_seconds || 0),
      freshest_age_seconds: Number(event.freshest_age_seconds || 0),
      selections,
      optimal_stakes: deriveOptimalStakes(selections),
    };
  });
}

function normalizeLineArbs(events, requestedMode) {
  const flattened = [];
  (Array.isArray(events) ? events : []).forEach(event => {
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
        started: opp.started ?? event.started,
        completed: opp.completed ?? event.completed,
        is_arb: opp.is_arb === true,
        is_middle: opp.is_middle === true,
        arb_pct: Number(opp.arb_pct || 0),
        selections,
        optimal_stakes: optimalStakes,
      });
    });
  });
  return flattened;
}

function eventKey(event) {
  return [event.sport_key || '', event.home_team || '', event.away_team || '', event.market_type || 'h2h']
    .join('|').toLowerCase();
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
  const flags = [event.is_live, event.live, event.in_play, event.inplay, event.is_inplay, event.started, event.has_started, event.completed];
  if (flags.some(value => value === true || value === 1 || String(value).toLowerCase() === 'true')) return true;
  const statusText = [event.status, event.state, event.match_status, event.event_status, event.phase, event.market_status]
    .filter(Boolean).join(' ').toLowerCase();
  return /(in[-_ ]?play|live|started|playing|ongoing|half[-_ ]?time|halftime|finished|completed|ended)/i.test(statusText);
}

function isValidPrematchPositiveArb(event) {
  if (!event || event.is_arb !== true || isInPlayOrStarted(event)) return false;
  const profitPct = Number(event.arb_pct || event.arb_profit_pct || 0);
  if (!Number.isFinite(profitPct) || profitPct <= 0) return false;
  if (event.stale === true) return false;
  const startMs = parseStartMs(event.commence_time);
  if (!Number.isFinite(startMs)) return false;
  // Keep a 20-minute safety window so borderline or delayed fixtures never appear as pre-match.
  return startMs > Date.now() + 20 * 60_000;
}

async function loadSports(apiKey) {
  const sports = await readArray('https://api.puntersedge.online/v1/sports', apiKey);
  return sports.filter(s => s && s.key && s.active !== false);
}

async function findBestOddsArbs(apiKey, sportKey, target = 10) {
  let sportKeys = [];
  if (sportKey) {
    sportKeys = [sportKey];
  } else {
    const sports = await loadSports(apiKey);
    const active = sports.map(s => String(s.key));
    const preferred = ['nba', 'nrl', 'afl', 'soccer_epl', 'tennis_atp', 'tennis_wta', 'ncaab', 'ncaaf', 'cricket', 'soccer_uefa_champs_league'];
    sportKeys = [...preferred.filter(key => active.includes(key)), ...active.filter(key => !preferred.includes(key))].slice(0, 10);
  }

  const groups = await Promise.allSettled(sportKeys.map(async key => {
    const events = await readArray(`https://api.puntersedge.online/v1/best-odds/${encodeURIComponent(key)}`, apiKey);
    return normalizeBestOdds(events);
  }));

  const all = groups
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value)
    .filter(isValidPrematchPositiveArb)
    .sort((a, b) => Number(b.arb_pct || 0) - Number(a.arb_pct || 0));

  return uniqueEvents(all).slice(0, target);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PUNTERSEDGE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'PUNTERSEDGE_API_KEY is not configured on the server.' });

  const sportKey = typeof req.query.sport_key === 'string' ? req.query.sport_key.trim() : '';
  const modeRaw = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const allowedModes = new Set(['all', 'h2h', 'lines', 'spreads', 'totals']);
  const marketMode = allowedModes.has(modeRaw) ? modeRaw : 'all';
  const params = new URLSearchParams({ min_profit_pct: '0', maxAgeMinutes: '360' });
  if (sportKey) params.set('sport_key', sportKey);

  try {
    const requests = [];
    if (marketMode === 'all' || marketMode === 'h2h') {
      requests.push(readArray(`https://api.puntersedge.online/v1/arb/sports?${params.toString()}`, apiKey).then(normalizeHeadToHead));
    }
    if (marketMode === 'all' || marketMode === 'lines' || marketMode === 'spreads' || marketMode === 'totals') {
      requests.push(readArray(`https://api.puntersedge.online/v1/arb/lines?${params.toString()}`, apiKey).then(events => normalizeLineArbs(events, marketMode)));
    }

    const groups = await Promise.allSettled(requests);
    let combined = groups
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value)
      .filter(isValidPrematchPositiveArb);

    // When the global arb endpoints return no genuine positive h2h arb, scan the provider's
    // best-odds endpoint across active sports. This still returns only real positive arbs;
    // it does not fill the board with value/negative opportunities.
    if (combined.length < 10 && (marketMode === 'all' || marketMode === 'h2h')) {
      const fallback = await findBestOddsArbs(apiKey, sportKey, 10);
      combined = uniqueEvents([...combined, ...fallback]);
    }

    combined = combined
      .filter(isValidPrematchPositiveArb)
      .sort((a, b) => {
        const roiDiff = Number(b.arb_pct || 0) - Number(a.arb_pct || 0);
        if (roiDiff !== 0) return roiDiff;
        return parseStartMs(a.commence_time) - parseStartMs(b.commence_time);
      });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(combined.slice(0, 25));
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to reach PuntersEdge',
      detail: error.detail || error.message,
    });
  }
}
