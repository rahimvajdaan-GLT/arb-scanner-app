const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pages=['index.html','scanner.html','bookmakers.html','about.html','how-it-works.html','faq.html','pricing.html','contact.html','privacy.html','terms.html','responsible-gambling.html','login.html','account.html'];
function read(name){return fs.readFileSync(path.join(root,name),'utf8')}
test('site pages exist and consistently identify Top Notch Arb',()=>{
 for(const p of pages){
  const html=read(p);
  assert.match(html,/Top Notch Arb/,p+' is missing brand');
  assert.doesNotMatch(html,/Kaka Arb/,p+' contains old branding');
  assert.match(html,/<meta name="viewport"/,p+' missing responsive meta');
  assert.match(html,/<title>[^<]+<\/title>/,p+' missing page title');
 }
});
test('all local navigation and static asset links resolve inside the project',()=>{
 for(const page of pages){
  const html=read(page);
  for(const m of html.matchAll(/(?:href|src)=["'](\/[^"'?#]*)(?:[?#][^"']*)?["']/g)){
   const uri=m[1];if(uri==='/')continue;
   assert.ok(fs.existsSync(path.join(root,decodeURI(uri).replace(/^\//,''))),page+' has broken link '+uri);
  }
 }
});
test('scanner renders positive-only results and a transparent scan summary',()=>{
 const html=read('scanner.html'),js=read('live.js');
 for(const id of ['scanLiveBtn','liveSport','liveMarket','liveStake','liveBooks','scanCoverageText','scanCoverageCount','feedDetails','liveResults','metricCount','feedDiagnostics'])
 assert.ok(html.includes('id="'+id+'"'),'Missing UI control '+id);
 assert.ok(js.includes("window.dispatchEvent(new CustomEvent('arb:scan'"),'scan results not connected to positive result cards');
 assert.ok(html.includes("window.addEventListener('arb:scan'"),'coverage summary not listening');
 assert.ok(js.includes("params.set('debug', '1')"),'required diagnostics missing');
 assert.ok(!html.includes("fetch('/api/arbitrage?"),'diagnostics must not fetch separately');
});
test('scanner provides a keyboard skip link to focusable main content',()=>{
 const html=read('scanner.html');
 assert.match(html,/<body><a class="scanner-skip-link" href="#scannerContent">Skip to scanner content<\/a><header/);
 assert.match(html,/<main class="main" id="scannerContent" tabindex="-1">/);
 assert.equal((html.match(/id="scannerContent"/g)||[]).length,1);
 assert.match(html,/\.scanner-skip-link\{[^}]*position:fixed;[^}]*z-index:100;[^}]*transform:translateY\(-200%\)/);
 assert.match(html,/\.scanner-skip-link:focus\{[^}]*transform:translateY\(0\);outline:3px solid #315fd8/);
 assert.match(html,/#scannerContent\{scroll-margin-top:100px\}/);
});
test('market selectors are honest about supported markets',()=>{
 const html=read('scanner.html');
 assert.match(html,/<option value="spreads" disabled>/);
 assert.match(html,/<option value="totals" disabled>/);
});
test('scanner switches retain native keyboard access and a visible focus indicator',()=>{
 const html=read('scanner.html'),css=read('styles.css');
 for(const id of ['liveExtraFeed','liveOddsApi','autoRefresh']){
  assert.match(html,new RegExp('<label class="toggle-row" for="'+id+'"><input id="'+id+'" type="checkbox"><span class="toggle-ui">'));
 }
 const rules=[...css.matchAll(/\.toggle-row input\{([^}]+)\}/g)];
 const effectiveRule=rules.at(-1)?.[1]||'';
 assert.match(effectiveRule,/display:block/,'checkbox must remain in the accessibility tree');
 assert.match(effectiveRule,/position:absolute/);
 assert.match(effectiveRule,/clip-path:inset\(50%\)/,'hide visually without disabling keyboard access');
 assert.doesNotMatch(effectiveRule,/display:none|visibility:hidden/);
 assert.match(css,/\.toggle-row input:focus-visible\+\.toggle-ui\{[^}]*outline:3px solid #315fd8;outline-offset:3px/);
});
test('no credentials or API keys embedded in the client',()=>{
 for(const p of pages){
  const html=read(p);
  assert.doesNotMatch(html,/SOCKODDS_API_KEY|KAKA_ARB_AUTH_SECRET/,'Do not expose secrets in '+p);
 }
});
