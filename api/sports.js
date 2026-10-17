const SPORTS = [
  { key: 'nfl', title: 'NFL', group: 'American Football', active: true },
  { key: 'ncaaf', title: 'NCAAF', group: 'American Football', active: true },
  { key: 'nba', title: 'NBA', group: 'Basketball', active: true },
  { key: 'ncaab', title: 'NCAAB', group: 'Basketball', active: true },
  { key: 'mlb', title: 'MLB', group: 'Baseball', active: true },
  { key: 'nhl', title: 'NHL', group: 'Ice Hockey', active: true },
  { key: 'ufc', title: 'UFC / MMA', group: 'Combat Sports', active: true },
  { key: 'boxing', title: 'Boxing', group: 'Combat Sports', active: true },
  { key: 'soccer_epl', title: 'English Premier League', group: 'Soccer', active: true },
  { key: 'soccer_laliga', title: 'La Liga', group: 'Soccer', active: true },
  { key: 'soccer_bundesliga', title: 'Bundesliga', group: 'Soccer', active: true },
  { key: 'soccer_seriea', title: 'Serie A', group: 'Soccer', active: true },
  { key: 'soccer_ligue1', title: 'Ligue 1', group: 'Soccer', active: true },
  { key: 'soccer_mls', title: 'MLS', group: 'Soccer', active: true },
  { key: 'soccer_uefa_champs_league', title: 'UEFA Champions League', group: 'Soccer', active: true },
  { key: 'soccer_uefa_europa_league', title: 'UEFA Europa League', group: 'Soccer', active: true },
  { key: 'tennis_atp', title: 'ATP Tennis', group: 'Tennis', active: true },
  { key: 'tennis_wta', title: 'WTA Tennis', group: 'Tennis', active: true },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('X-Odds-Engine', 'open-books-v1');
  return res.status(200).json(SPORTS);
}
