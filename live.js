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

function money(value) {
  return new Intl.NumberFormat('en-SA', {
    style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function scaleStakes(optimalStakes, totalStake) {
  const baseTotal = optimalStakes.reduce((sum, x) => sum + Number(x.stake || 0), 0);
  if (!baseTotal) return [];
  return optimalStakes.map(x => ({ ...x, scaledStake: totalStake * Number(x.stake || 0) / baseTotal }));
}

function getPriceForStake(stake, selections) {
  const sel = selections.find(x => String(x.name) === String(stake.name)) || {};
  return Number(sel.best_price || stake.price || stake.odds || 0);
}

function calculateRoundedPlan(event, totalStake) {
  const optimal = Array.isArray(event.optimal_stakes) ? event.optimal_stakes : [];
  const selections = Array.isArray(event.selections) ? event.selections : [];
  const scaled = scaleStakes(optimal, totalStake);
  if (!scaled.length) return { scaled: [], guaranteedReturn: 0, profit: 0, roi: Number(event.arb_pct || 0) };

  const rounded = scaled.map((s, i) => {
    const stake = i === scaled.length - 1
      ? Math.round((totalStake - scaled.slice(0, -1).reduce((sum, x) => sum + Math.round(x.scaledStake * 100) / 100, 0)) * 100) / 100
      : Math.round(s.scaledStake * 100) / 100;
    const price = getPriceForStake(s, selections);
    return { ...s, scaledStake: Math.max(0, stake), price };
  });

  const payouts = rounded.map(x => x.price > 0 ? x.scaledStake * x.price : Infinity);
  const guaranteedReturn = payouts.length ? Math.min(...payouts) : 0;
  const profit = guaranteedReturn - totalStake;
  const roi = totalStake > 0 ? (profit / totalStake) * 100 : 0;
  return { scaled: rounded, guaranteedReturn, profit, roi };
}

function bookmakerMatches(plan) {
  const raw = liveEls.books.value.trim().toLowerCase();
  if (!raw) return true;
  const wanted = raw.split(',').map(x => x.trim()).filter(Boolean);
  const books = plan.scaled.map(x => String(x.bookmaker || '').toLowerCase());
  return wanted.some(w => books.some(b => b.includes(w)));
}

function updateMetrics(plans) {
  const now = new Date();
  const best = plans[0];
  liveEls.metricCount.textContent = String(plans.length);
  liveEls.metricBestRoi.textContent = best ? `+${best.plan.roi.toFixed(2)}%` : '—';
  liveEls.metricBestProfit.textContent = best ? money(best.plan.profit) : '—';
  liveEls.metricLastScan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  liveEls.lastUpdated.textContent = now.toLocaleTimeString();
}

function renderLive(events) {
  const totalStake = Math.max(1, Number(liveEls.stake.value) || 1000);
  const minRoi = Math.max(0, Number(liveEls.minProfit.value) || 0);

  let plans = events
    .filter(e => e && e.is_arb === true)
    .map(event => ({ event, plan: calculateRoundedPlan(event, totalStake) }))
    .filter(item => item.plan.roi >= minRoi)
    .filter(bookmakerMatches)
    .sort((a, b) => b.plan.roi - a.plan.roi);

  liveEls.results.innerHTML = '';
  updateMetrics(plans);

  if (!plans.length) {
    liveEls.message.textContent = 'No opportunities match your current sport, ROI and bookmaker filters.';
    liveEls.results.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">◎</div>
        <div><strong>No qualifying arbitrage right now</strong><span>Try lowering the minimum ROI, choosing All Sports, or clearing the bookmaker filter.</span></div>
      </div>`;
    return;
  }

  liveEls.message.textContent = `${plans.length} live arbitrage opportunit${plans.length === 1 ? 'y' : 'ies'} found.`;

  plans.forEach(({ event, plan }, index) => {
    const when = event.commence_time ? new Date(event.commence_time).toLocaleString() : 'Time unavailable';
    const selections = Array.isArray(event.selections) ? event.selections : [];
    const sourceRoi = Number(event.arb_pct || 0);

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
          <small>feed ${sourceRoi.toFixed(2)}%</small>
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
          const sel = selections.find(x => String(x.name) === String(s.name)) || {};
          const price = Number(sel.best_price || s.price || 0);
          const book = s.bookmaker || sel.best_bookmaker || 'Bookmaker';
          const payout = price > 0 ? s.scaledStake * price : 0;
          return `<div class="stake-row">
            <div class="stake-left"><div class="book">${esc(book)}</div><div class="selection">${esc(s.name)}${price ? ` @ ${price.toFixed(2)}` : ''}</div></div>
            <div class="stake-right"><strong>${money(s.scaledStake)}</strong><small>Payout ${money(payout)}</small></div>
          </div>`;
        }).join('')}
      </div>
    `;
    liveEls.results.appendChild(card);
  });
}

async function scanLive() {
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
    const response = await fetch(`/api/arbitrage?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || '');
      throw new Error(`${data.error || 'Live scan failed'}${detail ? ` — ${detail}` : ''}`);
    }
    renderLive(Array.isArray(data) ? data : []);
    liveEls.status.textContent = '● Live connected';
  } catch (error) {
    liveEls.message.textContent = error.message;
    liveEls.status.textContent = '● Live error';
    liveEls.results.innerHTML = `<div class="error-panel"><strong>Unable to complete scan</strong><span>${esc(error.message)}</span></div>`;
  } finally {
    liveEls.scanBtn.disabled = false;
    liveEls.scanBtn.innerHTML = '<span class="btn-icon">⌁</span> Scan Live Opportunities';
  }
}

function configureAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (liveEls.autoRefresh.checked) refreshTimer = setInterval(scanLive, 60000);
}

liveEls.scanBtn.addEventListener('click', scanLive);
liveEls.autoRefresh.addEventListener('change', configureAutoRefresh);
liveEls.minProfit.addEventListener('change', () => {
  if (liveEls.results.children.length) scanLive();
});
liveEls.sport.addEventListener('change', () => {
  if (liveEls.results.children.length) scanLive();
});
