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
vm.runInNewContext(js+'\nthis.testEngine={eventObj,merge,priceAudit,arb,bookmakerName,same,entainCardSelections};',env,{filename:'api/arbitrage.js'});
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
test('sport filter values are compatible with the actual engine',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../api/sports.js'),'utf8');
 const aliases=new Map([
 ['nba','basketball'],['mlb','baseball'],['ncaaf','nfl'],
 ['soccer_epl','soccer'],['soccer_mls','soccer']
 ]);
 const options=[...source.matchAll(/\{key:'([a-z_]+)',title:/g)].map(m=>m[1]);
 assert.ok(options.length>=7,'expected multiple real sport filters');
 for(const key of options)assert.ok(['basketball','baseball','soccer','nfl','nhl','tennis','afl','nrl','cricket'].includes(aliases.get(key)||key),key+' not mapped to live engine');
});
test('fixture matching does not combine rival teams in same city or distant starting times',()=>{
 const same=E.same;
 assert.equal(same('New York Jets','New York Giants'),false);
 assert.equal(same('NY Jets','New York Jets'),true);
 const a=fixture('Neds','New York Jets','Cleveland Browns',[['home',2.0],['away',1.9]],'nfl');
 const late=E.eventObj('nfl','NY Jets','Cleveland Browns',new Date(Date.now()+24*60*60*1000+42*60000).toISOString(),'Ladbrokes AU',[{role:'home',odds:2.2},{role:'away',odds:1.8}],'test');
 assert.equal(E.merge([a,late]).length,2);
});
test('SockOdds HTTP 429 honors Retry-After without repeated calls to the same function instance',async()=>{
 const scope={console,Date,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,process:{env:{SOCKODDS_API_KEY:'test-key'}},calls:0};
 scope.fetch=async()=>{scope.calls++;return {status:429,ok:false,headers:{get:k=>k==='retry-after'?'120':null}}};
 vm.runInNewContext(js+'\nthis.sockOdds=sockOdds',scope);
 const a=await scope.sockOdds(),b=await scope.sockOdds();
 assert.match(a.error,/rate limit/);
 assert.equal(b.error,a.error);
 assert.equal(scope.calls,1);
 assert.ok(Date.parse(a.retry_at)>Date.now());
});
test('Entain market identifiers prevent half-time and unrelated price leakage',()=>{
 const card={
  markets:{half:{id:'half',name:'1st Half Match Betting',entrant_ids:['hh','ha']},full:{id:'full',name:'Match Betting',entrant_ids:['h','d','a']}},
  entrants:{hh:{id:'hh',name:'Arsenal'},ha:{id:'ha',name:'Chelsea'},h:{id:'h',name:'Arsenal'},d:{id:'d',name:'Draw'},a:{id:'a',name:'Chelsea'}},
  prices:{
   'half:hh':{market_id:'half',entrant_id:'hh',odds:{numerator:20,denominator:1}},
   'half:ha':{market_id:'half',entrant_id:'ha',odds:{numerator:20,denominator:1}},
   'full:h':{market_id:'full',entrant_id:'h',odds:{numerator:11,denominator:10}},
   'full:d':{market_id:'full',entrant_id:'d',odds:{numerator:22,denominator:10}},
   'full:a':{market_id:'full',entrant_id:'a',odds:{numerator:19,denominator:10}},
  }
 };
 const prices=E.entainCardSelections(card,'Arsenal','Chelsea','soccer');
 assert.equal(prices.length,3);
 assert.ok(prices.every(p=>p.odds<10));
 assert.equal(E.entainCardSelections({...card,markets:{half:card.markets.half}},'Arsenal','Chelsea','soccer').length,0);
});
test('frontend has one comparison request per scan, with same payload shared to board',()=>{
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(front,/params\.set\('debug', '1'\)/);
 assert.match(front,/arb:scan/);
 assert.doesNotMatch(page,/fetch\('\/api\/arbitrage\?/);
 assert.match(page,/addEventListener\('arb:scan'/);
});
