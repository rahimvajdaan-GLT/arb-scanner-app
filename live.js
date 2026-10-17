const liveEls = {
  scanBtn: document.getElementById('scanLiveBtn'),
  sport: document.getElementById('liveSport'),
  market: document.getElementById('liveMarket'),
  stake: document.getElementById('liveStake'),
  books: document.getElementById('liveBooks'),
  autoRefresh: document.getElementById('autoRefresh'),
  lastUpdated: document.getElementById('lastUpdated'),
  message: document.getElementById('liveMessage'),
  results: document.getElementById('liveResults'),
  status: document.getElementById('liveStatus'),
  metricCount: document.getElementById('metricCount'),
  metricBestRoi: document.getElementById('metricBestRoi'),
  metricBestProfit: document.getElementById('metricBestProfit'),
  metricLastScan: document.getElementById('metricLastScan'),
};

const DISPLAY_TARGET = 10;
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
  if (!event.commence_time) return false;
  const start = new Date(event.commence_time).getTime();
  return Number.isFinite(start) && start > Date.now();
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
    .sort((a, b) => b.plan.roi - a.plan.roi);

  return { board: trueArbs.slice(0, DISPLAY_TARGET), trueArbs };
}

function updateMetrics(trueArbs, board, scanTime = new Date()) {
  const best = trueArbs[0];
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
    liveEls.message.textContent = 'No future positive arbitrage opportunities match your current filters.';
    liveEls.results.innerHTML = `<div class="no-results"><div class="no-results-icon">◎</div><div><strong>No positive future arbs right now</strong><span>Try All Sports, All Markets, or clear the bookmaker filter.</span></div></div>`;
    return;
  }

  liveEls.message.textContent = `${trueArbs.length} future positive true arb${trueArbs.length === 1 ? '' : 's'} found · ${board.length} shown`;

  board.forEach(({ event, plan }, index) => {
    const when = new Date(event.commence_time).toLocaleString('en-AU');
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
              <span class="guarantee-chip">TRUE ARB</span>
              <span>${esc(when)}</span>
            </div>
            <h3>${esc(event.home_team || 'Home')} <span>vs</span> ${esc(event.away_team || 'Away')}</h3>
          </div>
        </div>
        <div class="roi-stack">
          <div class="roi-badge good">+${plan.roi.toFixed(2)}%</div>
          <small>${sourceRoiText ? `feed ${sourceRoiText}%` : 'positive arb'}</small>
        </div>
      </div>

      <div class="live-summary">
        <div><span>Total Stake</span><strong>${money(totalStake)}</strong></div>
        <div><span>Guaranteed Profit</span><strong class="profit-text">${money(plan.profit)}</strong></div>
        <div><span>Guaranteed Return</span><strong>${money(plan.guaranteedReturn)}</strong></div>
        <div><span>Market</span><strong>${esc(market)}</strong></div>
      </div>

      <div class="market-label">Stake Split</div>
      <div class="stake-plan live-stakes">
        ${plan.scaled.map(s => {
          const payout = s.scaledStake * s.price;
          return `<div class="stake-row"><div class="stake-left"><div class="book">${esc(s.bookmaker || 'Bookmaker')}</div><div class="selection">${esc(s.name)}${esc(pointText(s))} @ ${s.price.toFixed(2)}</div></div><div class="stake-right"><strong>${money(s.scaledStake)}</strong><small>Payout ${money(payout)}</small></div></div>`;
        }).join('')}
      </div>
    `;
    liveEls.results.appendChild(card);
  });
}

function renderCached() {
  if (latestEvents.length) renderLive(latestEvents, latestScanTime || new Date());
}

async function loadSportsCatalog() {
  try {
    const response = await fetch('/api/sports', { cache: 'force-cache' });
    const sports = await response.json();
    if (!response.ok || !Array.isArray(sports)) return;

    const current = liveEls.sport.value;
    const active = sports
      .filter(s => s && s.key && s.title)
      .sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')) || String(a.title).localeCompare(String(b.title)));

    liveEls.sport.innerHTML = '<option value="">All Sports</option>' + active.map(s => `<option value="${esc(s.key)}">${esc(s.title)}${s.group ? ` — ${esc(s.group)}` : ''}</option>`).join('');
    if ([...liveEls.sport.options].some(o => o.value === current)) liveEls.sport.value = current;
  } catch (_) {}
}

async function scanLive() {
  const serial = ++requestSerial;
  if (activeController) activeController.abort();
  activeController = new AbortController();

  liveEls.scanBtn.disabled = true;
  liveEls.scanBtn.innerHTML = '<span class="spinner"></span> Scanning…';
  liveEls.status.textContent = '● Scanning';
  liveEls.message.textContent = 'Checking future positive arbitrage opportunities…';
  liveEls.results.innerHTML = '<div class="loading-skeleton"><div></div><div></div><div></div></div>';

  const params = new URLSearchParams();
  const sport = liveEls.sport.value.trim();
  if (sport) params.set('sport_key', sport);
  params.set('market_mode', liveEls.market.value || 'all');
  params.set('min_profit_pct', '0');

  try {
    const response = await fetch(`/api/arbitrage?${params.toString()}`, { cache: 'no-store', signal: activeController.signal });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || '');
      throw new Error(`${data.error || 'Live scan failed'}${detail ? ` — ${detail}` : ''}`);
    }
    if (serial !== requestSerial) return;

    latestEvents = Array.isArray(data) ? data : [];
    latestScanTime = new Date();
    renderLive(latestEvents, latestScanTime);
    liveEls.status.textContent = '● Live';
  } catch (error) {
    if (error.name === 'AbortError') return;
    liveEls.message.textContent = error.message;
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
  if (liveEls.autoRefresh.checked) {
    if (!latestEvents.length) scanLive();
    refreshTimer = setInterval(scanLive, 60000);
  }
}

function setBookPreset(value) {
  liveEls.books.value = value;
  document.querySelectorAll('[data-book]').forEach(btn => btn.classList.toggle('active', value && btn.dataset.book === value));
  renderCached();
}

liveEls.scanBtn.addEventListener('click', scanLive);
liveEls.autoRefresh.addEventListener('change', configureAutoRefresh);
liveEls.stake.addEventListener('input', renderCached);
liveEls.books.addEventListener('input', renderCached);
liveEls.sport.addEventListener('change', scanLive);
liveEls.market.addEventListener('change', scanLive);
liveEls.stake.addEventListener('keydown', e => { if (e.key === 'Enter') scanLive(); });
liveEls.books.addEventListener('keydown', e => { if (e.key === 'Enter') renderCached(); });
document.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => setBookPreset(btn.dataset.book)));

loadSportsCatalog();