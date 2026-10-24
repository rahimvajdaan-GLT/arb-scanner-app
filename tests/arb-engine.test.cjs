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
vm.runInNewContext(js+'\nthis.testEngine={eventObj,merge,priceAudit,arb,bookmakerName,same,entainCardSelections,krokEvents,krokSportRow,theOddsConvert,sampleRotating,samplePreferred};',env,{filename:'api/arbitrage.js'});
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

test('incomplete soccer moneyline is excluded rather than mislabelled as a two-way arb',()=>{
 const two=fixture('TAB','Arsenal','Chelsea',[['home',2.3],['away',2.5]],'soccer');
 assert.equal(two,null,'soccer full-time winner must include draw');
 const three=fixture('TAB','Arsenal','Chelsea',[['home',2.3],['draw',3.3],['away',2.5]],'soccer');
 assert.ok(three);
});
test('frontend invalidates old quotes and refreshes the versioned script',()=>{
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(front,/MAX_QUOTE_AGE_MS = 2 \* 60 \* 1000/);
 assert.match(front,/latestEvents = \[\];/);
 assert.match(html,/arb:scan-expired/);
 assert.match(html,/live\.js\?v=43/);
});

test('nested Entain event cards with decimal numeric odds yield two valid selections',()=>{
 const payload={data:{event:{
   markets:{main:{id:'main',name:'Match Winner',entrant_ids:['h','a']}},
   entrants:{h:{id:'h',name:'Lakers'},a:{id:'a',name:'Celtics'}},
   prices:{'main:h':{market_id:'main',entrant_id:'h',odds:1.91},'main:a':{market_id:'main',entrant_id:'a',odds:1.96}}
 }}};
 const found=E.entainCardSelections(payload,'Lakers','Celtics','basketball');
 assert.equal(found.length,2);
 assert.equal(found[0].odds,1.91);
});
test('period winner markets are not misclassified as full-match odds',()=>{
 const card={
  markets:{first:{id:'first',name:'1st Period Match Winner',entrant_ids:['h','a']}},
  entrants:{h:{id:'h',name:'Lakers'},a:{id:'a',name:'Celtics'}},
  prices:{'first:h':{market_id:'first',entrant_id:'h',odds:1.91},'first:a':{market_id:'first',entrant_id:'a',odds:1.96}}
 };
 assert.equal(E.entainCardSelections(card,'Lakers','Celtics','basketball').length,0);
});

test('AFL market-ID entrant-to-price link excludes other markets',()=>{
 const card={
  markets:{match:{id:'match',name:'Match Betting'},prop:{id:'prop',name:'Anytime Goal Kicker'}},
  entrants:{
   a:{id:'a',name:'Geelong Cats',market_id:'match'},
   b:{id:'b',name:'Carlton Blues',market_id:'match'},
   p:{id:'p',name:'Geelong Cats',market_id:'prop'}
  },
  prices:{
   a:{odds:{numerator:19,denominator:20}},
   b:{odds:{numerator:1,denominator:1}},
   p:{odds:{numerator:50,denominator:1}}
  }
 };
 const selections=E.entainCardSelections(card,'Geelong Cats','Carlton Blues','afl');
 assert.equal(selections.length,2);
 assert.equal(selections[0].odds,1.95);
 assert.equal(selections[1].odds,2);
});

test('optional aggregator accepts fresh h2h prices and excludes period markets',()=>{
 const t=new Date(Date.now()+24*3600000).toISOString();
 const c=new Date().toISOString();
 const rows={data:[
  {home:'Geelong Cats',away:'Carlton Blues',start_time:t,captured_at:c,bookmaker:'TAB',markets:[{key:'h2h',name:'Match Betting',selections:[{name:'Geelong Cats',price:2.1},{name:'Carlton Blues',price:1.8}]}]},
  {home:'Geelong Cats',away:'Carlton Blues',start_time:t,captured_at:c,bookmaker:'Sportsbet',markets:[{key:'h2h',name:'1st Half Match Betting',selections:[{name:'Geelong Cats',price:22},{name:'Carlton Blues',price:22}]}]},
  {home:'Geelong Cats',away:'Carlton Blues',start_time:t,captured_at:new Date(Date.now()-3600000).toISOString(),bookmaker:'Ladbrokes',markets:[{key:'h2h',name:'Match Betting',selections:[{name:'Geelong Cats',price:30},{name:'Carlton Blues',price:30}]}]}
 ]};
 const result=E.krokEvents(rows,'afl');
 assert.equal(result.events.length,1);
 assert.equal(result.stale,1);
 assert.equal(result.events[0].book,'TAB');
});
test('optional aggregator sport lookup uses documented sport index',()=>{
 const rows=[{sport:'aussie-rules',href:'/api/v1/odds-feed/sports/aussie-rules'}, {sport:'basketball-nba',href:'/api/v1/odds-feed/sports/basketball-nba'}];
 assert.equal(E.krokSportRow(rows,'afl').sport,'aussie-rules');
 assert.equal(E.krokSportRow(rows,'basketball').sport,'basketball-nba');
});
test('extra feed only runs on user opt-in; auto refresh cannot drain free quota',()=>{
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(page,/id="liveExtraFeed"/);
 assert.match(front,/include_krok/);
 assert.match(front,/liveEls.extraFeed\.checked\) liveEls.autoRefresh.checked = false/);
 assert.match(page,/live\.js\?v=43/);
});

test('exclude exchange prices until commission and liquidity are modeled',()=>{
 const t=new Date(Date.now()+24*3600000).toISOString();
 const c=new Date().toISOString();
 const make=book=>({bookmaker:book,home:'Lakers',away:'Celtics',start_time:t,captured_at:c,markets:[{key:'h2h',name:'Match Betting',selections:[{name:'Lakers',price:2.3},{name:'Celtics',price:2.3}]}]});
 const values=E.krokEvents({data:[make('Betfair Exchange'),make('Sportsbet')]},'basketball');
 assert.equal(values.events.length,1);
 assert.equal(values.events[0].book,'Sportsbet');
});

test('The Odds API: valid Australian h2h quotes merge with canonical bookmaker names',()=>{
 const t=new Date(Date.now()+24*3600000).toISOString(),now=new Date().toISOString();
 const response=[{home_team:'Geelong Cats',away_team:'Carlton Blues',commence_time:t,bookmakers:[
  {key:'neds',title:'Neds',last_update:now,markets:[{key:'h2h',outcomes:[{name:'Geelong Cats',price:2.2},{name:'Carlton Blues',price:1.8}]}]},
  {key:'ladbrokes_au',title:'Ladbrokes',last_update:now,markets:[{key:'h2h',outcomes:[{name:'Geelong Cats',price:1.8},{name:'Carlton Blues',price:2.2}]}]}
 ]}];
 const parsed=E.theOddsConvert(response,'afl');
 assert.equal(parsed.events.length,2);
 assert.deepEqual([...parsed.bookmakers].sort(),['Ladbrokes AU','Neds']);
 assert.equal(E.merge(parsed.events).length,1);
 assert.ok(E.arb(E.merge(parsed.events)[0]));
});
test('The Odds API excludes exchanges, stale updates and incompatible market rules',()=>{
 const t=new Date(Date.now()+24*3600000).toISOString(),now=new Date().toISOString();
 const pair=[{name:'Geelong Cats',price:2.3},{name:'Carlton Blues',price:2.3}];
 const data=[{home_team:'Geelong Cats',away_team:'Carlton Blues',commence_time:t,bookmakers:[
  {key:'betfair_ex_au',title:'Betfair Exchange',last_update:now,markets:[{key:'h2h',outcomes:pair}]},
  {key:'sportsbet',title:'Sportsbet',last_update:new Date(Date.now()-60*60000).toISOString(),markets:[{key:'h2h',outcomes:pair}]},
  {key:'tab',title:'TAB',last_update:now,markets:[{key:'spreads',outcomes:pair}]}
 ]}];
 const parsed=E.theOddsConvert(data,'afl');
 assert.equal(parsed.events.length,0);
 assert.equal(parsed.stale,1);
});
test('The Odds API optional source is manual, with no upfront call or public key',()=>{
 const backend=fs.readFileSync(path.join(__dirname,'../api/arbitrage.js'),'utf8');
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(backend,/if\(!enabled\)return \{events:\[\],configured,disabled:true\}/);
 assert.match(backend,/process\.env\.THE_ODDS_API_KEY/);
 assert.match(front,/include_odds_api/);
 assert.match(front,/liveEls\.oddsApi\.checked/);
 assert.match(page,/id="liveOddsApi"/);
 assert.match(page,/live\.js\?v=43/);
});

test('bookmaker fixture sample moves through different events between 15-minute windows',()=>{
 const items=Array.from({length:20},(_,i)=>({id:String(i)}));
 const a=E.sampleRotating(items,6,0),b=E.sampleRotating(items,6,15*60*1000);
 assert.equal(a.length,6);
 assert.equal(b.length,6);
 assert.notEqual(a[0].id,b[0].id);
 assert.equal(new Set(a.map(x=>x.id)).size,6);
});
test('matched competitor fixtures get priority before rotating other event cards',()=>{
 const t=new Date(Date.now()+24*60*60*1000).toISOString();
 const rows=Array.from({length:12},(_,i)=>({id:String(i),sport:'nhl',home:'Alpha '+i,away:'Beta '+i,time:t}));
 const priorities=E.samplePreferred(rows,6,[{sport:'nhl',home:'Alpha 8',away:'Beta 8',time:t}],0);
 assert.equal(priorities.length,6);
 assert.equal(priorities[0].id,'8');
});
test('sampling and API cache do not display impossible five-minute live quotes',()=>{
 const backend=fs.readFileSync(path.join(__dirname,'../api/arbitrage.js'),'utf8');
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 assert.match(backend,/s-maxage=90/);
 assert.match(front,/MAX_QUOTE_AGE_MS = 2 \* 60 \* 1000/);
 assert.match(backend,/limit:'10'/);
 assert.match(backend,/ENTAIN_CARDS_FILTERED=6/);
});
test('bookmaker comparison filtering uses the same input and supports new bookmaker chips',()=>{
 const front=fs.readFileSync(path.join(__dirname,'../live.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
 assert.match(front,/arb:book-filter/);
 assert.match(html,/addEventListener\('arb:book-filter'/);
 assert.match(html,/data-book="sportsbet"/);
 assert.match(html,/data-book="tab"/);
});

test('a bookmaker cannot offer impossible home and away prices combined from different feeds',()=>{
 const t=new Date(Date.now()+24*60*60*1000).toISOString();
 const e=(book,h,a,source)=>E.eventObj('afl','Geelong Cats','Carlton Blues',t,book,
  [{role:'home',odds:h},{role:'away',odds:a}],source);
 const old=e('Neds',2.2,1.7,'krok');
 const direct=e('Neds',1.7,2.0,'neds');
 const other=e('Ladbrokes AU',1.9,1.9,'ladbrokes au');
 const a=E.merge([old,direct,other])[0];
 assert.equal(a.books.size,2);
 assert.equal(a.offers.length,4,'only one coherent quote per bookmaker');
 assert.equal(a.offers.find(o=>o.book==='Neds'&&o.role==='home').odds,1.7);
 assert.equal(E.arb(a),null,'combined stale home price could create fake arbitrage');
});
test('direct bookmaker snapshot prevails even if an aggregator is processed last',()=>{
 const t=new Date(Date.now()+24*60*60*1000).toISOString();
 const e=(h,a,src)=>E.eventObj('nhl','Boston Bruins','New York Rangers',t,'Neds',
  [{role:'home',odds:h},{role:'away',odds:a}],src);
 const m=E.merge([e(1.85,1.9,'neds'),e(2.25,1.55,'the-odds-api')])[0];
 assert.equal(m.books.size,1);
 assert.equal(m.offers.find(x=>x.role==='home').odds,1.85);
});
test('PointsBet sport aliases support ice_hockey and aussie_rules feed keys',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../api/arbitrage.js'),'utf8');
 assert.match(src,/ice\[ _-\]\?hockey/);
 assert.match(src,/aussie\[ _-\]\?rules/);
});
