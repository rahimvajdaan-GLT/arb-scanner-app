'use strict';

// Parser for publicly supplied, permissioned HTML snapshots. It deliberately
// performs NO network requests: a source must be separately reviewed and
// licensed before a scheduler or HTTP fetch adapter may be connected.
const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
const ALLOWED_SPORTS = new Set(['afl', 'nrl', 'basketball', 'nfl', 'nhl', 'baseball', 'soccer', 'cricket', 'tennis']);

function asList(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function nameOf(value) { return typeof value === 'string' ? value.trim() : String(value?.name || '').trim(); }
function sportsEvents(node, found = []) {
  if (Array.isArray(node)) { for (const item of node) sportsEvents(item, found); return found; }
  if (!node || typeof node !== 'object') return found;
  if (asList(node['@type']).includes('SportsEvent')) found.push(node);
  if (node['@graph']) sportsEvents(node['@graph'], found);
  return found;
}

function jsonLdBlocks(html) {
  if (typeof html !== 'string' || html.length > 2_000_000) return [];
  const blocks = [];
  const tag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(tag)) {
    if (!/\btype\s*=\s*(['"])application\/ld\+json\1/i.test(match[1])) continue;
    try { blocks.push(JSON.parse(match[2].trim())); } catch { /* malformed blocks are ignored */ }
  }
  return blocks;
}

function parseAuthorizedHtml({html, source, sport, bookmaker, approved, capturedAt, now = Date.now()}) {
  if (approved !== true) throw new Error('Source permission is required before processing bookmaker HTML');
  if (!ALLOWED_SPORTS.has(sport) || !nameOf(bookmaker) || !nameOf(source)) return [];
  const stamp = Date.parse(capturedAt);
  if (!Number.isFinite(stamp) || stamp > now + 60_000 || now - stamp > MAX_SNAPSHOT_AGE_MS) return [];
  const events = [];
  for (const block of jsonLdBlocks(html)) {
    for (const event of sportsEvents(block)) {
      const start = Date.parse(event.startDate);
      if (!Number.isFinite(start) || start <= now + FUTURE_BUFFER_MS) continue;
      const participants = asList(event.competitor);
      const home = nameOf(event.homeTeam) || nameOf(participants[0]);
      const away = nameOf(event.awayTeam) || nameOf(participants[1]);
      if (!home || !away || home.toLowerCase() === away.toLowerCase()) continue;
      const accepted = new Map();
      for (const offer of asList(event.offers)) {
        const label = nameOf(offer);
        const rawPrice = offer?.price ?? offer?.priceSpecification?.price;
        const price = Number(rawPrice);
        const outcome = label.toLowerCase() === 'draw' || label.toLowerCase() === 'tie' ? 'draw'
          : label.toLowerCase() === home.toLowerCase() ? 'home'
          : label.toLowerCase() === away.toLowerCase() ? 'away' : null;
        if (!outcome || !Number.isFinite(price) || price <= 1 || accepted.has(outcome)) continue;
        accepted.set(outcome, {market:'h2h',role:outcome,odds:price,point:null,book:bookmaker});
      }
      const required = sport === 'soccer' ? ['home', 'draw', 'away'] : ['home', 'away'];
      if (accepted.size !== required.length || required.some(role => !accepted.has(role))) continue;
      events.push({sport,home,away,time:new Date(start).toISOString(),book:bookmaker,
        offers:required.map(role => accepted.get(role)),outcomeCount:required.length,
        source,quotedAt:new Date(stamp).toISOString()});
    }
  }
  return events;
}

module.exports = {parseAuthorizedHtml, jsonLdBlocks};
