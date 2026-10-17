async function readUpstream(url, apiKey) {
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
  return Array.isArray(payload) ? payload : [];
}

function normalizeHeadToHead(events) {
  return events.map(event => ({
    ...event,
    market_type: event.market_type || 'h2h',
    source_type: 'h2h',
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

      const optimalStakes = (Array.isArray(opp.optimal_stakes) ? opp.optimal_stakes : []).map(stake => {
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

      flattened.push({
        event_id: `${event.event_id || 'line'}-${marketType}-${index}`,
        sport_key: event.sport_key,
        home_team: event.home_team,
        away_team: event.away_team,
        commence_time: event.commence_time,
        market_type: marketType || 'lines',
        source_type: 'lines',
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
        readUpstream(`https://api.puntersedge.online/v1/arb/sports?${params.toString()}`, apiKey)
          .then(normalizeHeadToHead)
      );
    }

    if (marketMode === 'all' || marketMode === 'lines' || marketMode === 'spreads' || marketMode === 'totals') {
      requests.push(
        readUpstream(`https://api.puntersedge.online/v1/arb/lines?${params.toString()}`, apiKey)
          .then(events => normalizeLineArbs(events, marketMode))
      );
    }

    const groups = await Promise.all(requests);
    const combined = groups.flat().filter(Boolean);

    // Return true arbitrage first, then the strongest non-arb/value comparisons.
    // The frontend labels non-arb rows clearly as NOT GUARANTEED.
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
