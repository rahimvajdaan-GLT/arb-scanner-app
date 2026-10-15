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
  const params = new URLSearchParams({ min_profit_pct: minProfit || '0' });
  if (sportKey) params.set('sport_key', sportKey);

  try {
    const upstream = await fetch(`https://api.puntersedge.online/v1/arb/sports?${params.toString()}`, {
      headers: { 'X-API-Key': apiKey },
    });

    const contentType = upstream.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await upstream.json()
      : { detail: await upstream.text() };

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: payload?.title || payload?.error || 'PuntersEdge request failed',
        detail: payload?.detail || payload,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(Array.isArray(payload) ? payload : []);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to reach PuntersEdge', detail: error.message });
  }
}
