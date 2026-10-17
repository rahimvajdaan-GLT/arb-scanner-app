const SPORTS = [
  { key: 'nfl', title: 'NFL', group: 'American Football', active: true },
  { key: 'ncaaf', title: 'NCAAF', group: 'American Football', active: true },
  { key: 'nba', title: 'NBA', group: 'Basketball', active: true },
  { key: 'ncaab', title: 'NCAAB', group: 'Basketball', active: true },
  { key: 'mlb', title: 'MLB', group: 'Baseball', active: true },
  { key: 'nhl', title: 'NHL', group: 'Ice Hockey', active: true },
  { key: 'soccer', title: 'Soccer — All Leagues', group: 'Soccer', active: true },
  { key: 'soccer_epl', title: 'English Premier League', group: 'Soccer', active: true },
  { key: 'soccer_mls', title: 'MLS', group: 'Soccer', active: true },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('X-Odds-Engine', 'open-multibook-v5');
  return res.status(200).json(SPORTS);
}
