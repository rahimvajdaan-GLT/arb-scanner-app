const ENGINE = 'open-books-v2';
const FUTURE_BUFFER_MS = 20 * 60 * 1000;

const SPORTS = {
  nfl:{p:889,d:88808}, ncaaf:{p:880,d:87637},
  nba:{p:487,d:42648,b:3}, ncaab:{p:493,d:92483,b:3},
  mlb:{p:246,d:84240}, nhl:{p:1456,d:42133,b:2},
  ufc:{p:8676,d:9034}, boxing:{p:1424,d:9033},
  soccer_epl:{p:1980,d:40253,b:1}, soccer_laliga:{p:2196,d:40031,b:1},
  soccer_bundesliga:{p:1842,d:40029,b:1}, soccer_seriea:{p:2436,d:40030,b:1},
  soccer_ligue1:{p:2036,d:40032,b:1}, soccer_mls:{p:2143,d:40828,b:1},
  soccer_uefa_champs_league:{p:2627,d:40685,b:1},
  soccer_uefa_europa_league:{p:2630,d:40688,b:1},
  tennis_atp:{p:2417,d:39992,b:4}, tennis_wta:{p:2421,d:39993,b:4},
};
const DEFAULT_SPORTS=['soccer_epl','soccer_laliga','soccer_bundesliga','soccer_seriea','soccer_ligue1','soccer_uefa_champs_league','nba','nhl','tennis_atp','tennis_wta'];
const PIN='https://guest.api.arcadia.pinnacle.com/0.1';
const DK='https://sportsbook.draftkings.com/sites/US-SB/api/v5';
const LB='https://linebet.com/service-api/LineFeed/Get1x2_VZip';
const BASE_HEADERS={'Accept':'application/json','User-Agent':'Mozilla/5.0 Chrome/124 Safari/537.36'};
const PIN_HEADERS={...BASE_HEADERS,'X-API-Key':'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R','Referer':'https://www.pinnacle.com/','Origin':'https://www.pinnacle.com'};
const LB_HEADERS={...BASE_HEADERS,'Referer':'https://linebet.com/en/line/football','Origin':'https://linebet.com','x-svc-source':'__BETTING_APP__','x-app-n':'__BETTING_APP__','x-requested-with':'XMLHttpRequest','is-srv':'false'};

async function json(url,headers=BASE_HEADERS){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),8500);
  try{const r=await fetch(url,{headers,signal:c.signal,redirect:'follow'});const body=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}${body?`: ${body.slice(0,100)}`:''}`);try{return JSON.parse(body)}catch{throw new Error(`Invalid JSON from ${new URL(url).hostname}`)}}finally{clearTimeout(t)}
}
function ms(v){if(typeof v==='number'&&Number.isFinite(v))return v>1e12?v:v*1000;const s=String(v||'');if(/^\d{10,13}$/.test(s)){const n=Number(s);return n>1e12?n:n*1000}const t=Date.parse(s);return Number.isFinite(t)?t:NaN}
function iso(v){const t=ms(v);return Number.isFinite(t)?new Date(t).toISOString():null}
function american(v){const n=Number(v);if(!Number.isFinite(n)||n===0)return null;return n>0?n/100+1:100/Math.abs(n)+1}
function norm(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|ac|club|the)\b/g,' ').replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function same(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true;const A=new Set(x.split(' ')),B=new Set(y.split(' '));return [...A].filter(t=>B.has(t)).length/Math.max(A.size,B.size,1)>=.6}
function team(v){return typeof v==='string'?v:(v?.N||v?.name||'')}
function fullPeriod(sport,p){p=Number(p);return ['nba','ncaab'].includes(sport)?(p===0||p===3):p===0}

async function pinnacle(sport,id){
  if(!id)return[];const [matches,markets]=await Promise.all([json(`${PIN}/leagues/${id}/matchups?brandId=0`,PIN_HEADERS),json(`${PIN}/leagues/${id}/markets/straight?primaryOnly=false`,PIN_HEADERS)]);if(!Array.isArray(matches)||!Array.isArray(markets))return[];
  const by=new Map();for(const m of markets){if(String(m?.type||'').toLowerCase()!=='moneyline'||!fullPeriod(sport,m?.period))continue;if(!by.has(m.matchupId))by.set(m.matchupId,[]);by.get(m.matchupId).push(m)}
  const out=[];for(const m of matches){if(!m||m.parent||m.type==='special')continue;const home=m.participants?.find(x=>x?.alignment==='home')?.name,away=m.participants?.find(x=>x?.alignment==='away')?.name,time=iso(m.startTime);if(!home||!away||!time)continue;const prices=[];for(const mk of by.get(m.id)||[])for(const p of mk.prices||[]){const d=String(p?.designation||'').toLowerCase(),odds=american(p?.price);if(!odds)continue;const role=d==='home'?'home':d==='away'?'away':(d==='draw'||d==='tie')?'draw':null;if(role)prices.push({role,odds,book:'Pinnacle'})}if(prices.length>=2)out.push({sport,home,away,time,book:'Pinnacle',prices})}return out;
}
function moneyline(label,cat){const s=`${label||''} ${cat||''}`.toLowerCase();return /moneyline|money line|match winner|3-way|3 way|winner|to win/.test(s)&&!/first|half|quarter|period|set /.test(s)}
async function draftkings(sport,id){
  if(!id)return[];const data=await json(`${DK}/eventgroups/${id}?format=json`),root=data?.eventGroup||data,events=root?.events||[],cats=root?.offerCategories||[],offers=new Map();for(const cat of cats)for(const desc of cat?.offerSubcategoryDescriptors||[])for(const list of desc?.offerSubcategory?.offers||[])for(const o of Array.isArray(list)?list:[]){if(!o?.eventId||!moneyline(o?.label,cat?.name))continue;if(!offers.has(o.eventId))offers.set(o.eventId,[]);offers.get(o.eventId).push(o)}
  const out=[];for(const e of events){const home=e?.teamName1||e?.team1,away=e?.teamName2||e?.team2,time=iso(e?.startDate);if(!home||!away||!time)continue;const prices=[];for(const o of offers.get(e.eventId)||[])for(const p of o?.outcomes||[]){const odds=Number(p?.oddsDecimal),name=String(p?.label||p?.participant||'');if(!Number.isFinite(odds)||odds<=1)continue;const role=same(name,home)?'home':same(name,away)?'away':/^(draw|tie)$/i.test(name)?'draw':null;if(role)prices.push({role,odds,book:'DraftKings'})}if(prices.length>=2)out.push({sport,home,away,time,book:'DraftKings',prices})}return out;
}
async function linebet(sport,id){
  if(!id)return[];const q=new URLSearchParams({count:'100',lng:'en',mode:'4',country:'87',partner:'189',gr:'650',sports:String(id),virtualSports:'false',noFilterBlockEvent:'true'});const data=await json(`${LB}?${q}`,LB_HEADERS),rows=Array.isArray(data?.Value)?data.Value:[],out=[];for(const e of rows){const home=team(e?.O1),away=team(e?.O2),time=iso(e?.S);if(!home||!away||!time)continue;const prices=[];for(const p of e?.E||[]){if(Number(p?.G)!==1)continue;const t=Number(p?.T),odds=Number(p?.C??p?.P);if(!Number.isFinite(odds)||odds<=1)continue;const role=t===1?'home':t===2?'draw':t===3?'away':null;if(role)prices.push({role,odds,book:'Linebet'})}if(prices.length>=2)out.push({sport,home,away,time,book:'Linebet',prices})}return out;
}
function findBucket(buckets,e){const t=ms(e.time);return buckets.find(b=>b.sport===e.sport&&Math.abs(ms(b.time)-t)<=30*60e3&&((same(b.home,e.home)&&same(b.away,e.away))||(same(b.home,e.away)&&same(b.away,e.home))))}
function merge(events){const buckets=[];for(const e of events){let b=findBucket(buckets,e);if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,prices:[],books:new Set()};buckets.push(b)}b.books.add(e.book);for(const p of e.prices){let role=p.role;if(same(e.home,b.away)&&same(e.away,b.home))role=role==='home'?'away':role==='away'?'home':role;b.prices.push({...p,role})}}return buckets}
function arb(b){const best={home:null,draw:null,away:null};for(const p of b.prices)if(!best[p.role]||p.odds>best[p.role].odds)best[p.role]=p;const roles=b.prices.some(p=>p.role==='draw')?['home','draw','away']:['home','away'];if(roles.some(r=>!best[r]))return null;const picks=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book}));if(new Set(picks.map(x=>x.best_bookmaker)).size<2)return null;const inv=picks.reduce((s,x)=>s+1/x.best_price,0);if(!Number.isFinite(inv)||inv>=1)return null;const roi=(1/inv-1)*100;return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(ms(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:'open_books',is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:picks,optimal_stakes:picks.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))}}
async function scan(key,diag=false){const c=SPORTS[key];if(!c)return diag?{events:[],providers:[]}:[];const defs=[['Pinnacle',()=>pinnacle(key,c.p)],['DraftKings',()=>draftkings(key,c.d)],...(c.b?[['Linebet',()=>linebet(key,c.b)]]:[])],settled=await Promise.allSettled(defs.map(x=>x[1]())),providers=settled.map((r,i)=>({provider:defs[i][0],ok:r.status==='fulfilled',events:r.status==='fulfilled'?r.value.length:0,error:r.status==='rejected'?String(r.reason?.message||r.reason).slice(0,220):null})),events=settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);return diag?{events,providers}:events}

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  const sport=typeof req.query.sport_key==='string'?req.query.sport_key.trim():'',mode=typeof req.query.market_mode==='string'?req.query.market_mode.toLowerCase():'all',debug=String(req.query.debug||'')==='1';
  if(sport&&!SPORTS[sport])return res.status(400).json({error:`Unsupported sport_key: ${sport}`});if(!['all','h2h','lines','spreads','totals'].includes(mode))return res.status(400).json({error:'Unsupported market_mode'});if(!['all','h2h'].includes(mode)&&!debug)return res.status(200).json([]);
  try{const keys=sport?[sport]:DEFAULT_SPORTS;if(debug){const sample=sport?keys:keys.slice(0,4),s=await Promise.all(sample.map(k=>scan(k,true)));return res.status(200).json({engine:ENGINE,sports:sample.map((k,i)=>({sport_key:k,providers:s[i].providers,total_events:s[i].events.length}))})}const groups=await Promise.all(keys.map(k=>scan(k,false))),merged=merge(groups.flat()).filter(x=>ms(x.time)>Date.now()+FUTURE_BUFFER_MS),arbs=merged.map(arb).filter(Boolean).sort((a,b)=>Number(b.arb_pct)-Number(a.arb_pct)||ms(a.commence_time)-ms(b.commence_time)).slice(0,50);res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Odds-Engine',ENGINE);res.setHeader('X-Odds-Providers','Pinnacle,DraftKings,Linebet');res.setHeader('X-Merged-Events',String(merged.filter(x=>x.books?.size>=2).length));return res.status(200).json(arbs)}catch(e){return res.status(500).json({error:'Open odds scan failed',detail:e?.message||String(e),engine:ENGINE})}
}
