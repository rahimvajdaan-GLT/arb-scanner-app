const liveEls = {
  scanBtn: document.getElementById('scanLiveBtn'),
  sport: document.getElementById('liveSport'),
  minProfit: document.getElementById('liveMinProfit'),
  stake: document.getElementById('liveStake'),
  bookmaker: document.getElementById('liveBookmaker'),
  autoRefresh: document.getElementById('liveAutoRefresh'),
  lastUpdated: document.getElementById('lastUpdated'),
  message: document.getElementById('liveMessage'),
  results: document.getElementById('liveResults'),
  status: document.getElementById('liveStatus'),
};

let refreshTimer = null;

function money(value) {
  return new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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

function roundedStakePlan(scaled, selections, totalStake) {
  if (!scaled.length) return { rows: [], guaranteedReturn: totalStake, guaranteedProfit: 0, actualRoi: 0 };

  const rows = scaled.map((s, i) => {
    const sel = selections.find(x => x.name === s.name) || {};
    const odds = Number(sel.best_price || s.price || 0);
    const roundedStake = Math.round(Number(s.scaledStake || 0) * 100) / 100;
    return {
      ...s,
      odds,
      roundedStake,
      bookmaker: s.bookmaker || sel.best_bookmaker || 'Bookmaker',
    };
  });

  const roundedTotal = rows.reduce((sum, r) => sum + r.roundedStake, 0);
  const diff = Math.round((totalStake - roundedTotal) * 100) / 100;
  if (rows.length && diff !== 0) rows[rows.length - 1].roundedStake = Math.round((rows[rows.length - 1].roundedStake + diff) * 100) / 100;

  const payouts = rows.filter(r => r.odds > 1).map(r => r.roundedStake * r.odds);
  const guaranteedReturn = payouts.length ? Math.min(...payouts) : totalStake;
  const guaranteedProfit = guaranteedReturn - totalStake;
  const actualRoi = totalStake > 0 ? guaranteedProfit / totalStake * 100 : 0;

  return { rows, guaranteedReturn, guaranteedProfit, actualRoi };
}

function bookmakerMatches(planRows) {
  const filter = liveEls.bookmaker.value.trim().toLowerCase();
  if (!filter) return true;
  const wanted = filter.split(',').map(x => x.trim()).filter(Boolean);
  return planRows.some(r => wanted.some(w => String(r.bookmaker || '').toLowerCase().includes(w)));
}

function renderLive(events) {
  const totalStake = Math.max(1, Number(liveEls.stake.value) || 1000);
  const minProfit = Math.max(0, Number(liveEls.minProfit.value) || 0);
  const arbs = events.filter(e => e && e.is_arb === true);
  liveEls.results.innerHTML = '';

  const prepared = arbs.map(event => {
    const selections = Array.isArray(event.selections) ? event.selections : [];
    const scaled = scaleStakes(Array.isArray(event.optimal_stakes) ? event.optimal_stakes : [], totalStake);
    const plan = roundedStakePlan(scaled, selections, totalStake);
    return { event, selections, plan };
  }).filter(x => x.plan.actualRoi >= minProfit && bookmakerMatches(x.plan.rows));

  if (!prepared.length) {
    liveEls.message.textContent = 'No opportunities match your current sport, ROI and bookmaker filters.';
    return;
  }

  prepared.sort((a, b) => b.plan.actualRoi - a.plan.actualRoi);
  liveEls.message.textContent = `${prepared.length} live arbitrage opportunit${prepared.length === 1 ? 'y' : 'ies'} found.`;

  prepared.forEach(({ event, plan }) => {
    const when = event.commence_time ? new Date(event.commence_time).toLocaleString() : 'Time unavailable';
    const card = document.createElement('article');
    card.className = 'live-card';
    card.innerHTML = `
      <div class="live-card-head">
        <div>
          <div class="eyebrow">${esc(String(event.sport_key || '').toUpperCase())}</div>
          <h3>${esc(event.home_team || 'Home')} vs ${esc(event.away_team || 'Away')}</h3>
          <div class="live-time">${esc(when)}</div>
        </div>
        <div class="roi-badge good">+${plan.actualRoi.toFixed(2)}%</div>
      </div>
      <div class="live-summary">
        <div><span>Total stake</span><strong>${money(totalStake)}</strong></div>
        <div><span>Guaranteed profit</span><strong>${money(plan.guaranteedProfit)}</strong></div>
        <div><span>Guaranteed return</span><strong>${money(plan.guaranteedReturn)}</strong></div>
      </div>
      <div class="stake-plan">
        ${plan.rows.map(r => `<div class="stake-row"><div><div class="book">${esc(r.bookmaker)}</div><div class="selection">${esc(r.name)}${r.odds ? ` @ ${r.odds.toFixed(2)}` : ''}</div></div><div class="amount">${money(r.roundedStake)}</div></div>`).join('')}
      </div>
    `;
    liveEls.results.appendChild(card);
  });
}

async function scanLive() {
  liveEls.scanBtn.disabled = true;
  liveEls.scanBtn.textContent = 'Scanning…';
  liveEls.status.textContent = '● Loading live odds';
  liveEls.message.textContent = 'Contacting live odds feed…';
  liveEls.results.innerHTML = '';

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
    liveEls.lastUpdated.textContent = new Date().toLocaleTimeString();
  } catch (error) {
    liveEls.message.textContent = error.message;
    liveEls.status.textContent = '● Live error';
  } finally {
    liveEls.scanBtn.disabled = false;
    liveEls.scanBtn.textContent = 'Scan Live Opportunities';
  }
}

function configureAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (liveEls.autoRefresh.checked) {
    refreshTimer = setInterval(scanLive, 60000);
  }
}

liveEls.scanBtn.addEventListener('click', scanLive);
liveEls.autoRefresh.addEventListener('change', configureAutoRefresh);
liveEls.bookmaker.addEventListener('input', () => {
  if (liveEls.results.children.length) scanLive();
});
