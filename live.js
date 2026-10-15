const liveEls = {
  scanBtn: document.getElementById('scanLiveBtn'),
  sport: document.getElementById('liveSport'),
  minProfit: document.getElementById('liveMinProfit'),
  stake: document.getElementById('liveStake'),
  message: document.getElementById('liveMessage'),
  results: document.getElementById('liveResults'),
  status: document.getElementById('liveStatus'),
};

function money(value) {
  return new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 }).format(value);
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

function renderLive(events) {
  const totalStake = Math.max(1, Number(liveEls.stake.value) || 1000);
  const arbs = events.filter(e => e && e.is_arb === true);
  liveEls.results.innerHTML = '';

  if (!arbs.length) {
    liveEls.message.textContent = 'No true arbitrage opportunities were returned for this scan. Try another sport or set minimum profit to 0.';
    return;
  }

  liveEls.message.textContent = `${arbs.length} live arbitrage opportunit${arbs.length === 1 ? 'y' : 'ies'} found.`;
  arbs.sort((a, b) => Number(b.arb_pct || 0) - Number(a.arb_pct || 0));

  arbs.forEach(event => {
    const scaled = scaleStakes(Array.isArray(event.optimal_stakes) ? event.optimal_stakes : [], totalStake);
    const profit = totalStake * (Number(event.arb_pct || 0) / 100);
    const when = event.commence_time ? new Date(event.commence_time).toLocaleString() : 'Time unavailable';
    const selections = Array.isArray(event.selections) ? event.selections : [];

    const card = document.createElement('article');
    card.className = 'live-card';
    card.innerHTML = `
      <div class="live-card-head">
        <div>
          <div class="eyebrow">${esc(String(event.sport_key || '').toUpperCase())}</div>
          <h3>${esc(event.home_team || 'Home')} vs ${esc(event.away_team || 'Away')}</h3>
          <div class="live-time">${esc(when)}</div>
        </div>
        <div class="roi-badge good">+${Number(event.arb_pct || 0).toFixed(2)}%</div>
      </div>
      <div class="live-summary">
        <div><span>Total stake</span><strong>${money(totalStake)}</strong></div>
        <div><span>Est. profit</span><strong>${money(profit)}</strong></div>
        <div><span>Est. return</span><strong>${money(totalStake + profit)}</strong></div>
      </div>
      <div class="stake-plan">
        ${scaled.map(s => {
          const sel = selections.find(x => x.name === s.name) || {};
          const price = sel.best_price ? ` @ ${Number(sel.best_price).toFixed(2)}` : '';
          const book = s.bookmaker || sel.best_bookmaker || 'Bookmaker';
          return `<div class="stake-row"><div><div class="book">${esc(book)}</div><div class="selection">${esc(s.name)}${price}</div></div><div class="amount">${money(s.scaledStake)}</div></div>`;
        }).join('')}
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
  const minProfit = liveEls.minProfit.value.trim() || '0';
  if (sport) params.set('sport_key', sport);
  params.set('min_profit_pct', minProfit);

  try {
    const response = await fetch(`/api/arbitrage?${params.toString()}`);
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
  } finally {
    liveEls.scanBtn.disabled = false;
    liveEls.scanBtn.textContent = 'Scan Live Opportunities';
  }
}

liveEls.scanBtn.addEventListener('click', scanLive);
