const ENGINE='au-openbooks-v12';
const FUTURE_BUFFER_MS=10*60*1000;
const MATCH_WINDOW_MS=3*60*60*1000;
const HEADERS={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept':'application/json, text/plain, */*','Accept-Language':'en-AU,en;q=0.9'};

const NEDS=[
 {key:'basketball',id:'3c34d075-dc14-436d-bfc4-9272a49c2b39',ref:'https://www.neds.com.au/sports/basketball/usa/nba'},
 {key:'nhl',id:'b7c1f944-d02b-4d9b-b6f3-cb31389cfe36',ref:'https://www.neds.com.au/sports/ice-hockey/usa/nhl'},
 {key:'afl',id:'23d497e6-8aab-4309-905b-9421f42c9bc5',ref:'https://www.neds.com.au/sports/australian-rules/afl'},
 {key:'cricket',id:'94984918-dbac-432b-b420-c219ec9203f4',ref:'https://www.neds.com.au/sports/cricket'},
 {key:'soccer',id:'71955b54-62f6-4ac5-abaa-df88cad0aeef',ref:'https://www.neds.com.au/sports/soccer/uk-ireland/premier-league'},
 {key:'baseball',id:'02721435-4671-4cd0-98f7-15d41ee4103e',ref:'https://www.neds.com.au/sports/baseball/usa/mlb'},
];
const ALIASES=new Map([['aussierules_afl','afl'],['basketball_nba','basketball'],['icehockey_nhl','nhl'],['soccer_epl','soccer'],['americanfootball_nfl','nfl']]);

async function getJson(url,extra={},timeout=15000){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(url,{headers:{...HEADERS,...extra},signal:c.signal,redirect:'follow',cache:'no-store'});
  const text=await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).hostname}${text?`: ${text.slice(0,140)}`:''}`);
  try{return JSON.parse(text)}catch{throw new Error(`Invalid JSON from ${new URL(url).hostname}`)}
 }finally{clearTimeout(t)}
}
function parseMs(v){
 if(typeof v==='number'&&Number.isFinite(v)) return v>1e12?v:v*1000;
 const s=String(v||'').trim(); if(!s)return NaN;
 if(/^\d{10,13}$/.test(s)){const n=Number(s);return n>1e12?n:n*1000}
 const t=Date.parse(s); return Number.isFinite(t)?t:NaN;
}
function firstTime(...vals){for(const v of vals){const t=parseMs(v);if(Number.isFinite(t))return new Date(t).toISOString()}return null}
function norm(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|club|the)\b/g,' ').replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function same(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true;const A=new Set(x.split(' ')),B=new Set(y.split(' '));return [...A].filter(z=>B.has(z)).length/Math.max(1,Math.min(A.size,B.size))>=.6}
function teams(name){const s=String(name||'');for(const sep of [' vs ',' v ',' @ ',' at ']){const re=new RegExp(`\\s${sep.trim()}\\s`,'i');if(!re.test(s))continue;const p=s.split(re);if(p.length<2)continue;if(['@','at'].includes(sep.trim()))return{home:p[1].trim(),away:p[0].trim()};return{home:p[0].trim(),away:p[1].trim()}}return null}
function dec(v){const n=Number(v);return Number.isFinite(n)&&n>1?n:null}
function role(name,h,a){if(same(name,h))return'home';if(same(name,a))return'away';if(/^(draw|tie)$/i.test(String(name||'')))return'draw';return null}
function sportOf(s){s=String(s||'').toLowerCase();if(/afl|australian/.test(s))return'afl';if(/cricket|big bash|ipl/.test(s))return'cricket';if(/basketball|nba|nbl/.test(s))return'basketball';if(/ice hockey|nhl/.test(s))return'nhl';if(/soccer|premier league|epl/.test(s))return'soccer';if(/baseball|mlb/.test(s))return'baseball';if(/nrl|rugby league/.test(s))return'nrl';if(/american football|nfl/.test(s))return'nfl';if(/tennis|atp|wta/.test(s))return'tennis';return'other'}
function eventObj(sport,h,a,time,book,sels,source){
 const iso=firstTime(time),tm=parseMs(iso);if(!h||!a||!Number.isFinite(tm)||tm<=Date.now()+FUTURE_BUFFER_MS)return null;
 const best=new Map();
 for(const s of sels||[]){const o=dec(s.odds),r=s.role||role(s.name,h,a);if(r&&o&&(!best.has(r)||o>best.get(r).odds))best.set(r,{market:'h2h',role:r,odds:o,point:null,book})}
 if(best.size<2)return null;
 return{sport,home:h,away:a,time:iso,book,offers:[...best.values()],source};
}

async function pointsBet(){
 const h={'Origin':'https://pointsbet.com.au','Referer':'https://pointsbet.com.au/'};
 const feed=await getJson('https://api.au.pointsbet.com/api/v2/events/nextup?v2Limit=60',h);
 const rows=Array.isArray(feed?.events)?feed.events:(Array.isArray(feed)?feed:[]);
 const upcoming=rows.filter(e=>e?.key&&e?.isLive!==true&&parseMs(e?.startsAt)>Date.now()+FUTURE_BUFFER_MS).slice(0,24);
 const details=await Promise.allSettled(upcoming.map(head=>getJson(`https://api.au.pointsbet.com/api/mes/v3/events/${encodeURIComponent(head.key)}`,h,16000).then(detail=>({head,detail}))));
 const out=[];
 for(const r of details){if(r.status!=='fulfilled')continue;const{head,detail}=r.value;
  const hh=typeof detail?.homeTeam==='string'?detail.homeTeam:(detail?.homeTeam?.name||head?.homeTeam?.name||head?.homeTeam);
  const aa=typeof detail?.awayTeam==='string'?detail.awayTeam:(detail?.awayTeam?.name||head?.awayTeam?.name||head?.awayTeam);
  const ta=hh&&aa?{home:hh,away:aa}:teams(detail?.name||head?.name);if(!ta)continue;
  const ms=Array.isArray(detail?.fixedOddsMarkets)?detail.fixedOddsMarkets:[];
  const m=ms.find(x=>/match result|match betting|head to head|moneyline|winner/i.test(String(x?.name||'')));if(!m)continue;
  const sels=(Array.isArray(m?.outcomes)?m.outcomes:[]).filter(o=>o?.isOpenForBetting!==false).map(o=>({name:o?.name,odds:o?.price}));
  const item=eventObj(sportOf(`${head?.sportKey||''} ${head?.competitionName||''} ${detail?.competitionName||''}`),ta.home,ta.away,detail?.startsAt||head?.startsAt,'PointsBet AU',sels,'pointsbet');
  if(item)out.push(item);
 }
 return out;
}

function nedsDecimal(x){if(x==null)return null;const d=dec(x?.decimal??x?.decimal_odds??x?.price??x?.returnWin);if(d)return d;const q=x?.odds||x;const n=Number(q?.numerator??q?.num),d2=Number(q?.denominator??q?.den);return Number.isFinite(n)&&Number.isFinite(d2)&&d2?1+n/d2:null}
function listEvents(p){const e=p?.events;if(Array.isArray(e))return e;if(e&&typeof e==='object')return Object.values(e);const d=p?.data?.events;if(Array.isArray(d))return d;if(d&&typeof d==='object')return Object.values(d);return[]}
function eid(e){const v=e?.id??e?.event_id??e?.eventId??e?.key;if(v==null)return null;const s=String(v);return s.includes(':')?s.split(':').pop():s}
function nedsTime(e,c){return firstTime(e?.start_time,e?.startTime,e?.starts_at,e?.startsAt,e?.advertised_start_time,e?.event_start_time,c?.event?.start_time,c?.event?.startTime,c?.event?.startsAt,c?.start_time,c?.startTime,c?.startsAt)}
function nedsSelections(card,h,a){
 const markets=Array.isArray(card?.markets)?card.markets:[], entrants=Array.isArray(card?.entrants)?card.entrants:[], prices=Array.isArray(card?.prices)?card.prices:[];
 const mm=new Map(markets.map(m=>[String(m?.id??m?.market_id??m?.marketId??''),String(m?.name??m?.display_name??'')]));
 const priceByEntrant=new Map();for(const p of prices){const id=p?.entrant_id??p?.entrantId??p?.selection_id??p?.selectionId;if(id!=null)priceByEntrant.set(String(id),p)}
 const out=[];
 for(let i=0;i<entrants.length;i++){const e=entrants[i],mid=String(e?.market_id??e?.marketId??''),mn=mm.get(mid)||'';if(!/match betting|head to head|match result|moneyline/i.test(mn))continue;
  const id=e?.id??e?.entrant_id??e?.entrantId,p=(id!=null?priceByEntrant.get(String(id)):null)||e?.price||prices[i],o=nedsDecimal(p),name=e?.name??e?.display_name,r=role(name,h,a);if(r&&o)out.push({name,role:r,odds:o});
 }
 if(out.length>=2)return out;
 for(const m of markets){if(!/match betting|head to head|match result|moneyline/i.test(String(m?.name??m?.display_name??'')))continue;for(const x of (m?.entrants||m?.selections||m?.outcomes||[])){const name=x?.name??x?.display_name,o=nedsDecimal(x?.price??x?.prices?.[0]??x),r=role(name,h,a);if(r&&o)out.push({name,role:r,odds:o})}}
 return out;
}
async function nedsCategory(meta){
 const h={'Origin':'https://www.neds.com.au','Referer':meta.ref};
 const encoded=encodeURIComponent(JSON.stringify([meta.id]));
 const list=await getJson(`https://api.neds.com.au/v2/sport/event-request?category_ids=${encoded}&include_any_team_vs_any_team_events=true`,h,15000);
 const vals=listEvents(list), unique=new Map();for(const e of vals){const id=eid(e);if(id)unique.set(id,e)}
 const candidates=[...unique.entries()].slice(0,10);
 const cards=await Promise.allSettled(candidates.map(([id,e])=>getJson(`https://api.neds.com.au/v2/sport/event-card?id=${encodeURIComponent(id)}`,h,16000).then(card=>({e,card}))));
 const out=[];let failures=0;
 for(const r of cards){if(r.status!=='fulfilled'){failures++;continue}const{e,card}=r.value;const ta=teams(e?.name||e?.display_name||card?.event?.name||card?.name);if(!ta)continue;const sels=nedsSelections(card,ta.home,ta.away);const item=eventObj(meta.key,ta.home,ta.away,nedsTime(e,card),'Neds',sels,'neds');if(item)out.push(item)}
 return{events:out,listed:unique.size,cards:cards.length,failures};
}
async function neds(sport){
 const metas=sport?NEDS.filter(x=>x.key===sport):NEDS;
 const settled=await Promise.allSettled(metas.map(nedsCategory));const events=[],categories=[];
 for(let i=0;i<settled.length;i++){const r=settled[i],m=metas[i];if(r.status==='fulfilled'){events.push(...r.value.events);categories.push({key:m.key,ok:true,listed:r.value.listed,cards:r.value.cards,failures:r.value.failures,events:r.value.events.length})}else categories.push({key:m.key,ok:false,listed:0,cards:0,failures:0,events:0,error:String(r.reason?.message||r.reason).slice(0,180)})}
 return{events,categories};
}

function merge(events){
 const buckets=[];
 for(const e of events){const t=parseMs(e.time);let b=buckets.find(x=>x.sport===e.sport&&Math.abs(parseMs(x.time)-t)<=MATCH_WINDOW_MS&&((same(x.home,e.home)&&same(x.away,e.away))||(same(x.home,e.away)&&same(x.away,e.home))));
  if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set()};buckets.push(b)}
  b.books.add(e.book);const rev=same(e.home,b.away)&&same(e.away,b.home);for(const o of e.offers){let r=o.role;if(rev&&(r==='home'||r==='away'))r=r==='home'?'away':'home';b.offers.push({...o,role:r})}
 }
 return buckets;
}
function arb(b){
 if(b.books.size<2)return null;const best={};for(const o of b.offers)if(!best[o.role]||o.odds>best[o.role].odds)best[o.role]=o;
 const roles=b.offers.some(o=>o.role==='draw')?['home','draw','away']:['home','away'];if(roles.some(r=>!best[r]))return null;
 const sels=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book}));
 if(new Set(sels.map(x=>x.best_bookmaker)).size<2)return null;const inv=sels.reduce((s,x)=>s+1/x.best_price,0);if(!Number.isFinite(inv)||inv>=1)return null;const roi=(1/inv-1)*100;
 return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:sels,optimal_stakes:sels.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))};
}
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
 const raw=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'',sport=ALIASES.get(raw)||raw,mode=String(req.query.market_mode||'all').toLowerCase(),debug=String(req.query.debug||'')==='1';
 if(!['all','h2h','lines','spreads','totals'].includes(mode))return res.status(400).json({error:'Unsupported market_mode'});
 if(!['all','h2h'].includes(mode)&&!debug)return res.status(200).json([]);
 const [pr,nr]=await Promise.allSettled([pointsBet(),neds(sport)]);
 const providers=[];let pe=[],ne=[],cats=[];
 if(pr.status==='fulfilled'){pe=pr.value;providers.push({provider:'PointsBet AU',ok:true,events:pe.length,error:null})}else providers.push({provider:'PointsBet AU',ok:false,events:0,error:String(pr.reason?.message||pr.reason).slice(0,220)});
 if(nr.status==='fulfilled'){ne=nr.value.events;cats=nr.value.categories;providers.push({provider:'Neds',ok:ne.length>0,events:ne.length,error:ne.length?null:(cats.find(x=>!x.ok)?.error||null)})}else providers.push({provider:'Neds',ok:false,events:0,error:String(nr.reason?.message||nr.reason).slice(0,220)});
 let all=[...pe,...ne];if(sport)all=all.filter(e=>e.sport===sport);
 const merged=merge(all).filter(b=>parseMs(b.time)>Date.now()+FUTURE_BUFFER_MS&&b.sport!=='other'),cross=merged.filter(b=>b.books.size>=2),arbs=cross.map(arb).filter(Boolean).sort((a,b)=>b.arb_pct-a.arb_pct).slice(0,100);
 res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Odds-Engine',ENGINE);res.setHeader('X-Game-Count',String(merged.length));res.setHeader('X-Cross-Book-Games',String(cross.length));res.setHeader('X-Arb-Count',String(arbs.length));
 if(debug)return res.status(200).json({engine:ENGINE,future_buffer_minutes:10,match_window_minutes:180,providers,neds_categories:cats,raw_events:all.length,merged_games:merged.length,cross_book_games:cross.length,arbs:arbs.length,sample_games:merged.slice(0,12).map(b=>({sport:b.sport,home:b.home,away:b.away,time:b.time,books:[...b.books]}))});
 return res.status(200).json(arbs);
}
