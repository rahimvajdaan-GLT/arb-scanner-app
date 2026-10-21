const ENGINE='au-openbooks-v17-broad-fixtures';
const FUTURE_BUFFER_MS=10*60*1000;
const MATCH_WINDOW_MS=90*60*1000;
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
  const c=new AbortController(); const timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{...BASE_HEADERS,...extra},signal:c.signal,redirect:'follow',cache:'no-store'});
    const text=await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).hostname}${text?`: ${text.slice(0,160)}`:''}`);
    try{return JSON.parse(text)}catch{throw new Error(`Invalid JSON from ${new URL(url).hostname}`)}
  } finally { clearTimeout(timer); }
}

function parseMs(v){
  if(typeof v==='number'&&Number.isFinite(v)) return v>1e12?v:v*1000;
  const s=String(v||'').trim(); if(!s)return NaN;
  if(/^\d{10,13}$/.test(s)){const n=Number(s);return n>1e12?n:n*1000}
  const t=Date.parse(s); return Number.isFinite(t)?t:NaN;
}
function firstTime(...vals){for(const v of vals){const t=parseMs(v);if(Number.isFinite(t))return new Date(t).toISOString()}return null}
function objValues(v){if(Array.isArray(v))return v;if(v&&typeof v==='object')return Object.values(v);return[]}
function norm(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|club|the)\b/g,' ').replace(/\bunited\b/g,'utd').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function same(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true;const A=new Set(x.split(' ')),B=new Set(y.split(' '));return [...A].filter(z=>B.has(z)).length/Math.max(1,Math.min(A.size,B.size))>=.6}
function teams(name){const s=String(name||'').trim();const m=s.match(/^(.+?)\s+(?:vs\.?|v|@|at)\s+(.+)$/i);if(!m)return null;const isAway=/\s(?:@|at)\s/i.test(s);return isAway?{home:m[2].trim(),away:m[1].trim()}:{home:m[1].trim(),away:m[2].trim()}}
function dec(v){const n=Number(v);return Number.isFinite(n)&&n>1?n:null}
function role(name,h,a,homeAway){if(homeAway==='HOME')return'home';if(homeAway==='AWAY')return'away';if(same(name,h))return'home';if(same(name,a))return'away';if(/^(draw|tie)$/i.test(String(name||'')))return'draw';return null}
function sportOf(s){s=String(s||'').toLowerCase();if(/afl|australian/.test(s))return'afl';if(/cricket|big bash|ipl/.test(s))return'cricket';if(/basketball|nba|nbl/.test(s))return'basketball';if(/ice hockey|nhl/.test(s))return'nhl';if(/soccer|premier league|epl/.test(s))return'soccer';if(/baseball|mlb/.test(s))return'baseball';if(/nrl|rugby league/.test(s))return'nrl';if(/american football|nfl/.test(s))return'nfl';if(/tennis|atp|wta/.test(s))return'tennis';return'other'}
function eventObj(sport,h,a,time,book,sels,source){
  const iso=firstTime(time),tm=parseMs(iso);if(!h||!a||!Number.isFinite(tm)||tm<=Date.now()+FUTURE_BUFFER_MS)return null;
  const best=new Map();
  for(const s of sels||[]){const o=dec(s.odds),r=s.role||role(s.name,h,a,s.homeAway);if(r&&o&&(!best.has(r)||o>best.get(r).odds))best.set(r,{market:'h2h',role:r,odds:o,point:null,book})}
  if(best.size<2)return null;
  return{sport,home:h,away:a,time:iso,book,offers:[...best.values()],source};
}

async function pointsBet(){
  const h={'Origin':'https://pointsbet.com.au','Referer':'https://pointsbet.com.au/'};
  const feed=await getJson('https://api.au.pointsbet.com/api/v2/events/nextup?v2Limit=80',h);
  const rows=Array.isArray(feed?.events)?feed.events:(Array.isArray(feed)?feed:[]);
  const upcoming=rows.filter(e=>e?.key&&e?.isLive!==true&&parseMs(e?.startsAt)>Date.now()+FUTURE_BUFFER_MS).slice(0,30);
  const details=await Promise.allSettled(upcoming.map(head=>getJson(`https://api.au.pointsbet.com/api/mes/v3/events/${encodeURIComponent(head.key)}`,h,16000).then(detail=>({head,detail}))));
  const out=[];
  for(const r of details){
    if(r.status!=='fulfilled')continue;const{head,detail}=r.value;
    const hh=typeof detail?.homeTeam==='string'?detail.homeTeam:(detail?.homeTeam?.name||head?.homeTeam?.name||head?.homeTeam);
    const aa=typeof detail?.awayTeam==='string'?detail.awayTeam:(detail?.awayTeam?.name||head?.awayTeam?.name||head?.awayTeam);
    const ta=hh&&aa?{home:hh,away:aa}:teams(detail?.name||head?.name);if(!ta)continue;
    const ms=Array.isArray(detail?.fixedOddsMarkets)?detail.fixedOddsMarkets:[];
    const m=ms.find(x=>/match result|match betting|head to head|moneyline|winner/i.test(String(x?.name||'')));if(!m)continue;
    const sels=objValues(m?.outcomes).filter(o=>o?.isOpenForBetting!==false).map(o=>({name:o?.name,odds:o?.price}));
    const item=eventObj(sportOf(`${head?.sportKey||''} ${head?.competitionName||''} ${detail?.competitionName||''}`),ta.home,ta.away,detail?.startsAt||head?.startsAt,'PointsBet AU',sels,'pointsbet');
    if(item)out.push(item);
  }
  return out;
}

function entainDecimal(x){
  if(x==null)return null;
  const direct=dec(x?.decimal??x?.decimal_odds??x?.price??x?.returnWin);if(direct)return direct;
  const q=x?.odds||x;const n=Number(q?.numerator??q?.num),d=Number(q?.denominator??q?.den);return Number.isFinite(n)&&Number.isFinite(d)&&d?1+n/d:null;
}
function entainListEvents(payload){return objValues(payload?.events?.length!==undefined?payload.events:(payload?.events||payload?.data?.events))}
function entainEventTime(e){return firstTime(e?.advertised_start,e?.advertised_start_time,e?.start_time,e?.startTime,e?.startsAt)}
function sameFixture(a,b){
  if(a.sport&&b.sport&&a.sport!==b.sport)return false;
  const direct=same(a.home,b.home)&&same(a.away,b.away),rev=same(a.home,b.away)&&same(a.away,b.home);if(!direct&&!rev)return false;
  const at=parseMs(a.time),bt=parseMs(b.time);return !Number.isFinite(at)||!Number.isFinite(bt)||Math.abs(at-bt)<=MATCH_WINDOW_MS;
}
function entainCardSelections(card,h,a){
  const markets=objValues(card?.markets), entrantsObj=card?.entrants&&typeof card.entrants==='object'?card.entrants:{}, pricesObj=card?.prices&&typeof card.prices==='object'?card.prices:{};
  const entrants=objValues(entrantsObj);
  const priceByEntrant=new Map();
  for(const [k,p] of Object.entries(pricesObj)){
    const id=String(k).split(':')[0];const o=entainDecimal(p);if(o)priceByEntrant.set(id,o);
  }
  for(const p of objValues(pricesObj)){
    const id=p?.entrant_id??p?.entrantId??p?.selection_id??p?.selectionId;const o=entainDecimal(p);if(id!=null&&o)priceByEntrant.set(String(id),o);
  }
  const out=[];
  for(const m of markets){
    const mn=String(m?.name??m?.display_name??'').trim();if(!/^(match betting|head to head|match result|moneyline)$/i.test(mn)&&!/match betting|head to head|match result|moneyline/i.test(mn))continue;
    const ids=Array.isArray(m?.entrant_ids)?m.entrant_ids:[];
    const rows=ids.length?ids.map(id=>entrantsObj?.[id]).filter(Boolean):objValues(m?.entrants||m?.selections||m?.outcomes);
    for(const e of rows){
      const id=String(e?.id??e?.entrant_id??e?.entrantId??'');
      const o=priceByEntrant.get(id)||entainDecimal(e?.price??e?.prices?.[0]??e);
      const name=e?.name??e?.display_name;const r=role(name,h,a,e?.home_away??e?.homeAway);if(r&&o)out.push({name,role:r,odds:o});
    }
  }
  if(out.length>=2)return out;
  for(const e of entrants){
    const id=String(e?.id??e?.entrant_id??e?.entrantId??'');const o=priceByEntrant.get(id)||entainDecimal(e?.price);const name=e?.name??e?.display_name;const r=role(name,h,a,e?.home_away??e?.homeAway);if(r&&o)out.push({name,role:r,odds:o});
  }
  return out;
}

async function entainBook(host,book,anchors,sport){
  const metas=sport?ENTAIN_CATEGORIES.filter(x=>x.key===sport):ENTAIN_CATEGORIES;
  const headers={'Content-Type':'application/json','Origin':book==='Neds'?'https://www.neds.com.au':'https://www.ladbrokes.com.au','Referer':book==='Neds'?'https://www.neds.com.au/':'https://www.ladbrokes.com.au/'};
  const listed=[];const categoryErrors=[];
  const lists=await Promise.allSettled(metas.map(async meta=>{
    const qs=new URLSearchParams({category_ids:JSON.stringify([meta.id])});
    const data=await getJson(`https://${host}/v2/sport/event-request?${qs.toString()}`,headers,15000);
    return{meta,events:entainListEvents(data)};
  }));
  for(let i=0;i<lists.length;i++){
    const r=lists[i],meta=metas[i];
    if(r.status==='rejected'){categoryErrors.push(`${meta.key}: ${String(r.reason?.message||r.reason).slice(0,120)}`);continue}
    for(const e of r.value.events){
      if(e?.match_status&&e.match_status!=='BettingOpen')continue;
      const ta=teams(e?.name||e?.display_name);if(!ta)continue;
      const time=entainEventTime(e);const candidate={sport:meta.key,home:ta.home,away:ta.away,time};
      if(time&&parseMs(time)>Date.now()+FUTURE_BUFFER_MS)listed.push({meta,e,ta,time,id:String(e?.id??e?.event_id??e?.eventId??'')});
    }
  }
  const dedup=[...new Map(listed.filter(x=>x.id).map(x=>[x.id,x])).values()].sort((a,b)=>parseMs(a.time)-parseMs(b.time)).slice(0,45);
  const cards=await Promise.allSettled(dedup.map(x=>getJson(`https://${host}/v2/sport/event-card?id=${encodeURIComponent(x.id)}`,headers,16000).then(card=>({x,card}))));
  const events=[];let cardFailures=0;
  for(const r of cards){
    if(r.status==='rejected'){cardFailures++;continue}
    const{x,card}=r.value;const sels=entainCardSelections(card,x.ta.home,x.ta.away);const item=eventObj(x.meta.key,x.ta.home,x.ta.away,x.time,book,sels,book.toLowerCase());if(item)events.push(item);
  }
  return{events,listed:listed.length,cards:cards.length,cardFailures,categoryErrors};
}

function merge(events){
  const buckets=[];
  for(const e of events){
    const t=parseMs(e.time);let b=buckets.find(x=>x.sport===e.sport&&Math.abs(parseMs(x.time)-t)<=MATCH_WINDOW_MS&&((same(x.home,e.home)&&same(x.away,e.away))||(same(x.home,e.away)&&same(x.away,e.home))));
    if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set()};buckets.push(b)}
    b.books.add(e.book);const rev=same(e.home,b.away)&&same(e.away,b.home);
    for(const o of e.offers){let r=o.role;if(rev&&(r==='home'||r==='away'))r=r==='home'?'away':'home';b.offers.push({...o,role:r})
    }
  }
  return buckets;
}
function arb(b){
  if(b.books.size<2)return null;const best={};for(const o of b.offers)if(!best[o.role]||o.odds>best[o.role].odds)best[o.role]=o;
  const roles=b.offers.some(o=>o.role==='draw')?['home','draw','away']:['home','away'];if(roles.some(r=>!best[r]))return null;
  const sels=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book}));
  if(new Set(sels.map(x=>x.best_bookmaker)).size<2)return null;
  const inv=sels.reduce((s,x)=>s+1/x.best_price,0);if(!Number.isFinite(inv)||inv>=1)return null;const roi=(1/inv-1)*100;
  return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:sels,optimal_stakes:sels.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))};
}

export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  const raw=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'';
  const sport=ALIASES.get(raw)||raw;const mode=String(req.query.market_mode||'all').toLowerCase();const debug=String(req.query.debug||'')==='1';
  if(!['all','h2h','lines','spreads','totals'].includes(mode))return res.status(400).json({error:'Unsupported market_mode'});
  if(!['all','h2h'].includes(mode)&&!debug)return res.status(200).json([]);

  const providers=[];
  let pe=[];
  try{pe=await pointsBet();providers.push({provider:'PointsBet AU',ok:true,events:pe.length})}
  catch(e){providers.push({provider:'PointsBet AU',ok:false,events:0,error:String(e?.message||e).slice(0,200)})}

  let neds={events:[],listed:0,cards:0,cardFailures:0,categoryErrors:[]};
  let lads={events:[],listed:0,cards:0,cardFailures:0,categoryErrors:[]};
  {
    const [nr,lr]=await Promise.allSettled([
      entainBook('api.neds.com.au','Neds',pe,sport),
      entainBook('api.ladbrokes.com.au','Ladbrokes AU',pe,sport)
    ]);
    if(nr.status==='fulfilled'){neds=nr.value;providers.push({provider:'Neds',ok:true,events:neds.events.length,listed:neds.listed,cards:neds.cards,card_failures:neds.cardFailures,error:neds.categoryErrors.length?neds.categoryErrors.join(' | '):undefined})}
    else providers.push({provider:'Neds',ok:false,events:0,error:String(nr.reason?.message||nr.reason).slice(0,200)});
    if(lr.status==='fulfilled'){lads=lr.value;providers.push({provider:'Ladbrokes AU',ok:true,events:lads.events.length,listed:lads.listed,cards:lads.cards,card_failures:lads.cardFailures,error:lads.categoryErrors.length?lads.categoryErrors.join(' | '):undefined})}
    else providers.push({provider:'Ladbrokes AU',ok:false,events:0,error:String(lr.reason?.message||lr.reason).slice(0,200)});
  }

  let all=[...pe,...neds.events,...lads.events];
  if(sport)all=all.filter(e=>e.sport===sport);
  const buckets=merge(all);
  const cross=buckets.filter(b=>b.books.size>=2);
  const arbs=cross.map(arb).filter(Boolean).sort((a,b)=>b.arb_pct-a.arb_pct).slice(0,25);

  res.setHeader('Cache-Control','no-store, max-age=0');
  if(debug)return res.status(200).json({engine:ENGINE,providers,merged_games:buckets.length,cross_book_games:cross.length,arbs:arbs.length,results:arbs,scan_scope:'Independent pre-match Neds and Ladbrokes discovery, plus PointsBet'});
  return res.status(200).json(arbs);
}
