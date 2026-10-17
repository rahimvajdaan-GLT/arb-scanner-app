const ENGINE='au-openbooks-v14';
const FUTURE_BUFFER_MS=10*60*1000;
const MATCH_WINDOW_MS=6*60*60*1000;
const BASE_HEADERS={
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept':'application/json, text/plain, */*',
  'Accept-Language':'en-AU,en;q=0.9'
};
const ENTAIN_CATEGORIES=[
  {key:'basketball',id:'3c34d075-dc14-436d-bfc4-9272a49c2b39'},
  {key:'nhl',id:'b7c1f944-d02b-4d9b-b6f3-cb31389cfe36'},
  {key:'afl',id:'23d497e6-8aab-4309-905b-9421f42c9bc5'},
  {key:'cricket',id:'94984918-dbac-432b-b420-c219ec9203f4'},
  {key:'soccer',id:'71955b54-62f6-4ac5-abaa-df88cad0aeef'},
  {key:'baseball',id:'02721435-4671-4cd0-98f7-15d41ee4103e'},
  {key:'tennis',id:'a0b910b8-85f0-4f6e-821d-c9fd9e3bdf93'}
];
const ALIASES=new Map([
  ['aussierules_afl','afl'],['basketball_nba','basketball'],['icehockey_nhl','nhl'],
  ['soccer_epl','soccer'],['americanfootball_nfl','nfl'],['tennis_atp','tennis'],['tennis_wta','tennis']
]);
async function getJson(url,extra={},timeout=15000){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{...BASE_HEADERS,...extra},signal:c.signal,redirect:'follow',cache:'no-store'});
    const text=await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).hostname}${text?`: ${text.slice(0,160)}`:''}`);
    try{return JSON.parse(text)}catch{throw new Error(`Invalid JSON from ${new URL(url).hostname}`)}
  }finally{clearTimeout(timer)}
}
function parseMs(v){
  if(typeof v==='number'&&Number.isFinite(v))return v>1e12?v:v*1000;
  const s=String(v||'').trim();if(!s)return NaN;
  if(/^\d{10,13}$/.test(s)){const n=Number(s);return n>1e12?n:n*1000}
  const t=Date.parse(s);return Number.isFinite(t)?t:NaN;
}
function iso(v){const t=parseMs(v);return Number.isFinite(t)?new Date(t).toISOString():null}
function vals(v){if(Array.isArray(v))return v;if(v&&typeof v==='object')return Object.values(v);return[]}
function norm(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|club|the)\b/g,' ').replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function tokenScore(a,b){const A=new Set(norm(a).split(' ').filter(Boolean)),B=new Set(norm(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;const common=[...A].filter(x=>B.has(x)).length;return common/Math.max(1,Math.min(A.size,B.size))}
function same(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true;return tokenScore(x,y)>=0.5}
function teams(name){const s=String(name||'').trim();const m=s.match(/^(.+?)\s+(?:vs\.?|v|@|at)\s+(.+)$/i);if(!m)return null;const rev=/\s(?:@|at)\s/i.test(s);return rev?{home:m[2].trim(),away:m[1].trim()}:{home:m[1].trim(),away:m[2].trim()}}
function dec(v){const n=Number(v);return Number.isFinite(n)&&n>1?n:null}
function role(name,h,a,ha){if(ha==='HOME')return'home';if(ha==='AWAY')return'away';if(same(name,h))return'home';if(same(name,a))return'away';if(/^(draw|tie)$/i.test(String(name||'')))return'draw';return null}
function sportOf(s){s=String(s||'').toLowerCase();if(/afl|australian/.test(s))return'afl';if(/cricket|big bash|ipl/.test(s))return'cricket';if(/basketball|nba|nbl/.test(s))return'basketball';if(/ice hockey|nhl/.test(s))return'nhl';if(/soccer|premier league|epl/.test(s))return'soccer';if(/baseball|mlb/.test(s))return'baseball';if(/nrl|rugby league/.test(s))return'nrl';if(/american football|nfl/.test(s))return'nfl';if(/tennis|atp|wta/.test(s))return'tennis';return'other'}
function eventObj(sport,h,a,time,book,selections,source){
  const when=iso(time),tm=parseMs(when);if(!h||!a||!Number.isFinite(tm)||tm<=Date.now()+FUTURE_BUFFER_MS)return null;
  const best=new Map();
  for(const s of selections||[]){const o=dec(s.odds),r=s.role||role(s.name,h,a,s.homeAway);if(r&&o&&(!best.has(r)||o>best.get(r).odds))best.set(r,{market:'h2h',role:r,odds:o,point:null,book})}
  if(best.size<2)return null;
  return{sport,home:h,away:a,time:when,book,offers:[...best.values()],source};
}
async function pointsBet(){
  const h={'Origin':'https://pointsbet.com.au','Referer':'https://pointsbet.com.au/'};
  const feed=await getJson('https://api.au.pointsbet.com/api/v2/events/nextup?v2Limit=100',h);
  const rows=vals(feed?.events?.length!==undefined?feed.events:feed).filter(e=>e?.key&&e?.isLive!==true&&parseMs(e?.startsAt)>Date.now()+FUTURE_BUFFER_MS).slice(0,36);
  const details=await Promise.allSettled(rows.map(head=>getJson(`https://api.au.pointsbet.com/api/mes/v3/events/${encodeURIComponent(head.key)}`,h,16000).then(detail=>({head,detail}))));
  const out=[];
  for(const r of details){
    if(r.status!=='fulfilled')continue;const{head,detail}=r.value;
    const hh=typeof detail?.homeTeam==='string'?detail.homeTeam:(detail?.homeTeam?.name||head?.homeTeam?.name||head?.homeTeam);
    const aa=typeof detail?.awayTeam==='string'?detail.awayTeam:(detail?.awayTeam?.name||head?.awayTeam?.name||head?.awayTeam);
    const ta=hh&&aa?{home:hh,away:aa}:teams(detail?.name||head?.name);if(!ta)continue;
    const market=vals(detail?.fixedOddsMarkets).find(x=>/match result|match betting|head to head|moneyline|winner/i.test(String(x?.name||'')));if(!market)continue;
    const sels=vals(market?.outcomes).filter(o=>o?.isOpenForBetting!==false).map(o=>({name:o?.name,odds:o?.price}));
    const item=eventObj(sportOf(`${head?.sportKey||''} ${head?.competitionName||''} ${detail?.competitionName||''}`),ta.home,ta.away,detail?.startsAt||head?.startsAt,'PointsBet AU',sels,'pointsbet');
    if(item)out.push(item);
  }
  return out;
}
function entainDecimal(x){
  if(x==null)return null;const direct=dec(x?.decimal??x?.decimal_odds??x?.price??x?.returnWin);if(direct)return direct;
  const q=x?.odds||x,n=Number(q?.numerator??q?.num),d=Number(q?.denominator??q?.den);return Number.isFinite(n)&&Number.isFinite(d)&&d?1+n/d:null;
}
function eventTime(e){return iso(e?.advertised_start??e?.advertised_start_time??e?.start_time??e?.startTime??e?.startsAt)}
function cardSelections(card,h,a){
  const markets=vals(card?.markets),entrantsObj=card?.entrants&&typeof card.entrants==='object'?card.entrants:{},pricesObj=card?.prices&&typeof card.prices==='object'?card.prices:{};
  const priceById=new Map();
  for(const [k,p] of Object.entries(pricesObj)){const o=entainDecimal(p);if(o)priceById.set(String(k).split(':')[0],o)}
  for(const p of vals(pricesObj)){const id=p?.entrant_id??p?.entrantId??p?.selection_id??p?.selectionId,o=entainDecimal(p);if(id!=null&&o)priceById.set(String(id),o)}
  const out=[];
  for(const m of markets){
    if(!/match betting|head to head|match result|moneyline/i.test(String(m?.name??m?.display_name??'')))continue;
    const ids=Array.isArray(m?.entrant_ids)?m.entrant_ids:[];
    const rows=ids.length?ids.map(id=>entrantsObj?.[id]).filter(Boolean):vals(m?.entrants||m?.selections||m?.outcomes);
    for(const e of rows){const id=String(e?.id??e?.entrant_id??e?.entrantId??''),o=priceById.get(id)||entainDecimal(e?.price??e?.prices?.[0]??e),name=e?.name??e?.display_name,r=role(name,h,a,e?.home_away??e?.homeAway);if(r&&o)out.push({name,role:r,odds:o})}
  }
  return out;
}
function likelyByTime(metaKey,time,anchors){
  const t=parseMs(time);if(!Number.isFinite(t))return false;
  return anchors.some(a=>a.sport===metaKey&&Math.abs(parseMs(a.time)-t)<=MATCH_WINDOW_MS);
}
function priority(candidate,anchors){
  let best=0;
  for(const a of anchors){if(a.sport!==candidate.meta.key)continue;const dt=Math.abs(parseMs(a.time)-parseMs(candidate.time));if(dt>MATCH_WINDOW_MS)continue;
    const direct=(tokenScore(a.home,candidate.ta.home)+tokenScore(a.away,candidate.ta.away))/2;
    const rev=(tokenScore(a.home,candidate.ta.away)+tokenScore(a.away,candidate.ta.home))/2;
    best=Math.max(best,Math.max(direct,rev)+(1-dt/MATCH_WINDOW_MS));
  }
  return best;
}
async function entainBook(host,book,anchors,sport){
  const metas=sport?ENTAIN_CATEGORIES.filter(x=>x.key===sport):ENTAIN_CATEGORIES;
  const origin=book==='Neds'?'https://www.neds.com.au':'https://www.ladbrokes.com.au';
  const headers={'Content-Type':'application/json','Origin':origin,'Referer':`${origin}/`};
  const allListed=[],categoryErrors=[];
  const lists=await Promise.allSettled(metas.map(async meta=>{
    const qs=new URLSearchParams({category_ids:JSON.stringify([meta.id])});
    const data=await getJson(`https://${host}/v2/sport/event-request?${qs.toString()}`,headers,15000);
    return{meta,events:vals(data?.events||data?.data?.events)};
  }));
  for(let i=0;i<lists.length;i++){
    const r=lists[i],meta=metas[i];if(r.status==='rejected'){categoryErrors.push(`${meta.key}: ${String(r.reason?.message||r.reason).slice(0,120)}`);continue}
    for(const e of r.value.events){
      if(e?.match_status&&e.match_status!=='BettingOpen')continue;
      const ta=teams(e?.name||e?.display_name);const time=eventTime(e);const id=String(e?.id??e?.event_id??e?.eventId??'');
      if(!id||!ta||!likelyByTime(meta.key,time,anchors))continue;
      allListed.push({meta,e,ta,time,id});
    }
  }
  const dedup=[...new Map(allListed.map(x=>[x.id,x])).values()].sort((a,b)=>priority(b,anchors)-priority(a,anchors)).slice(0,30);
  const cards=await Promise.allSettled(dedup.map(x=>getJson(`https://${host}/v2/sport/event-card?id=${encodeURIComponent(x.id)}`,headers,16000).then(card=>({x,card}))));
  const events=[];let cardFailures=0,priceFailures=0;
  for(const r of cards){
    if(r.status==='rejected'){cardFailures++;continue}
    const{x,card}=r.value,sels=cardSelections(card,x.ta.home,x.ta.away);if(sels.length<2){priceFailures++;continue}
    const item=eventObj(x.meta.key,x.ta.home,x.ta.away,x.time,book,sels,book.toLowerCase());if(item)events.push(item);
  }
  return{events,listed:allListed.length,candidates:dedup.length,cards:cards.length,cardFailures,priceFailures,categoryErrors};
}
function sameFixture(a,b){
  if(a.sport!==b.sport)return false;const dt=Math.abs(parseMs(a.time)-parseMs(b.time));if(dt>MATCH_WINDOW_MS)return false;
  const direct=same(a.home,b.home)&&same(a.away,b.away),rev=same(a.home,b.away)&&same(a.away,b.home);return direct||rev;
}
function merge(events){
  const buckets=[];
  for(const e of events){let b=buckets.find(x=>sameFixture(x,e));if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set()};buckets.push(b)}
    b.books.add(e.book);const rev=same(e.home,b.away)&&same(e.away,b.home);for(const o of e.offers){let r=o.role;if(rev&&(r==='home'||r==='away'))r=r==='home'?'away':'home';b.offers.push({...o,role:r})}
  }
  return buckets;
}
function arb(b){
  if(b.books.size<2)return null;const best={};for(const o of b.offers)if(!best[o.role]||o.odds>best[o.role].odds)best[o.role]=o;
  const roles=b.offers.some(o=>o.role==='draw')?['home','draw','away']:['home','away'];if(roles.some(r=>!best[r]))return null;
  const sels=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book}));
  if(new Set(sels.map(x=>x.best_bookmaker)).size<2)return null;
  const inv=sels.reduce((s,x)=>s+1/x.best_price,0);if(!Number.isFinite(inv)||inv>=1)return null;
  const roi=(1/inv-1)*100;
  return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:sels,optimal_stakes:sels.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))};
}
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  const raw=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'',sport=ALIASES.get(raw)||raw,mode=String(req.query.market_mode||'all').toLowerCase(),debug=String(req.query.debug||'')==='1';
  if(!['all','h2h','lines','spreads','totals'].includes(mode))return res.status(400).json({error:'Unsupported market_mode'});
  if(!['all','h2h'].includes(mode)&&!debug)return res.status(200).json([]);
  const providers=[];let pe=[];
  try{pe=await pointsBet();providers.push({provider:'PointsBet AU',ok:true,events:pe.length})}catch(e){providers.push({provider:'PointsBet AU',ok:false,events:0,error:String(e?.message||e).slice(0,200)})}
  let ne={events:[],listed:0,candidates:0,cards:0,cardFailures:0,priceFailures:0,categoryErrors:[]},la={...ne,events:[],categoryErrors:[]};
  if(pe.length){
    const [nr,lr]=await Promise.allSettled([entainBook('api.neds.com.au','Neds',pe,sport),entainBook('api.ladbrokes.com.au','Ladbrokes AU',pe,sport)]);
    if(nr.status==='fulfilled'){ne=nr.value;providers.push({provider:'Neds',ok:ne.categoryErrors.length<ENTAIN_CATEGORIES.length,events:ne.events.length,listed:ne.listed,candidates:ne.candidates,cards:ne.cards,card_failures:ne.cardFailures,price_failures:ne.priceFailures,error:ne.categoryErrors.join(' | ')||undefined})}else providers.push({provider:'Neds',ok:false,events:0,error:String(nr.reason?.message||nr.reason).slice(0,200)});
    if(lr.status==='fulfilled'){la=lr.value;providers.push({provider:'Ladbrokes AU',ok:la.categoryErrors.length<ENTAIN_CATEGORIES.length,events:la.events.length,listed:la.listed,candidates:la.candidates,cards:la.cards,card_failures:la.cardFailures,price_failures:la.priceFailures,error:la.categoryErrors.join(' | ')||undefined})}else providers.push({provider:'Ladbrokes AU',ok:false,events:0,error:String(lr.reason?.message||lr.reason).slice(0,200)});
  }
  let all=[...pe,...ne.events,...la.events];if(sport)all=all.filter(e=>e.sport===sport);
  const buckets=merge(all),cross=buckets.filter(b=>b.books.size>=2),arbs=cross.map(arb).filter(Boolean).sort((a,b)=>b.arb_pct-a.arb_pct).slice(0,25);
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(debug)return res.status(200).json({engine:ENGINE,providers,merged_games:buckets.length,cross_book_games:cross.length,arbs:arbs.length,results:arbs});
  return res.status(200).json(arbs);
}
