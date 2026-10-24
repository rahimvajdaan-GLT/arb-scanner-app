const liveEls = {
  scanBtn: document.getElementById('scanLiveBtn'),
  sport: document.getElementById('liveSport'),
  market: document.getElementById('liveMarket'),
  stake: document.getElementById('liveStake'),
  books: document.getElementById('liveBooks'),
  autoRefresh: document.getElementById('autoRefresh'),
  extraFeed: document.getElementById('liveExtraFeed'),
  oddsApi: document.getElementById('liveOddsApi'),
  lastUpdated: document.getElementById('lastUpdated'),
  message: document.getElementById('liveMessage'),
  results: document.getElementById('liveResults'),
  status: document.getElementById('liveStatus'),
  metricCount: document.getElementById('metricCount'),
  metricBestRoi: document.getElementById('metricBestRoi'),
  metricBestProfit: document.getElementById('metricBestProfit'),
  metricLastScan: document.getElementById('metricLastScan'),
};

const DISPLAY_TARGET = 25;
const FUTURE_BUFFER_MS = 10 * 60 * 1000;
let refreshTimer = null;
let latestEvents = [];
let activeController = null;
let requestSerial = 0;
let latestScanTime = null;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function marketLabel(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'h2h') return 'Moneyline';
  if (value === 'spreads') return 'Spread';
  if (value === 'totals') return 'Total';
  return value ? value.replaceAll('_', ' ') : 'Market';
}

function pointText(stake) {
  const point = Number(stake.point);
  if (!Number.isFinite(point)) return '';
  if (['over','under'].includes(String(stake.name).toLowerCase())) return ` ${point}`;
  return ` ${point > 0 ? '+' : ''}${point}`;
}

function betInstruction(event, stake) {
  const market = String(event.market_type || '').toLowerCase();
  const name = String(stake.name || '').trim();
  const nameLower = name.toLowerCase();
  const point = Number(stake.point);

  if (market === 'h2h') {
    if (['draw', 'tie'].includes(nameLower)) return 'BET DRAW';
    return `BET ${name} TO WIN`;
  }
  if (market === 'totals') {
    const total = Number.isFinite(point) ? ` ${point}` : '';
    return `BET ${name.toUpperCase()}${total}`;
  }
  if (market === 'spreads') {
    const line = Number.isFinite(point) ? ` ${point > 0 ? '+' : ''}${point}` : '';
    return `BET ${name}${line}`;
  }
  return `BET ${name}${pointText(stake)}`;
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

function scaleStakes(optimalStakes, totalStake) {
  const clean = optimalStakes
    .map(x => ({ ...x, stake: Number(x.stake || 0) }))
    .filter(x => Number.isFinite(x.stake) && x.stake > 0);
  const baseTotal = clean.reduce((sum, x) => sum + x.stake, 0);
  if (!baseTotal) return [];
  return clean.map(x => ({ ...x, scaledStake: totalStake * x.stake / baseTotal }));
}

function selectionForStake(stake, selections) {
  const exact = selections.find(x =>
    String(x.name) === String(stake.name) &&
    (stake.point == null || x.point == null || Number(x.point) === Number(stake.point))
  );
  return exact || selections.find(x => String(x.name) === String(stake.name)) || {};
}

function deriveOptimalFromSelections(selections) {
  const usable = selections
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
  return usable.map(sel => ({ ...sel, stake: ((1 / sel.price) / inverseSum) * 100 }));
}

function calculateRoundedPlan(event, totalStake) {
  const selections = Array.isArray(event.selections) ? event.selections : [];
  let optimal = Array.isArray(event.optimal_stakes) ? event.optimal_stakes : [];
  if (!optimal.length) optimal = deriveOptimalFromSelections(selections);
  const scaled = scaleStakes(optimal, totalStake);
  if (!scaled.length) return null;

  let used = 0;
  const rounded = scaled.map((s, i) => {
    const rawStake = i === scaled.length - 1 ? totalStake - used : Math.round(s.scaledStake * 100) / 100;
    const stakeAmount = Math.max(0, Math.round(rawStake * 100) / 100);
    used += stakeAmount;
    const sel = selectionForStake(s, selections);
    const price = Number(sel.best_price || s.price || s.odds || 0);
    const bookmaker = s.bookmaker || sel.best_bookmaker || '';
    const point = s.point ?? sel.point;
    return { ...s, scaledStake: stakeAmount, price, bookmaker, point };
  });

  if (rounded.some(x => !Number.isFinite(x.price) || x.price <= 1 || x.scaledStake <= 0)) return null;
  const payouts = rounded.map(x => x.scaledStake * x.price);
  const guaranteedReturn = Math.min(...payouts);
  const profit = guaranteedReturn - totalStake;
  const roi = totalStake > 0 ? (profit / totalStake) * 100 : 0;
  if (![guaranteedReturn, profit, roi].every(Number.isFinite)) return null;
  return { scaled: rounded, guaranteedReturn, profit, roi };
}

function bookmakerMatches(plan) {
  const raw = liveEls.books.value.trim().toLowerCase();
  if (!raw) return true;
  const wanted = raw.split(',').map(x => x.trim()).filter(Boolean);
  const books = plan.scaled.map(x => String(x.bookmaker || '').toLowerCase());
  return wanted.some(w => books.some(b => b.includes(w)));
}

function isFutureEvent(event) {
  if (isInPlayOrStarted(event)) return false;
  const start = parseStartMs(event?.commence_time);
  return Number.isFinite(start) && start > Date.now() + FUTURE_BUFFER_MS;
}

function buildBoard(events) {
  const totalStake = clampNumber(liveEls.stake.value, 1000, 1, 10000000);
  liveEls.stake.value = String(totalStake);
  const trueArbs = events
    .filter(Boolean)
    .filter(isFutureEvent)
    .map(event => ({ event, plan: calculateRoundedPlan(event, totalStake) }))
    .filter(item => item.plan)
    .filter(item => bookmakerMatches(item.plan))
    .filter(item => item.event.is_arb === true && item.plan.profit > 0 && item.plan.roi > 0)
    .sort((a, b) => {
      // Higher verified theoretical return first; use kickoff as tie-breaker.
      const profitDiff = b.plan.roi - a.plan.roi;
      if (Math.abs(profitDiff) > 1e-9) return profitDiff;
      return parseStartMs(a.event.commence_time) - parseStartMs(b.event.commence_time);
    });
  return { board: trueArbs.slice(0, DISPLAY_TARGET), trueArbs };
}

function updateMetrics(trueArbs, board, scanTime = new Date()) {
  const best = [...trueArbs].sort((a, b) => b.plan.roi - a.plan.roi)[0];
  liveEls.metricCount.textContent = String(trueArbs.length);
  liveEls.metricBestRoi.textContent = best ? `+${best.plan.roi.toFixed(2)}%` : '—';
  liveEls.metricBestProfit.textContent = best ? money(best.plan.profit) : '—';
  liveEls.metricLastScan.textContent = scanTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  liveEls.lastUpdated.textContent = `${scanTime.toLocaleTimeString()} · ${board.length} shown`;
}

function renderLive(events, scanTime = latestScanTime || new Date()) {
  const totalStake = clampNumber(liveEls.stake.value, 1000, 1, 10000000);
  const { board, trueArbs } = buildBoard(events);
  liveEls.results.innerHTML = '';
  updateMetrics(trueArbs, board, scanTime);

  if (!board.length) {
    liveEls.message.textContent = 'No pre-match positive arbitrage opportunities match your current filters.';
    liveEls.results.innerHTML = `<div class="no-results"><div class="no-results-icon">◎</div><div><strong>No verified positive opportunities in this scan</strong><span>In-play and games starting within 10 minutes are hidden. The checked bookmakers did not offer a profitable combination. Choose another sport or clear your filters; other fixtures may remain unchecked.</span></div></div>`;
    return;
  }

  liveEls.message.textContent = `${trueArbs.length} pre-match positive quoted-price opportunit${trueArbs.length === 1 ? 'y' : 'ies'} found · ${board.length} shown`;

  board.forEach(({ event, plan }, index) => {
    const startMs = parseStartMs(event.commence_time);
    const when = new Date(startMs).toLocaleString('en-AU');
    const minutesToStart = Math.max(0, Math.floor((startMs - Date.now()) / 60000));
    const startsText = minutesToStart < 60 ? `Starts in ${minutesToStart} min` : minutesToStart < 1440 ? `Starts in ${Math.floor(minutesToStart / 60)}h ${minutesToStart % 60}m` : `Starts ${when}`;
    const sourceRoi = Number(event.arb_pct || 0);
    const sourceRoiText = Number.isFinite(sourceRoi) && sourceRoi > 0 ? sourceRoi.toFixed(2) : null;
    const market = marketLabel(event.market_type);

    const card = document.createElement('article');
    card.className = 'live-card guaranteed-card';
    card.innerHTML = `
      <div class="live-card-head">
        <div class="event-title-wrap">
          <div class="rank-badge">#${index + 1}</div>
          <div>
            <div class="event-meta">
              <span class="sport-chip">${esc(String(event.sport_key || 'SPORT').toUpperCase())}</span>
              <span class="market-chip">${esc(market)}</span>
              <span class="guarantee-chip">THEORETICAL ARB · VERIFY PRICES</span>
              <span>${esc(startsText)}</span>
            </div>
            <h3>${esc(event.home_team || 'Home')} <span>vs</span> ${esc(event.away_team || 'Away')}</h3>
            <small class="event-start-time">Scheduled: ${esc(when)}</small>
          </div>
        </div>
        <div class="roi-stack">
          <div class="roi-badge good">+${plan.roi.toFixed(2)}%</div>
          <small>${sourceRoiText ? `feed ${sourceRoiText}%` : 'positive arb'}</small>
        </div>
      </div>
      <div class="live-summary">
        <div><span>Total Stake</span><strong>${money(totalStake)}</strong></div>
        <div><span>Quoted Profit</span><strong class="profit-text">${money(plan.profit)}</strong></div>
        <div><span>Min. Theoretical Return</span><strong>${money(plan.guaranteedReturn)}</strong></div>
        <div><span>Market</span><strong>${esc(market)}</strong></div>
      </div>
      <div class="bet-help">Place <strong>every bet below</strong> at the listed bookmaker. This is arbitrage coverage, not a prediction of which team will win.</div>
      <div class="market-label">Exact bets to place</div>
      <div class="stake-plan live-stakes">
        ${plan.scaled.map((s, betIndex) => {
          const payout = s.scaledStake * s.price;
          const instruction = betInstruction(event, s);
          return `<div class="stake-row bet-instruction-row"><div class="stake-left"><div class="bet-number">BET ${betIndex + 1}</div><div class="bet-action">${esc(instruction)}</div><div class="book">At ${esc(s.bookmaker || 'Bookmaker')}</div><div class="selection">Odds ${s.price.toFixed(2)}</div></div><div class="stake-right"><span class="stake-label">STAKE</span><strong>${money(s.scaledStake)}</strong><small>Quoted payout ${money(payout)}</small></div></div>`;
        }).join('')}
      </div>
    `;
    liveEls.results.appendChild(card);
  });
}

const MAX_QUOTE_AGE_MS = 2 * 60 * 1000;
function renderCached() {
  if (!latestScanTime) return;
  if (Date.now() - latestScanTime.getTime() > MAX_QUOTE_AGE_MS) {
    latestEvents = [];
    latestScanTime = null;
    liveEls.metricCount.textContent = '—';
    liveEls.metricBestRoi.textContent = '—';
    liveEls.metricBestProfit.textContent = '—';
    liveEls.status.textContent = '● Quotes expired';
    liveEls.message.textContent = 'Displayed odds have expired. Scan again for current bookmaker prices.';
    liveEls.lastUpdated.textContent = 'Quotes expired — rescan';
    liveEls.results.innerHTML = '<div class="no-results"><strong>Quotes expired</strong><span>Odds change quickly. Run a new scan to verify current pricing.</span></div>';
    window.dispatchEvent(new CustomEvent('arb:scan-expired'));
    return;
  }
  if (latestEvents.length) renderLive(latestEvents, latestScanTime);
}

async function loadSportsCatalog() {
  try {
    const response = await fetch('/api/sports', { cache: 'force-cache' });
    const sports = await response.json();
    if (!response.ok || !Array.isArray(sports)) return;
    const current = liveEls.sport.value;
    const active = sports.filter(s => s && s.key && s.title).sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')) || String(a.title).localeCompare(String(b.title)));
    liveEls.sport.innerHTML = '<option value="">All Sports — sampled rotation</option>' + active.map(s => `<option value="${esc(s.key)}">${esc(s.title)}${s.group ? ` — ${esc(s.group)}` : ''}</option>`).join('');
    if ([...liveEls.sport.options].some(o => o.value === current)) liveEls.sport.value = current;
  } catch (_) {}
}

async function scanLive() {
  const serial = ++requestSerial;
  if (activeController) activeController.abort();
  activeController = new AbortController();
  liveEls.scanBtn.disabled = true;
  liveEls.scanBtn.innerHTML = '<span class="spinner"></span> Scanning…';
  liveEls.status.textContent = '● Scanning pre-match only';
  liveEls.message.textContent = 'Checking upcoming pre-match positive arbitrage opportunities…';
  liveEls.results.innerHTML = '<div class="loading-skeleton"><div></div><div></div><div></div></div>';

  const params = new URLSearchParams();
  const sport = liveEls.sport.value.trim();
  if (sport) params.set('sport_key', sport);
  if (liveEls.extraFeed?.checked) params.set('include_krok', '1');
  if (liveEls.oddsApi?.checked) params.set('include_odds_api', '1');
  params.set('market_mode', liveEls.market.value || 'all');
  params.set('min_profit_pct', '0');
  params.set('debug', '1');

  try {
    const response = await fetch(`/api/arbitrage?${params.toString()}`, { signal: activeController.signal });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || '');
      throw new Error(`${data.error || 'Live scan failed'}${detail ? ` — ${detail}` : ''}`);
    }
    if (serial !== requestSerial) return;
    latestEvents = Array.isArray(data.results) ? data.results.filter(isFutureEvent) : [];
    const sourceTime = Date.parse(String(data.scanned_at || ''));
    latestScanTime = Number.isFinite(sourceTime) && sourceTime <= Date.now() ? new Date(sourceTime) : new Date();
    const expiredSnapshot = Date.now() - latestScanTime.getTime() > MAX_QUOTE_AGE_MS;
    if (expiredSnapshot) latestEvents = [];
    renderLive(latestEvents, latestScanTime);
    window.dispatchEvent(new CustomEvent('arb:scan', {detail:data}));
    if (expiredSnapshot) {
      liveEls.metricCount.textContent = '—';
      liveEls.metricBestRoi.textContent = '—';
      liveEls.metricBestProfit.textContent = '—';
      liveEls.status.textContent = '● Quotes expired';
      liveEls.message.textContent = 'Cached bookmaker quotes are too old for live arbitrage. Scan again after the feed refreshes.';
      window.dispatchEvent(new CustomEvent('arb:scan-expired'));
      return;
    }
    const feeds=Array.isArray(data.providers)?data.providers:[];
    const working=feeds.filter(p=>Number(p.events)>0);
    const errors=feeds.filter(p=>p.error);
    liveEls.status.textContent=!working.length?'● Odds sources unavailable':errors.length?'● Partial odds coverage':'● Recent bookmaker quotes · Pre-match';
    if (!working.length) {
      liveEls.metricCount.textContent = '—';
      liveEls.metricBestRoi.textContent = '—';
      liveEls.metricBestProfit.textContent = '—';
      liveEls.message.textContent = 'All odds sources are unavailable or rate-limited. Arbitrage cannot be verified.';
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    // Invalidated scans must never repaint historical positive results.
    latestEvents = [];
    latestScanTime = null;
    liveEls.metricCount.textContent = '—';
    liveEls.metricBestRoi.textContent = '—';
    liveEls.metricBestProfit.textContent = '—';
    liveEls.metricLastScan.textContent = '—';
    liveEls.lastUpdated.textContent = 'Scan unavailable';
    liveEls.message.textContent = error.message;
    window.dispatchEvent(new CustomEvent('arb:scan-error', {detail:error.message}));
    liveEls.status.textContent = '● Error';
    liveEls.results.innerHTML = `<div class="error-panel"><strong>Unable to complete scan</strong><span>${esc(error.message)}</span></div>`;
  } finally {
    if (serial === requestSerial) {
      liveEls.scanBtn.disabled = false;
      liveEls.scanBtn.innerHTML = '<span class="btn-icon">⌁</span> Scan Opportunities';
    }
  }
}

function configureAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (liveEls.autoRefresh.checked && !liveEls.extraFeed?.checked && !liveEls.oddsApi?.checked) {
    refreshTimer = setInterval(scanLive, 900000);
  }
}

function setBookPreset(value) {
  liveEls.books.value = value;
  document.querySelectorAll('[data-book]').forEach(btn => btn.classList.toggle('active', value && btn.dataset.book === value));
  renderCached();
  window.dispatchEvent(new CustomEvent('arb:book-filter'));
}

liveEls.scanBtn.addEventListener('click', scanLive);
liveEls.autoRefresh.addEventListener('change', configureAutoRefresh);
if (liveEls.extraFeed) liveEls.extraFeed.addEventListener('change', ()=>{
  // Protect free API call allowance: optional feed always requires manual scans.
  if (liveEls.extraFeed.checked) {
    liveEls.autoRefresh.checked = false;
    if (liveEls.oddsApi) liveEls.oddsApi.checked = false;
  }
  configureAutoRefresh();
  liveEls.message.textContent = liveEls.extraFeed.checked ? 'Choose one sport and click Scan. Extra feed uses your Krok free API calls when configured.' : 'Extra bookmaker feed disabled. Existing sources remain available.';
});
if (liveEls.oddsApi) liveEls.oddsApi.addEventListener('change', ()=>{
  // Both optional feeds require manual scans to protect their free quotas.
  if(liveEls.oddsApi.checked){
    liveEls.autoRefresh.checked=false;
    if(liveEls.extraFeed) liveEls.extraFeed.checked=false;
  }
  configureAutoRefresh();
  liveEls.message.textContent=liveEls.oddsApi.checked?'Choose a supported sport and scan once. The Odds API requires its own server-side free key.':'The Odds API extra feed disabled.';
});
liveEls.stake.addEventListener('input', renderCached);
liveEls.books.addEventListener('input', ()=>{renderCached();window.dispatchEvent(new CustomEvent('arb:book-filter'))});
liveEls.sport.addEventListener('change', scanLive);
liveEls.market.addEventListener('change', scanLive);
liveEls.stake.addEventListener('keydown', e => { if (e.key === 'Enter') scanLive(); });
liveEls.books.addEventListener('keydown', e => { if (e.key === 'Enter') renderCached(); });
document.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => setBookPreset(btn.dataset.book)));

setInterval(renderCached, 30000);
loadSportsCatalog();