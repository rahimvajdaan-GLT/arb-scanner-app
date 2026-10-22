// Regression coverage for zero-comparison bug, bookmaker aliases, and cross-book calculations.
// Run with: node --test tests/arb-engine.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../api/arbitrage.js'),'utf8')
 .replace('export default async function handler','async function handler');
const env={console,Date,URL,URLSearchParams,setTimeout,clearTimeout,process:{env:{}}};
vm.runInNewContext(js+'\nthis.testEngine={eventObj,merge,priceAudit,arb,bookmakerName};',env,{filename:'api/arbitrage.js'});
const E=env.testEngine;
const future=new Date(Date.now()+24*60*60*1000).toISOString();
function fixture(book,home,away,values,sport='basketball'){
 return E.eventObj(sport,home,away,future,book,values.map(([role,odds])=>({role,odds})),'test');
}
test('two bookmakers with identical odds remain visible but not profitable',()=>{
 const bucket=E.merge([
  fixture('Neds','Lakers','Celtics',[['home',1.80],['away',1.95]]),
  fixture('Ladbrokes AU','Lakers','Celtics',[['home',1.80],['away',1.95]])
 ])[0];
 const p=E.priceAudit(bucket);
 assert.ok(p,'comparison must exist even when highest prices come from same bookmaker');
 assert.equal(p.bookmaker_count,2);
 assert.ok(p.roi_pct<0);
 assert.equal(E.arb(bucket),null);
});
test('second-best bookmaker quote may complete positive cross-book arbitrage',()=>{
 const bucket=E.merge([
  fixture('PointsBet AU','Lakers','Celtics',[['home',2.30],['away',2.50]]),
  fixture('Neds','Lakers','Celtics',[['home',2.25],['away',1.50]]),
  fixture('Ladbrokes AU','Lakers','Celtics',[['home',1.50],['away',2.45]])
 ])[0];
 const a=E.arb(bucket);assert.ok(a);
 assert.ok(a.arb_pct>0);
 assert.equal(new Set(a.selections.map(s=>s.best_bookmaker)).size,2);
 assert.equal(E.priceAudit(bucket).bookmaker_count,3);
});
test('aliases from two feeds must not create artificial bookmakers',()=>{
 const bucket=E.merge([
  fixture('POINTSBET','Lakers','Celtics',[['home',2.5],['away',1.5]]),
  fixture('PointsBet AU','Lakers','Celtics',[['home',1.5],['away',2.5]])
 ])[0];
 assert.equal(bucket.books.size,1);
 assert.equal(E.priceAudit(bucket),null);
 assert.equal(E.arb(bucket),null);
});
test('three-outcome football comparison uses all home draw away outcomes',()=>{
 const bucket=E.merge([
  fixture('TAB','Arsenal','Chelsea',[['home',3.40],['draw',3.30],['away',2.40]],'soccer'),
  fixture('Sportsbet','Arsenal','Chelsea',[['home',2.70],['draw',3.90],['away',2.80]],'soccer')
 ])[0];
 const comparison=E.priceAudit(bucket),a=E.arb(bucket);
 assert.equal(comparison.outcomes,3);
 assert.ok(a&&a.arb_pct>0);
 assert.equal(a.selections.length,3);
});
test('frontend has one comparison request per scan, with same payload shared to board',()=>{
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(front,/params\.set\('debug', '1'\)/);
 assert.match(front,/arb:scan/);
 assert.doesNotMatch(page,/fetch\('\/api\/arbitrage\?/);
 assert.match(page,/addEventListener\('arb:scan'/);
});
