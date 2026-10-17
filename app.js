const state = {
  mode: 2,
  outcomes: [
    { selection: 'Outcome A', bookmaker: 'Bookmaker A', odds: 2.10 },
    { selection: 'Outcome B', bookmaker: 'Bookmaker B', odds: 2.05 },
  ],
};

const els = {
  twoWayBtn: document.getElementById('twoWayBtn'),
  threeWayBtn: document.getElementById('threeWayBtn'),
  outcomes: document.getElementById('outcomes'),
  totalStake: document.getElementById('totalStake'),
  calculateBtn: document.getElementById('calculateBtn'),
  resetBtn: document.getElementById('resetBtn'),
  arbStatus: document.getElementById('arbStatus'),
  roiBadge: document.getElementById('roiBadge'),
  arbIndex: document.getElementById('arbIndex'),
  guaranteedPayout: document.getElementById('guaranteedPayout'),
  estimatedProfit: document.getElementById('estimatedProfit'),
  roiValue: document.getElementById('roiValue'),
  stakePlan: document.getElementById('stakePlan'),
};

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-SA', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function defaultOutcomes(mode) {
  if (mode === 3) {
    return [
      { selection: 'Home', bookmaker: 'Bookmaker A', odds: 3.60 },
      { selection: 'Draw', bookmaker: 'Bookmaker B', odds: 3.80 },
      { selection: 'Away', bookmaker: 'Bookmaker C', odds: 3.20 },
    ];
  }
  return [
    { selection: 'Outcome A', bookmaker: 'Bookmaker A', odds: 2.10 },
    { selection: 'Outcome B', bookmaker: 'Bookmaker B', odds: 2.05 },
  ];
}

function renderOutcomes() {
  els.outcomes.innerHTML = '';
  state.outcomes.forEach((outcome, index) => {
    const card = document.createElement('div');
    card.className = 'outcome-card';
    card.innerHTML = `
      <div class="outcome-title">
        <strong>Outcome ${index + 1}</strong>
        <span>${state.mode}-way market</span>
      </div>
      <div class="outcome-fields">
        <label><span>Selection</span><input class="selection-input" data-index="${index}" value="${escapeHtml(outcome.selection)}" /></label>
        <label><span>Decimal Odds</span><input class="odds-input" data-index="${index}" type="number" min="1.01" step="0.01" value="${outcome.odds}" /></label>
        <label style="grid-column:1/-1"><span>Bookmaker</span><input class="bookmaker-input" data-index="${index}" value="${escapeHtml(outcome.bookmaker)}" /></label>
      </div>`;
    els.outcomes.appendChild(card);
  });
}

function readInputs() {
  document.querySelectorAll('.selection-input').forEach(input => {
    state.outcomes[Number(input.dataset.index)].selection = input.value.trim() || `Outcome ${Number(input.dataset.index) + 1}`;
  });
  document.querySelectorAll('.bookmaker-input').forEach(input => {
    state.outcomes[Number(input.dataset.index)].bookmaker = input.value.trim() || `Bookmaker ${Number(input.dataset.index) + 1}`;
  });
  document.querySelectorAll('.odds-input').forEach(input => {
    state.outcomes[Number(input.dataset.index)].odds = Number(input.value);
  });
}

function roundedStakePlan(totalStake, odds, inverseSum) {
  const raw = odds.map(odd => (totalStake * (1 / odd)) / inverseSum);
  let used = 0;
  return raw.map((stake, index) => {
    const rounded = index === raw.length - 1
      ? Math.round((totalStake - used) * 100) / 100
      : Math.round(stake * 100) / 100;
    used += rounded;
    return rounded;
  });
}

function calculate() {
  readInputs();
  const totalStake = Number(els.totalStake.value);
  const odds = state.outcomes.map(o => o.odds);

  const invalid = !Number.isFinite(totalStake) || totalStake <= 0 || odds.some(o => !Number.isFinite(o) || o <= 1);
  if (invalid) return showInvalid();

  const inverseSum = odds.reduce((sum, odd) => sum + (1 / odd), 0);
  const stakes = roundedStakePlan(totalStake, odds, inverseSum);
  const payouts = stakes.map((stake, i) => stake * odds[i]);
  const guaranteedPayout = Math.min(...payouts);
  const profit = guaranteedPayout - totalStake;
  const roi = (profit / totalStake) * 100;
  const isArb = inverseSum < 1 && profit > 0;

  els.arbIndex.textContent = inverseSum.toFixed(4);
  els.guaranteedPayout.textContent = formatMoney(guaranteedPayout);
  els.estimatedProfit.textContent = formatMoney(profit);
  els.roiValue.textContent = `${roi.toFixed(2)}%`;
  els.arbStatus.textContent = isArb ? 'Arbitrage opportunity found' : 'No arbitrage at these odds';
  els.roiBadge.textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
  els.roiBadge.className = `roi-badge ${isArb ? 'good' : 'bad'}`;

  els.stakePlan.className = 'stake-plan';
  els.stakePlan.innerHTML = '';
  stakes.forEach((stake, index) => {
    const row = document.createElement('div');
    row.className = 'stake-row';
    row.innerHTML = `
      <div>
        <div class="book">${escapeHtml(state.outcomes[index].bookmaker)}</div>
        <div class="selection">${escapeHtml(state.outcomes[index].selection)} @ ${state.outcomes[index].odds.toFixed(2)}</div>
      </div>
      <div class="stake-right"><strong>${formatMoney(stake)}</strong><small>Payout ${formatMoney(payouts[index])}</small></div>`;
    els.stakePlan.appendChild(row);
  });
}

function showInvalid() {
  els.arbStatus.textContent = 'Check the stake and odds';
  els.roiBadge.textContent = 'Invalid';
  els.roiBadge.className = 'roi-badge bad';
  els.arbIndex.textContent = '—';
  els.guaranteedPayout.textContent = '—';
  els.estimatedProfit.textContent = '—';
  els.roiValue.textContent = '—';
  els.stakePlan.className = 'stake-plan empty-state';
  els.stakePlan.textContent = 'Use decimal odds greater than 1.00 and a positive total stake.';
}

function clearResult() {
  els.arbStatus.textContent = 'Enter odds to calculate';
  els.roiBadge.textContent = '—';
  els.roiBadge.className = 'roi-badge neutral';
  els.arbIndex.textContent = '—';
  els.guaranteedPayout.textContent = '—';
  els.estimatedProfit.textContent = '—';
  els.roiValue.textContent = '—';
  els.stakePlan.className = 'stake-plan empty-state';
  els.stakePlan.textContent = 'Run a calculation to see the stake split.';
}

function setMode(mode) {
  state.mode = mode;
  state.outcomes = defaultOutcomes(mode);
  els.twoWayBtn.classList.toggle('active', mode === 2);
  els.threeWayBtn.classList.toggle('active', mode === 3);
  renderOutcomes();
  clearResult();
}

function resetAll() {
  document.getElementById('eventName').value = '';
  document.getElementById('marketName').value = 'Match Winner';
  els.totalStake.value = '1000';
  setMode(2);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

els.twoWayBtn.addEventListener('click', () => setMode(2));
els.threeWayBtn.addEventListener('click', () => setMode(3));
els.calculateBtn.addEventListener('click', calculate);
els.resetBtn.addEventListener('click', resetAll);
els.totalStake.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList?.contains('odds-input')) calculate();
});

document.querySelectorAll('[data-scroll]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

renderOutcomes();
