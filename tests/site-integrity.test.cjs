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
test('scanner renders a comparison board and one scan button',()=>{
 const html=read('scanner.html'),js=read('live.js');
 for(const id of ['scanLiveBtn','liveSport','liveMarket','liveStake','liveBooks','comparisonRows','comparisonCount','liveResults','metricCount','feedDiagnostics'])
 assert.ok(html.includes('id="'+id+'"'),'Missing UI control '+id);
 assert.ok(js.includes("window.dispatchEvent(new CustomEvent('arb:scan'"),'scan results not connected to price board');
 assert.ok(html.includes("window.addEventListener('arb:scan'"),'price board not listening');
 assert.ok(js.includes("params.set('debug', '1')"),'required diagnostics missing');
 assert.ok(!html.includes("fetch('/api/arbitrage?"),'diagnostics must not fetch separately');
});
test('market selectors are honest about supported markets',()=>{
 const html=read('scanner.html');
 assert.match(html,/<option value="spreads" disabled>/);
 assert.match(html,/<option value="totals" disabled>/);
});
test('no credentials or API keys embedded in the client',()=>{
 for(const p of pages){
  const html=read(p);
  assert.doesNotMatch(html,/SOCKODDS_API_KEY|KAKA_ARB_AUTH_SECRET/,'Do not expose secrets in '+p);
 }
});
