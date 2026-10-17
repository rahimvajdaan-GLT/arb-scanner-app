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

function isFuturePositiveArb(event, minProfitPct = 0) {
  if (!event || event.is_arb !== true) return false;

  const profitPct = Number(event.arb_pct || event.arb_profit_pct || 0);
  if (!Number.isFinite(profitPct) || profitPct <= Math.max(0, minProfitPct)) return false;

  if (!event.commence_time) return false;
  const startMs = Date.parse(event.commence_time);
  if (!Number.isFinite(startMs)) return false;

  // Do not show games that have already started. A 60-second buffer avoids borderline stale events.
  return startMs > Date.now() + 60_000;
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

  const params = new URLSearchParams({ min_profit_pct: String(effectiveMinProfit) });
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
    const combined = uniqueEvents(groups.flat().filter(Boolean))
      .filter(event => isFuturePositiveArb(event, effectiveMinProfit))
      .sort((a, b) => Number(b.arb_pct || 0) - Number(a.arb_pct || 0));

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json(combined);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Unable to reach PuntersEdge',
      detail: error.detail || error.message,
    });
  }
}
