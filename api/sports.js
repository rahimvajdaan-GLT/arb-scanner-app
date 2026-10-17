export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PUNTERSEDGE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PUNTERSEDGE_API_KEY is not configured on the server.' });
  }

  try {
    const upstream = await fetch('https://api.puntersedge.online/v1/sports', {
      headers: { 'X-API-Key': apiKey },
    });

    const contentType = upstream.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await upstream.json()
      : { detail: await upstream.text() };

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: payload?.title || payload?.error || 'PuntersEdge sports request failed',
        detail: payload?.detail || payload,
      });
    }

    const sports = Array.isArray(payload)
      ? payload.filter(item => item && item.active !== false)
      : [];

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(sports);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load sports catalogue', detail: error.message });
  }
}
