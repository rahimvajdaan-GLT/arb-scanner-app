const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Execute the complete client script with a minimal DOM and an isolated fetch.
// No request can reach a server, including the quota-consuming scan endpoint.
function scanner(){
 const elements=new Map(),requests=[],events=[];
 const document={
  getElementById(id){
   if(!elements.has(id))elements.set(id,{
    value:id==='liveStake'?'1000':'',checked:false,disabled:false,
    innerHTML:'',textContent:'',listeners:{},
    addEventListener(type,listener){this.listeners[type]=listener}
   });
   return elements.get(id);
  },
  querySelectorAll(){return []}
 };
 const context={document,URLSearchParams,AbortController,
  setInterval(){return 1},clearInterval(){},
  CustomEvent:class {constructor(type,options={}){this.type=type;this.detail=options.detail}},
  window:{dispatchEvent(event){events.push(event)}},
  fetch(url){
   if(url==='/api/sports')return Promise.resolve({ok:true,json:async()=>[]});
   assert.match(url,/^\/api\/arbitrage\?/);
   return new Promise(resolve=>requests.push({url,resolve}));
  }
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../live.js'),'utf8'),context,{filename:'live.js'});
 return {get:id=>document.getElementById(id),requests,events,
  scan:()=>document.getElementById('scanLiveBtn').listeners.click(),
  respond(body,ok=true){requests.at(-1).resolve({ok,headers:{get:()=> 'application/json'},json:async()=>body})}
 };
}

test('mocked scanner transitions from loading to an honest empty result',async()=>{
 const ui=scanner();
 const pending=ui.scan();
 assert.equal(ui.get('scanLiveBtn').disabled,true);
 assert.match(ui.get('scanLiveBtn').innerHTML,/Scanning/);
 assert.match(ui.get('liveResults').innerHTML,/loading-skeleton/);
 assert.match(ui.get('liveStatus').textContent,/Scanning pre-match/);
 ui.respond({results:[],providers:[{name:'fixture',events:3}]});
 await pending;
 assert.equal(ui.get('scanLiveBtn').disabled,false);
 assert.match(ui.get('liveResults').innerHTML,/No verified positive opportunities/);
 assert.doesNotMatch(ui.get('liveResults').innerHTML,/loading-skeleton|live-card|error-panel/);
 assert.equal(ui.get('metricCount').textContent,'0');
 assert.equal(ui.get('metricBestProfit').textContent,'—');
 assert.match(ui.get('liveStatus').textContent,/Recent bookmaker quotes/);
 assert.equal(ui.events.at(-1).type,'arb:scan');
 assert.equal(ui.requests.length,1);
});

test('mocked rate-limited providers are distinguished from a healthy empty scan',async()=>{
 const ui=scanner();
 const pending=ui.scan();
 ui.respond({results:[],providers:[{name:'fixture',events:0,error:'HTTP 429'}]});
 await pending;
 assert.match(ui.get('liveStatus').textContent,/Odds sources unavailable/);
 assert.match(ui.get('liveMessage').textContent,/unavailable or rate-limited/);
 assert.equal(ui.get('metricCount').textContent,'—');
 assert.equal(ui.get('scanLiveBtn').disabled,false);
 assert.doesNotMatch(ui.get('liveResults').innerHTML,/live-card/);
 assert.equal(ui.requests.length,1,'rate limits must not trigger an immediate retry');
});

test('empty scan explains insufficient cross-bookmaker coverage without another API call',async()=>{
 const ui=scanner();
 const pending=ui.scan();
 ui.respond({results:[],merged_games:18,cross_book_games:0,comparable_markets:0,providers:[{events:18}]});
 await pending;
 assert.match(ui.get('liveMessage').textContent,/Coverage is insufficient/);
 assert.match(ui.get('liveResults').innerHTML,/18 fixtures sampled · 0 cross-bookmaker matches/);
 assert.equal(ui.requests.length,1);
});

test('empty scan with comparable markets correctly reports no positive arbitrage',async()=>{
 const ui=scanner();
 const pending=ui.scan();
 ui.respond({results:[],merged_games:12,cross_book_games:4,comparable_markets:3,providers:[{events:12}]});
 await pending;
 assert.match(ui.get('liveMessage').textContent,/no positive rounded-stake arbitrage/);
 assert.match(ui.get('liveResults').innerHTML,/3 comparable markets/);
 assert.equal(ui.requests.length,1);
});

test('mocked scan failure clears loading and metrics, escapes errors and permits retry',async()=>{
 const ui=scanner();
 const pending=ui.scan();
 ui.respond({error:'Provider unavailable <script>alert(1)</script>'},false);
 await pending;
 assert.match(ui.get('liveResults').innerHTML,/Unable to complete scan/);
 assert.match(ui.get('liveResults').innerHTML,/&lt;script&gt;/);
 assert.doesNotMatch(ui.get('liveResults').innerHTML,/<script>|loading-skeleton|live-card/);
 for(const id of ['metricCount','metricBestRoi','metricBestProfit','metricLastScan'])
  assert.equal(ui.get(id).textContent,'—');
 assert.equal(ui.get('lastUpdated').textContent,'Scan unavailable');
 assert.equal(ui.get('scanLiveBtn').disabled,false);
 assert.equal(ui.events.at(-1).type,'arb:scan-error');
 const retry=ui.scan();
 ui.respond({results:[],providers:[{name:'fixture',events:1}]});
 await retry;
 assert.match(ui.get('liveResults').innerHTML,/No verified positive opportunities/);
 assert.doesNotMatch(ui.get('liveResults').innerHTML,/error-panel/);
 assert.equal(ui.get('metricCount').textContent,'0');
 assert.equal(ui.requests.length,2);
});
