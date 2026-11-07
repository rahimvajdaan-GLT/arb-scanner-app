/* Game coverage board: uses the same diagnostic response as the arb scanner.
   Never marks non-profitable quotes as arbitrage or starts additional API calls. */
(() => {
  const root = document.getElementById('gamesBoard');
  const summary = document.getElementById('gamesBoardSummary');
  const mode = document.getElementById('gamesBoardMode');
  let snapshot = null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function show(data) {
    if (!root || !summary || !mode) return;
    const comparisons = Array.isArray(data?.comparisons) ? data.comparisons : [];
    const singles = Array.isArray(data?.single_book_games) ? data.single_book_games : [];
    const all = [...comparisons.map(x=>({...x,kind:'comparison'})), ...singles.map(x=>({...x,kind:'single'}))];
    const filtered = mode.value === 'compare' ? all.filter(x=>x.kind==='comparison') :
      mode.value === 'single' ? all.filter(x=>x.kind==='single') : all;
    const active = Number(data?.merged_games)||0, compared=Number(data?.comparable_markets)||0;
    summary.textContent = active+' games sampled · '+compared+' comparable markets · '+(Number(data?.arbs)||0)+' positive arbs · '+(data?.active_bookmaker_count||0)+' bookmakers. '+(data?.scan_scope||'');
    if (!filtered.length) {
      root.innerHTML = '<p class="comparison-empty">No usable game prices returned for this view. Open Feed health & scan details to see provider errors and limits.</p>';
      return;
    }
    root.innerHTML = filtered.slice(0,60).map(game=>{
      const prices = game.all_bookmaker_prices || {};
      const roles = ['home','draw','away'].filter(role=>Array.isArray(prices[role])&&prices[role].length);
      const best = roles.map(role=>{
        const offers=[...prices[role]].filter(x=>Number(x.odds)>1).sort((a,b)=>Number(b.odds)-Number(a.odds));
        const top=offers[0];
        if(!top)return '';
        return '<div class="comparison-price"><span>'+escapeHtml(role.toUpperCase())+' · best price</span><strong>'+Number(top.odds).toFixed(2)+'</strong><small>'+escapeHtml(top.book)+'</small></div>';
      }).join('');
      const roi=Number(game.roi_pct);
      const badge=game.kind==='single' ? 'One bookmaker · no arb comparison' : Number.isFinite(roi)&&roi>0 ? 'Potential arb · verify' : 'No positive arb';
      const allBooks=roles.map(role=>'<div><strong>'+escapeHtml(role.toUpperCase())+'</strong>'+[...prices[role]].sort((a,b)=>Number(b.odds)-Number(a.odds)).map(x=>'<div class="comparison-quote"><span>'+escapeHtml(x.book)+'</span><b>'+Number(x.odds).toFixed(2)+'</b></div>').join('')+'</div>').join('');
      const when=game.commence_time ? new Date(game.commence_time).toLocaleString() : 'Start time unavailable';
      return '<article class="comparison-card"><div class="comparison-card-head"><strong>'+escapeHtml(game.fixture)+'</strong><span class="comparison-roi unknown">'+escapeHtml(badge)+'</span></div><div class="comparison-meta">'+escapeHtml(game.sport)+' · '+escapeHtml(when)+' · '+escapeHtml(game.bookmaker_count)+' bookmaker(s)</div><div class="comparison-prices">'+best+'</div><details class="comparison-more"><summary>All available bookmaker quotes</summary><div class="comparison-quote-grid">'+allBooks+'</div></details></article>';
    }).join('');
  }
  mode?.addEventListener('change',()=>snapshot&&show(snapshot));
  window.addEventListener('arb:scan',e=>{snapshot=e.detail;show(snapshot)});
  window.addEventListener('arb:scan-expired',()=>{snapshot=null;if(root)root.innerHTML='<p class="comparison-empty">Quotes expired. Run another scan for current games.</p>';if(summary)summary.textContent='Previous scan expired.'});
  window.addEventListener('arb:scan-error',()=>{snapshot=null;if(root)root.innerHTML='<p class="comparison-empty">No current games: odds source request failed. Check feed health below.</p>';if(summary)summary.textContent='Scan unavailable.'});
})();
