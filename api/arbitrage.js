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
    market_type: event.market_type || 'h2h',
    source_type: 'arb_sports',
  }));
}

function normalizeBestOdds(events) {
  return events.map(event => {
    const selections = (Array.isArray(event.selections) ? event.selections : []).map(sel => ({
      name: sel.name,
      point: sel.point,
      best_price: Number(sel.best_price || sel.price || 0),
      best_bookmaker: sel.best_bookmaker || sel.bookmaker || '',
    }));

    const arbPct = Number(event.arb_profit_pct || event.arb_pct || 0);
    return {
      event_id: event.id || event.event_id,
      sport_key: event.sport_key,
      home_team: event.home_team,
      away_team: event.away_team,
      commence_time: event.commence_time,
      market_type: 'h2h',
      source_type: 'best_odds',
      is_arb: event.arb_exists === true || arbPct > 0,
      is_middle: false,
      arb_pct: Number.isFinite(arbPct) ? arbPct : 0,
      max_overlay_pct: Number(event.max_overlay_pct || 0),
      selections,
      optimal_stakes: deriveOptimalStakes(selections),
    };
  }).filter(event => event.selections.length >= 2);
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
        sport_key: event.sport_key,
        home_team: event.home_team,
        away_team: event.away_team,
        commence_time: event.commence_time,
        market_type: marketType || 'lines',
        source_type: 'arb_lines',
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

async function loadSports(apiKey) {
  const sports = await readArray('https://api.puntersedge.online/v1/sports', apiKey);
  return sports.filter(s => s && s.key && s.active !== false);
}

async function addBestOddsFallback(existing, apiKey, sportKey, targetCount = 12) {
  let combined = uniqueEvents(existing);
  if (combined.length >= targetCount) return combined;

  let sportKeys = [];
  if (sportKey) {
    sportKeys = [sportKey];
  } else {
    const sports = await loadSports(apiKey);
    const preferred = ['nba', 'nrl', 'afl', 'soccer_epl', 'tennis_atp', 'tennis_wta', 'ncaab', 'ncaaf'];
    const activeKeys = sports.map(s => String(s.key));
    sportKeys = [
      ...preferred.filter(key => activeKeys.includes(key)),
      ...activeKeys.filter(key => !preferred.includes(key)),
    ];
  }

  // Fetch one sport at a time and stop as soon as the board has enough events.
  // This avoids spending credits on sports we do not need.
  for (const key of sportKeys.slice(0, 8)) {
    if (combined.length >= targetCount) break;
    try {
      const events = await readArray(`https://api.puntersedge.online/v1/best-odds/${encodeURIComponent(key)}`, apiKey);
      combined = uniqueEvents([...combined, ...normalizeBestOdds(events)]);
    } catch (error) {
      // A sport may have no current prices or may be unsupported by best-odds.
      // Skip it instead of failing the whole scan.
      if (![404, 422].includes(error.status)) throw error;
    }
  }

  return combined;
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
  const minProfit = typeof req.query.min_profit_pct === 'string' ? req.query.min_profit_pct.trim() : '0';
  const modeRaw = typeof req.query.market_mode === 'string' ? req.query.market_mode.trim().toLowerCase() : 'all';
  const allowedModes = new Set(['all', 'h2h', 'lines', 'spreads', 'totals']);
  const marketMode = allowedModes.has(modeRaw) ? modeRaw : 'all';

  const params = new URLSearchParams({ min_profit_pct: minProfit || '0' });
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
    let combined = uniqueEvents(groups.flat().filter(Boolean));

    // The arb endpoints can legitimately return only a couple of candidates.
    // Fill the board with canonical best-odds events so the UI can still show a useful Top 10.
    // These fallback rows are clearly labelled NOT GUARANTEED in the frontend.
    if (combined.length < 10 && (marketMode === 'all' || marketMode === 'h2h')) {
      combined = await addBestOddsFallback(combined, apiKey, sportKey, 12);
    }

    combined.sort((a, b) => {
      if (Boolean(a.is_arb) !== Boolean(b.is_arb)) return a.is_arb ? -1 : 1;
      const aScore = Number(a.arb_pct || a.max_overlay_pct || 0);
      const bScore = Number(b.arb_pct || b.max_overlay_pct || 0);
      return bScore - aScore;
    });

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json(combined);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to reach PuntersEdge',
      detail: error.detail || error.message,
    });
  }
}
