const liveEls = {
  scanBtn: document.getElementById('scanLiveBtn'),
  sport: document.getElementById('liveSport'),
  minProfit: document.getElementById('liveMinProfit'),
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

let refreshTimer = null;
let latestEvents = [];
let activeController = null;
let requestSerial = 0;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-SA', {
    style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2,
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

function scaleStakes(optimalStakes, totalStake) {
  const clean = optimalStakes
    .map(x => ({ ...x, stake: Number(x.stake || 0) }))
    .filter(x => Number.isFinite(x.stake) && x.stake > 0);
  const baseTotal = clean.reduce((sum, x) => sum + x.stake, 0);
  if (!baseTotal) return [];
  return clean.map(x => ({ ...x, scaledStake: totalStake * x.stake / baseTotal }));
}

function selectionForStake(stake, selections) {
  return selections.find(x => String(x.name) === String(stake.name)) || {};
}

function calculateRoundedPlan(event, totalStake) {
  const optimal = Array.isArray(event.optimal_stakes) ? event.optimal_stakes : [];
  const selections = Array.isArray(event.selections) ? event.selections : [];
  const scaled = scaleStakes(optimal, totalStake);
  if (!scaled.length) return null;

  let used = 0;
  const rounded = scaled.map((s, i) => {
    const rawStake = i === scaled.length - 1
      ? totalStake - used
      : Math.round(s.scaledStake * 100) / 100;
    const stakeAmount = Math.max(0, Math.round(rawStake * 100) / 100);
    used += stakeAmount;

    const sel = selectionForStake(s, selections);
    const price = Number(sel.best_price || s.price || s.odds || 0);
    const bookmaker = s.bookmaker || sel.best_bookmaker || '';
    return { ...s, scaledStake: stakeAmount, price, bookmaker };
  });

  if (rounded.some(x => !Number.isFinite(x.price) || x.price <= 1 || x.scaledStake <= 0)) return null;

  const payouts = rounded.map(x => x.scaledStake * x.price);
  const guaranteedReturn = Math.min(...payouts);
  const profit = guaranteedReturn - totalStake;
  const roi = totalStake > 0 ? (profit / totalStake) * 100 : 0;

  if (!Number.isFinite(guaranteedReturn) || !Number.isFinite(profit) || !Number.isFinite(roi)) return null;
  return { scaled: rounded, guaranteedReturn, profit, roi };
}

function bookmakerMatches(plan) {
  const raw = liveEls.books.value.trim().toLowerCase();
  if (!raw) return true;
  const wanted = raw.split(',').map(x => x.trim()).filter(Boolean);
  const books = plan.scaled.map(x => String(x.bookmaker || '').toLowerCase());
  return wanted.some(w => books.some(b => b.includes(w)));
}

function updateMetrics(plans, scanTime = new Date()) {
  const best = plans[0];
  liveEls.metricCount.textContent = String(plans.length);
  liveEls.metricBestRoi.textContent = best ? `${best.plan.roi >= 0 ? '+' : ''}${best.plan.roi.toFixed(2)}%` : '—';
  liveEls.metricBestProfit.textContent = best ? money(best.plan.profit) : '—';
  liveEls.metricLastScan.textContent = scanTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  liveEls.lastUpdated.textContent = scanTime.toLocaleTimeString();
}

function buildPlans(events) {
  const totalStake = clampNumber(liveEls.stake.value, 1000, 1, 10000000);
  const minRoi = clampNumber(liveEls.minProfit.value, 0.5, 0, 50);

  liveEls.stake.value = String(totalStake);
  liveEls.minProfit.value = String(minRoi);

  return events
    .filter(e => e && e.is_arb === true)
    .map(event => ({ event, plan: calculateRoundedPlan(event, totalStake) }))
    .filter(item => item.plan && item.plan.roi >= minRoi)
    .filter(item => bookmakerMatches(item.plan))
    .sort((a, b) => b.plan.roi - a.plan.roi);
}

function renderLive(events, scanTime = new Date()) {
  const totalStake = clampNumber(liveEls.stake.value, 1000, 1, 10000000);
  const plans = buildPlans(events);

  liveEls.results.innerHTML = '';
  updateMetrics(plans, scanTime);

  if (!plans.length) {
    liveEls.message.textContent = 'No opportunities match your current ROI and bookmaker filters.';
    liveEls.results.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">◎</div>
        <div><strong>No qualifying arbitrage right now</strong><span>Try lowering the minimum ROI, choosing another sport, or clearing the bookmaker filter.</span></div>
      </div>`;
    return;
  }

  liveEls.message.textContent = `${plans.length} live arbitrage opportunit${plans.length === 1 ? 'y' : 'ies'} found.`;

  plans.forEach(({ event, plan }, index) => {
    const when = event.commence_time ? new Date(event.commence_time).toLocaleString() : 'Time unavailable';
    const sourceRoi = Number(event.arb_pct || 0);
    const sourceRoiText = Number.isFinite(sourceRoi) ? sourceRoi.toFixed(2) : '—';

    const card = document.createElement('article');
    card.className = 'live-card';
    card.innerHTML = `
      <div class="live-card-head">
        <div class="event-title-wrap">
          <div class="rank-badge">#${index + 1}</div>
          <div>
            <div class="event-meta"><span class="sport-chip">${esc(String(event.sport_key || 'SPORT').toUpperCase())}</span><span>${esc(when)}</span></div>
            <h3>${esc(event.home_team || 'Home')} <span>vs</span> ${esc(event.away_team || 'Away')}</h3>
          </div>
        </div>
        <div class="roi-stack">
          <div class="roi-badge good">+${plan.roi.toFixed(2)}%</div>
          <small>feed ${sourceRoiText}%</small>
        </div>
      </div>

      <div class="live-summary">
        <div><span>Total stake</span><strong>${money(totalStake)}</strong></div>
        <div><span>Guaranteed profit</span><strong class="profit-text">${money(plan.profit)}</strong></div>
        <div><span>Guaranteed return</span><strong>${money(plan.guaranteedReturn)}</strong></div>
        <div><span>Outcomes</span><strong>${plan.scaled.length}</strong></div>
      </div>

      <div class="market-label">Stake plan</div>
      <div class="stake-plan live-stakes">
        ${plan.scaled.map(s => {
          const payout = s.scaledStake * s.price;
          return `<div class="stake-row">
            <div class="stake-left"><div class="book">${esc(s.bookmaker || 'Bookmaker')}</div><div class="selection">${esc(s.name)} @ ${s.price.toFixed(2)}</div></div>
            <div class="stake-right"><strong>${money(s.scaledStake)}</strong><small>Payout ${money(payout)}</small></div>
          </div>`;
        }).join('')}
      </div>
    `;
    liveEls.results.appendChild(card);
  });
}

function renderCached() {
  if (latestEvents.length) renderLive(latestEvents, new Date());
}

async function scanLive() {
  const serial = ++requestSerial;
  if (activeController) activeController.abort();
  activeController = new AbortController();

  liveEls.scanBtn.disabled = true;
  liveEls.scanBtn.innerHTML = '<span class="spinner"></span> Scanning market…';
  liveEls.status.textContent = '● Scanning live odds';
  liveEls.message.textContent = 'Contacting live odds feed…';
  liveEls.results.innerHTML = '<div class="loading-skeleton"><div></div><div></div><div></div></div>';

  const params = new URLSearchParams();
  const sport = liveEls.sport.value.trim();
  if (sport) params.set('sport_key', sport);
  params.set('min_profit_pct', '0');

  try {
    const response = await fetch(`/api/arbitrage?${params.toString()}`, {
      cache: 'no-store',
      signal: activeController.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || '');
      throw new Error(`${data.error || 'Live scan failed'}${detail ? ` — ${detail}` : ''}`);
    }
    if (serial !== requestSerial) return;

    latestEvents = Array.isArray(data) ? data : [];
    const now = new Date();
    renderLive(latestEvents, now);
    liveEls.status.textContent = '● Live connected';
  } catch (error) {
    if (error.name === 'AbortError') return;
    liveEls.message.textContent = error.message;
    liveEls.status.textContent = '● Live error';
    liveEls.results.innerHTML = `<div class="error-panel"><strong>Unable to complete scan</strong><span>${esc(error.message)}</span></div>`;
  } finally {
    if (serial === requestSerial) {
      liveEls.scanBtn.disabled = false;
      liveEls.scanBtn.innerHTML = '<span class="btn-icon">⌁</span> Scan Live Opportunities';
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

function setRoiPreset(value) {
  liveEls.minProfit.value = value;
  document.querySelectorAll('[data-roi]').forEach(btn => btn.classList.toggle('active', btn.dataset.roi === String(value)));
  renderCached();
}

function setBookPreset(value) {
  liveEls.books.value = value;
  document.querySelectorAll('[data-book]').forEach(btn => btn.classList.toggle('active', value && btn.dataset.book === value));
  renderCached();
}

liveEls.scanBtn.addEventListener('click', scanLive);
liveEls.autoRefresh.addEventListener('change', configureAutoRefresh);
liveEls.minProfit.addEventListener('input', renderCached);
liveEls.stake.addEventListener('input', renderCached);
liveEls.books.addEventListener('input', renderCached);
liveEls.sport.addEventListener('change', scanLive);

liveEls.stake.addEventListener('keydown', e => { if (e.key === 'Enter') scanLive(); });
liveEls.books.addEventListener('keydown', e => { if (e.key === 'Enter') renderCached(); });

document.querySelectorAll('[data-roi]').forEach(btn => btn.addEventListener('click', () => setRoiPreset(btn.dataset.roi)));
document.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => setBookPreset(btn.dataset.book)));
