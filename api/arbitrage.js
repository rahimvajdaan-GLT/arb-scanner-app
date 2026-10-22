const ENGINE='au-openbooks-v39-market-id-linking';
const FUTURE_BUFFER_MS=10*60*1000;
const MATCH_WINDOW_MS=30*60*1000;
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
  ['aussierules_afl','afl'],['nba','basketball'],['nbl','basketball'],['ncaab','basketball'],['basketball_nba','basketball'],['icehockey_nhl','nhl'],['mlb','baseball'],
  ['soccer_epl','soccer'],['soccer_mls','soccer'],['ncaaf','nfl'],['americanfootball_nfl','nfl'],['tennis_atp','tennis'],['tennis_wta','tennis']
]);

const hostCooldown=new Map();
const scanCache=new Map();
async function getJson(url,extra={},timeout=15000){
  const host=new URL(url).hostname;
  if((hostCooldown.get(host)||0)>Date.now())throw new Error('HTTP 429 '+host+' (cooldown active; requests paused)');
  const c=new AbortController(); const timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{...BASE_HEADERS,...extra},signal:c.signal,redirect:'follow',cache:'no-store'});
    const text=await r.text();
    if(r.status===429){
      const retry=Number(r.headers.get('retry-after'));
      hostCooldown.set(host,Date.now()+(Number.isFinite(retry)&&retry>0?Math.min(retry*1000,3600000):60*60*1000));
      throw new Error('HTTP 429 '+host+' (rate-limited; retry later)');
    }
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
function same(a,b){
 const x=norm(a).replace(/^ny /,'new york ').replace(/^la /,'los angeles ').replace(/^man /,'manchester ');
 const y=norm(b).replace(/^ny /,'new york ').replace(/^la /,'los angeles ').replace(/^man /,'manchester ');
 if(!x||!y)return false;
 if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;
 const A=x.split(' '),B=y.split(' ');
 // City-only overlap must never merge rivals such as NY Jets and NY Giants.
 if(A.at(-1)!==B.at(-1))return false;
 const overlap=A.filter(t=>B.includes(t)).length;
 if(Math.min(A.length,B.length)===1){
   const token=A.length===1?A[0]:B[0];
   return token.length>=5&&!['united','city','rangers','wanderers','athletic','town','saints','fc'].includes(token);
 }
 return overlap/Math.max(A.length,B.length)>=0.65;
}
function teams(name){const s=String(name||'').trim();const m=s.match(/^(.+?)\s+(?:vs\.?|v|@|at)\s+(.+)$/i);if(!m)return null;const isAway=/\s(?:@|at)\s/i.test(s);return isAway?{home:m[2].trim(),away:m[1].trim()}:{home:m[1].trim(),away:m[2].trim()}}
function dec(v){const n=Number(v);return Number.isFinite(n)&&n>1?n:null}
function role(name,h,a,homeAway){if(homeAway==='HOME')return'home';if(homeAway==='AWAY')return'away';if(same(name,h))return'home';if(same(name,a))return'away';if(/^(draw|tie)$/i.test(String(name||'')))return'draw';return null}
function sportOf(s){s=String(s||'').toLowerCase();if(/afl|australian/.test(s))return'afl';if(/cricket|big bash|ipl/.test(s))return'cricket';if(/basketball|nba|nbl/.test(s))return'basketball';if(/ice hockey|nhl/.test(s))return'nhl';if(/soccer|premier league|epl/.test(s))return'soccer';if(/baseball|mlb/.test(s))return'baseball';if(/nrl|rugby league/.test(s))return'nrl';if(/american football|nfl/.test(s))return'nfl';if(/tennis|atp|wta/.test(s))return'tennis';return'other'}
function bookmakerName(value){
 const raw=String(value||'').trim(),key=raw.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!key)return '';
 const known={
  pointsbet:'PointsBet AU',pointsbetau:'PointsBet AU',
  sportsbet:'Sportsbet',sportsbetau:'Sportsbet',
  tab:'TAB',tabau:'TAB',tabcomau:'TAB',
  neds:'Neds',nedsau:'Neds',
  ladbrokes:'Ladbrokes AU',ladbrokesau:'Ladbrokes AU',
  unibet:'Unibet AU',unibetau:'Unibet AU',
  bet365:'bet365 AU',bet365au:'bet365 AU',
  tabtouch:'TABtouch',tabtouchau:'TABtouch',
  betright:'Bet Right',betrightau:'Bet Right',
  betfair:'Betfair Exchange',betfairexchange:'Betfair Exchange'
 };
 return known[key]||raw;
}
function eventObj(sport,h,a,time,book,sels,source){
  const iso=firstTime(time),tm=parseMs(iso);if(!h||!a||!Number.isFinite(tm)||tm<=Date.now()+FUTURE_BUFFER_MS)return null;
  book=bookmakerName(book);if(!book)return null;
  const best=new Map();
  for(const s of sels||[]){const o=dec(s.odds),r=s.role||role(s.name,h,a,s.homeAway);if(r&&o&&(!best.has(r)||o>best.get(r).odds))best.set(r,{market:'h2h',role:r,odds:o,point:null,book})}
  if(best.size<2)return null;
  // A full-time soccer result requires home / draw / away. A two-price card
  // may be draw-no-bet or qualification and cannot be equated with 1X2.
  if(sport==='soccer'&&(!best.has('home')||!best.has('draw')||!best.has('away')))return null;
  return{sport,home:h,away:a,time:iso,book,offers:[...best.values()],outcomeCount:best.size,source};
}

async function pointsBet(){
  const h={'Origin':'https://pointsbet.com.au','Referer':'https://pointsbet.com.au/'};
  const feed=await getJson('https://api.au.pointsbet.com/api/v2/events/nextup?v2Limit=80',h);
  const rows=Array.isArray(feed?.events)?feed.events:(Array.isArray(feed)?feed:[]);
  const upcoming=rows.filter(e=>e?.key&&e?.isLive!==true&&parseMs(e?.startsAt)>Date.now()+FUTURE_BUFFER_MS ).slice(0,6);
  const details=await Promise.allSettled(upcoming.map(head=>getJson(`https://api.au.pointsbet.com/api/mes/v3/events/${encodeURIComponent(head.key)}`,h,16000).then(detail=>({head,detail}))));
  const out=[];
  for(const r of details){
    if(r.status!=='fulfilled')continue;const{head,detail}=r.value;
    const hh=typeof detail?.homeTeam==='string'?detail.homeTeam:(detail?.homeTeam?.name||head?.homeTeam?.name||head?.homeTeam);
    const aa=typeof detail?.awayTeam==='string'?detail.awayTeam:(detail?.awayTeam?.name||head?.awayTeam?.name||head?.awayTeam);
    const ta=hh&&aa?{home:hh,away:aa}:teams(detail?.name||head?.name);if(!ta)continue;
    const ms=Array.isArray(detail?.fixedOddsMarkets)?detail.fixedOddsMarkets:[];
    const m=ms.find(x=>/^(match result|match betting|head to head|head-to-head|moneyline|match winner|winner|full time result|full-time result|game winner)$/i.test(String(x?.name||'').trim())&&x?.isOpenForBetting!==false);if(!m)continue;
    const sels=objValues(m?.outcomes).filter(o=>o?.isOpenForBetting!==false).map(o=>({name:o?.name,odds:o?.price}));
    const item=eventObj(sportOf(`${head?.sportKey||''} ${head?.competitionName||''} ${detail?.competitionName||''}`),ta.home,ta.away,detail?.startsAt||head?.startsAt,'PointsBet AU',sels,'pointsbet');
    if(item)out.push(item);
  }
  return out;
}

function entainDecimal(x){
  if(x==null)return null;
  const direct=dec(typeof x==='number'?x:(x?.decimal??x?.decimal_odds??x?.decimalOdds??x?.decimal_price??x?.returnWin??x?.odds?.decimal??x?.odds?.decimal_odds??x?.price));
  if(direct)return direct;
  // Entain has served both fractional-odds objects and numeric decimal odds.
  const scalar=dec(x?.odds);if(scalar)return scalar;
  const q=x?.odds||x;const n=Number(q?.numerator??q?.num),d=Number(q?.denominator??q?.den);
  return Number.isFinite(n)&&Number.isFinite(d)&&d>0&&n>=0?1+n/d:null;
}
function entainCardPayload(card){
  const roots=[card,card?.data,card?.event,card?.data?.event,card?.data?.data,card?.result];
  if(Array.isArray(card))roots.push(card[0]);
  for(const root of roots){
    if(root&&typeof root==='object'&&root.markets&&typeof root.markets==='object'&&Object.keys(root.markets).length)return root;
  }
  return card||{};
}
function entainMarketName(m){return String(m?.name??m?.display_name??m?.displayName??'').trim()}
function entainFullMatchMarket(m,sport){
  const name=entainMarketName(m);
  const full=/^(match betting|head to head|head-to-head|head2head|h2h|match result|match winner|match odds|moneyline|money line|full time result|full-time result|full match result|game winner|game betting|game result)$/i.test(name);
  // Generic 'winner' is too ambiguous for soccer (qualification versus 90 min).
  const twoWayGeneric=sport!=='soccer'&&/^(winner|to win)$/i.test(name);
  const period=String(m?.period?.name??m?.period??'').toLowerCase();
  const partial=/first|second|half|quarter|period [1-3]|regulation|60 min|1h|2h|set [1-5]/i;
  return (full||twoWayGeneric)&&!partial.test(name)&&(!period||!partial.test(period));
}
function entainListEvents(payload){return objValues(payload?.events?.length!==undefined?payload.events:(payload?.events||payload?.data?.events))}
function entainEventTime(e){return firstTime(e?.advertised_start,e?.advertised_start_time,e?.start_time,e?.startTime,e?.startsAt)}
function sameFixture(a,b){
  if(a.sport&&b.sport&&a.sport!==b.sport)return false;
  const direct=same(a.home,b.home)&&same(a.away,b.away),rev=same(a.home,b.away)&&same(a.away,b.home);if(!direct&&!rev)return false;
  const at=parseMs(a.time),bt=parseMs(b.time);return !Number.isFinite(at)||!Number.isFinite(bt)||Math.abs(at-bt)<=MATCH_WINDOW_MS;
}
function entainId(value){
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number')return String(value);
  if(typeof value==='object')return String(value.id??value.entrant_id??value.entrantId??value.selection_id??value.selectionId??'');
  return '';
}
function entainSelectionIds(m){
  const candidates=[m.entrant_ids,m.entrantIds,m.selection_ids,m.selectionIds,m.outcome_ids,m.outcomeIds,m.entrants,m.selections];
  for(const value of candidates){
    if(Array.isArray(value)){
      const ids=value.map(entainId).filter(Boolean);
      if(ids.length)return ids;
    }
    if(value&&typeof value==='object'){
      const ids=Object.entries(value).map(([key,row])=>entainId(row)||key).filter(Boolean);
      if(ids.length)return ids;
    }
  }
  return [];
}
function entainCardSelections(card,h,a,sport){
  card=entainCardPayload(card);
  const markets=Object.entries(card?.markets||{});
  const entrants=card?.entrants&&typeof card.entrants==='object'?card.entrants:{};
  const prices=card?.prices&&typeof card.prices==='object'?card.prices:{};
  // All returned prices must be attributable to this exact market AND a named
  // participant; do not infer prices by team name across the entire event.
  for(const [marketKey,m] of markets){
    if(!m||typeof m!=='object'||!entainFullMatchMarket(m,sport))continue;
    if(m.is_open_for_betting===false||m.is_open===false||m.suspended===true)continue;
    const mid=String(m.id??marketKey),marketIds=new Set([mid,String(marketKey)]);
    const linkedIds=entainSelectionIds(m);
    const explicitlyLinked=new Set(linkedIds);
    const rows=[];
    for(const id of linkedIds){
      const entry=entrants[id]??(Array.isArray(m.entrants)?m.entrants.find(x=>entainId(x)===id):null);
      if(entry&&typeof entry==='object')rows.push({key:id,entrant:entry});
    }
    // An entrant's market ID is also a strict association.
    for(const [key,entry] of Object.entries(entrants)){
      if(!entry||typeof entry!=='object')continue;
      const entryMarket=entainId(entry.market_id??entry.marketId??entry.market?.id??entry.market);
      if(entryMarket&&marketIds.has(entryMarket)&&!rows.some(row=>row.key===key)){
        rows.push({key,entrant:entry});
        explicitlyLinked.add(key);
      }
    }
    // Some responses attach the market ID to the PRICE rather than the entrant.
    // This is safe only when both market and entrant IDs are explicit in that quote.
    for(const [key,price] of Object.entries(prices)){
      if(!price||typeof price!=='object')continue;
      const priceMarket=entainId(price.market_id??price.marketId??price.market?.id??price.market);
      const eid=entainId(price.entrant_id??price.entrantId??price.selection_id??price.selectionId);
      if(priceMarket&&marketIds.has(priceMarket)&&eid&&entrants[eid]&&!rows.some(row=>row.key===eid)){
        rows.push({key:eid,entrant:entrants[eid]});
        explicitlyLinked.add(eid);
      }
    }
    if(!rows.length)continue;
    const selections=[];
    for(const row of rows){
      const eid=entainId(row.entrant.id??row.entrant.entrant_id??row.entrant.entrantId)||row.key;
      const name=row.entrant.name??row.entrant.display_name??row.entrant.displayName;
      const selectionRole=role(name,h,a,row.entrant.home_away??row.entrant.homeAway);
      if(!selectionRole||!eid)continue;
      const valid=[];
      for(const [priceKey,p] of Object.entries(prices)){
        if(!p||typeof p!=='object'||p.available===false||p.is_open===false||p.suspended===true)continue;
        const pid=entainId(p.entrant_id??p.entrantId??p.selection_id??p.selectionId);
        const pmid=entainId(p.market_id??p.marketId??p.market?.id??p.market);
        if(pid&&pid!==eid&&pid!==row.key)continue;
        if(pmid&&!marketIds.has(pmid))continue;
        const segments=String(priceKey).split(/[:|/]/);
        const keyTied=priceKey===eid||priceKey===row.key||segments.includes(eid)||segments.includes(row.key);
        // Only accept market-specific references, or an exact entrant-keyed quote
        // when we already know the entrant belongs to this market.
        const explicit=Boolean(pid&&pmid&&marketIds.has(pmid));
        const quoteLinked=explicit||(keyTied&&(explicitlyLinked.has(eid)||explicitlyLinked.has(row.key)||Boolean(pmid)));
        if(!quoteLinked)continue;
        const price=entainDecimal(p);
        if(price)valid.push(price);
      }
      const attached=entainDecimal(row.entrant.price??row.entrant.odds);
      if(attached&&explicitlyLinked.has(row.key))valid.push(attached);
      if(valid.length)selections.push({name,role:selectionRole,odds:Math.max(...valid)});
    }
    const distinct=new Set(selections.map(x=>x.role));
    if(distinct.size!==selections.length||!distinct.has('home')||!distinct.has('away'))continue;
    if(sport==='soccer'&&!distinct.has('draw'))continue;
    if(selections.length!==2&&selections.length!==3)continue;
    const overround=selections.reduce((sum,x)=>sum+1/x.odds,0);
    if(!Number.isFinite(overround)||overround<0.92)continue;
    return selections;
  }
  return [];
}

async function entainBook(host,book,anchors,sport){
  const deadline=Date.now()+42000;
  const metas=sport?ENTAIN_CATEGORIES.filter(x=>x.key===sport):ENTAIN_CATEGORIES;
  const headers={'Content-Type':'application/json','Origin':book==='Neds'?'https://www.neds.com.au':'https://www.ladbrokes.com.au','Referer':book==='Neds'?'https://www.neds.com.au/':'https://www.ladbrokes.com.au/'};
  const listed=[];const categoryErrors=[];
  // Use a small, sequential discovery batch to avoid request bursts.
  // Full-source discovery is expensive; cycle category groups over time.
  // A filtered sport scans that specific supported category immediately.
  const slot=Math.floor(Date.now()/(30*60*1000));
  const selected=sport?metas.slice(0,1):metas.length?[metas[slot%metas.length]]:[];
  const lists=[];
  for(const meta of selected){
    if(Date.now()>deadline-18000)break;
    try{
      const qs=new URLSearchParams({category_ids:JSON.stringify([meta.id])});
      const data=await getJson(`https://${host}/v2/sport/event-request?${qs.toString()}`,headers,15000);
      lists.push({status:'fulfilled',value:{meta,events:entainListEvents(data)}});
    }catch(e){
      lists.push({status:'rejected',reason:e});
      if(/HTTP 429/.test(String(e?.message||e)))break;
    }
  }
  for(let i=0;i<lists.length;i++){

    const r=lists[i],meta=selected[i];
    if(r.status==='rejected'){categoryErrors.push(`${meta.key}: ${String(r.reason?.message||r.reason).slice(0,120)}`);continue}
    for(const e of r.value.events){
      if(e?.match_status&&e.match_status!=='BettingOpen')continue;
      const ta=teams(e?.name||e?.display_name);if(!ta)continue;
      const time=entainEventTime(e);const candidate={sport:meta.key,home:ta.home,away:ta.away,time};
      if(time&&parseMs(time)>Date.now()+FUTURE_BUFFER_MS)listed.push({meta,e,ta,time,id:String(e?.id??e?.event_id??e?.eventId??'')});
    }
  }
  const dedup=[...new Map(listed.filter(x=>x.id).map(x=>[x.id,x])).values()].sort((a,b)=>parseMs(a.time)-parseMs(b.time)).slice(0,2);
  const cards=[];
  // Two concurrent detail reads improve reliability while avoiding a request burst.
  // Stop scheduling requests before the serverless function approaches its limit.
  for(let i=0;i<dedup.length&&Date.now()<deadline-16000;i+=2){
    const batch=dedup.slice(i,i+2);
    const result=await Promise.allSettled(batch.map(async x=>{
      const card=await getJson(`https://${host}/v2/sport/event-card?id=${encodeURIComponent(x.id)}`,headers,16000);
      return {x,card};
    }));
    result.forEach(r=>cards.push(r));
    if(result.some(r=>r.status==='rejected'&&/HTTP 429/.test(String(r.reason?.message||r.reason))))break;
  }
  // Public provider schema metadata only; helps detect feed format changes.
  const representativeRaw=cards.find(r=>r.status==='fulfilled')?.value?.card;
  const representative=entainCardPayload(representativeRaw);
  let schema_sample;
  if(representativeRaw){
    const markets=Object.entries(representative.markets||{});
    const money=markets.filter(([,m])=>/match betting|head to head|moneyline|match result|full.time result/i.test(String(m?.name||m?.display_name||'')));
    schema_sample={
      payload_keys:Object.keys(representativeRaw||{}).slice(0,12),
      market_count:markets.length,entrant_count:Object.keys(representative.entrants||{}).length,price_count:Object.keys(representative.prices||{}).length,
      named_markets:markets.slice(0,14).map(([k,m])=>({id:k,name:entainMarketName(m),fields:Object.keys(m||{}).slice(0,10)})),
      relevant_markets:money.slice(0,3).map(([k,m])=>({id:k,name:m?.name||m?.display_name,entrant_ids:Array.isArray(m?.entrant_ids)?m.entrant_ids.slice(0,4):m?.entrant_ids,market_keys:Object.keys(m||{}).slice(0,12)})),
      entrant_sample:Object.entries(representative.entrants||{}).slice(0,2).map(([k,v])=>({key:k,fields:Object.keys(v||{}),market_id:v?.market_id,id:v?.id,name:v?.name})),
      price_sample:Object.entries(representative.prices||{}).slice(0,3).map(([k,v])=>({key:k,fields:Object.keys(v||{}),market_id:v?.market_id,entrant_id:v?.entrant_id,odds_fields:Object.keys(v?.odds||{})}))
    };
  }
  const events=[];let cardFailures=0;
  const parser_stats={cards_fetched:0,no_accepted_match_market:0,invalid_fixture_after_parsing:0,accepted:0};
  const rejected_card_samples=[];
  for(const r of cards){
    if(r.status==='rejected'){cardFailures++;continue}
    parser_stats.cards_fetched++;
    const{x,card}=r.value;const sels=entainCardSelections(card,x.ta.home,x.ta.away,x.meta.key);
    if(sels.length<2){
      parser_stats.no_accepted_match_market++;
      if(rejected_card_samples.length<2){
        const payload=entainCardPayload(card);
        const ms=Object.values(payload?.markets||{});
        const marketNames=ms.map(entainMarketName).filter(Boolean);
        const supported=ms.filter(m=>entainFullMatchMarket(m,x.meta.key));
        rejected_card_samples.push({
          sport:x.meta.key,market_count:ms.length,entrant_count:Object.keys(payload?.entrants||{}).length,
          price_count:Object.keys(payload?.prices||{}).length,
          supported_moneyline_markets:supported.length,
          market_names:marketNames.slice(0,12),
          reason:ms.length===0?'no market objects in event card':supported.length===0?'no recognized full-match market': 'recognized market but no valid home/away prices'
        });
      }
      continue
    }
    const item=eventObj(x.meta.key,x.ta.home,x.ta.away,x.time,book,sels,book.toLowerCase());
    if(item){events.push(item);parser_stats.accepted++}
    else parser_stats.invalid_fixture_after_parsing++;
  }
  return{events,listed:listed.length,cards:cards.length,cardFailures,parser_stats,rejected_card_samples,categoryErrors,categories:selected.map(x=>x.key),schema_sample};
}

function merge(events){
  const buckets=[];
  for(const e of events){
    const t=parseMs(e.time);let b=buckets.find(x=>x.sport===e.sport&&Math.abs(parseMs(x.time)-t)<=MATCH_WINDOW_MS&&((same(x.home,e.home)&&same(x.away,e.away))||(same(x.home,e.away)&&same(x.away,e.home))));
    if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set(),outcomeCounts:new Map()};buckets.push(b)}
    b.books.add(e.book);b.outcomeCounts.set(e.book,e.outcomeCount);const rev=same(e.home,b.away)&&same(e.away,b.home);
    for(const o of e.offers){let r=o.role;if(rev&&(r==='home'||r==='away'))r=r==='home'?'away':'home';b.offers.push({...o,role:r})
    }
  }
  return buckets;
}

function comparablePool(b,count){
  const roles=count===3?['home','draw','away']:['home','away'];
  const allowed=new Set([...b.outcomeCounts].filter(([,n])=>n===count).map(([book])=>book));
  if(allowed.size<2)return null;
  const options=roles.map(role=>{
    const byBook=new Map();
    for(const offer of b.offers){
      if(offer.role!==role||!allowed.has(offer.book)||!Number.isFinite(offer.odds)||offer.odds<=1)continue;
      if(!byBook.has(offer.book)||offer.odds>byBook.get(offer.book).odds)byBook.set(offer.book,offer);
    }
    return [...byBook.values()].sort((a,z)=>z.odds-a.odds);
  });
  if(options.some(row=>!row.length))return null;
  // Deliberately compare different bookmakers, including the second-best quote
  // when one bookmaker offers the highest price on every outcome.
  let best=null;
  function tryCombo(index,chosen,used,inv){
    if(best&&inv>=best.inv)return;
    if(index===roles.length){
      if(used.size>=2)best={inv,chosen:[...chosen]};
      return;
    }
    for(const offer of options[index]){
      chosen.push(offer);
      const other=new Set(used);other.add(offer.book);
      tryCombo(index+1,chosen,other,inv+1/offer.odds);
      chosen.pop();
    }
  }
  tryCombo(0,[],new Set(),0);
  if(!best||!Number.isFinite(best.inv))return null;
  return {...best,count,roles,options};
}
function bestComparablePool(b){
  return [comparablePool(b,2),comparablePool(b,3)].filter(Boolean).sort((a,z)=>a.inv-z.inv)[0]||null;
}
function arb(b){
  if(b.books.size<2)return null;
  const candidate=bestComparablePool(b);
  if(!candidate||candidate.inv>=1)return null;
  const {roles,chosen,inv}=candidate;
  const sels=roles.map((r,i)=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:chosen[i].odds,best_bookmaker:chosen[i].book}));
  const roi=(1/inv-1)*100;
  return {event_id:`${b.sport}-${norm(b.home).replace(/\\s/g,'')}-${norm(b.away).replace(/\\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,
    sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',
    source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:sels,
    optimal_stakes:sels.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))};
}

const SOCK_LEAGUES=['nfl','nba','nhl','epl','atp','mlb','la_liga','wta','bundesliga','serie_a'];
const sockCache={until:0,promise:null};
async function sockOdds(){
  const key=process.env.SOCKODDS_API_KEY;
  if(!key)return {events:[],rawEvents:0,configured:false,error:'SOCKODDS_API_KEY not configured on this deployment'};
  if(sockCache.promise&&sockCache.until>Date.now())return sockCache.promise;
  sockCache.until=Date.now()+5*60*1000;
  sockCache.promise=(async()=>{
    const events=[];let rawEvents=0;const observed=new Set();
    try{
      // Use the previously verified query; league-filtered requests returned HTTP 403.
      const params=new URLSearchParams({markets:'winner',regions:'au',group_by:'bookmaker',limit:'20',starts_after:new Date().toISOString()});
      const c=new AbortController(),timer=setTimeout(()=>c.abort(),13000);
      let r;
      try{r=await fetch('https://api.sockodds.com/v1/odds?'+params,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:c.signal})}
      finally{clearTimeout(timer)}
      if(r.status===429){
        const rawRetry=r.headers.get('retry-after');
        const seconds=rawRetry==null?NaN:Number(rawRetry);
        const target=Number.isFinite(seconds)&&seconds>0?Date.now()+seconds*1000:Date.parse(rawRetry||'');
        const hasRetry=Number.isFinite(target)&&target>Date.now();
        // A 429 alone does not tell us whether the minute or monthly quota is exhausted.
        const pauseUntil=hasRetry?Math.min(target,Date.now()+6*60*60*1000):Date.now()+6*60*60*1000;
        sockCache.until=pauseUntil;
        const reason=hasRetry?'SockOdds rate limit (Retry-After supplied)':'SockOdds HTTP 429: rate or quota exhausted, reset time unknown';
        return {events:[],rawEvents:0,configured:true,error:reason,retry_at:new Date(pauseUntil).toISOString()};
      }
      if(!r.ok)return {events:[],rawEvents:0,configured:true,error:'SockOdds HTTP '+r.status};
      const json=await r.json(),rows=Array.isArray(json?.data)?json.data:[];
      rawEvents=rows.length;
      for(const ev of rows){
        if(ev.status!=='scheduled')continue;
        const parts=Array.isArray(ev.participants)?ev.participants:[];
        const hn=parts.find(p=>p.role==='home')?.identity?.name||parts.find(p=>p.role==='home')?.name;
        const an=parts.find(p=>p.role==='away')?.identity?.name||parts.find(p=>p.role==='away')?.name;
        const pair=hn&&an?{home:hn,away:an}:teams(ev.name);
        if(!pair)continue;
        const league=String(ev.league?.key||ev.league||'');
        const sp=/afl/i.test(league)?'afl':/nrl|rlwc|rugby_league/i.test(league)?'nrl':/^(epl|la_liga|bundesliga|serie_a|ligue_1|mls|champions_league)$/.test(league)?'soccer':/^(atp|wta)$/.test(league)?'tennis':/^(nba|nbl)$/.test(league)?'basketball':/^(nfl|ncaaf)$/.test(league)?'nfl':/^(nhl)$/.test(league)?'nhl':/^(mlb)$/.test(league)?'baseball':sportOf(league);
        for(const bm of objValues(ev.bookmakers)){
          const book=String(bm.name||bm.key||'').trim();if(!book)continue;
          const selections=[];
          for(const market of objValues(bm.markets)){
            if(String(market.key||market.market?.key||'').toLowerCase()!=='winner')continue;
            const period=String(market.period||'full').toLowerCase();
            if(!['full','game','match'].includes(period))continue;
            for(const o of objValues(market.outcomes)){
              if(o.available===false)continue;
              const odds=Number(o.decimal_odds);
              const side=String(o.side||'').toLowerCase();
              if(!Number.isFinite(odds)||odds<=1)continue;
              if(side!=='home'&&side!=='away'&&side!=='draw')continue;
              selections.push({role:side,odds,name:o.name});
            }
          }
          const item=eventObj(sp,pair.home,pair.away,ev.scheduled_start,book,selections,'sockodds');
          if(item){events.push(item);observed.add(book)}
        }
      }
      return {events,rawEvents,bookmakers:[...observed],configured:true};
    }catch(e){return {events:[],rawEvents,configured:true,error:'SockOdds request/parser: '+String(e?.message||e).slice(0,160)}}
  })();
  return sockCache.promise;
}


function priceAudit(b){
  if(b.books.size<2)return null;
  const pool=bestComparablePool(b);
  if(!pool)return null;
  const byRole={};
  for(let i=0;i<pool.roles.length;i++){
    byRole[pool.roles[i]]=pool.options[i].map(o=>({role:o.role,odds:o.odds,book:o.book}));
  }
  const allBooks=[...new Set(pool.options.flat().map(o=>o.book))];
  return {fixture:b.home+' vs '+b.away,sport:b.sport,
    roi_pct:Number(((1/pool.inv-1)*100).toFixed(3)),outcomes:pool.count,
    books:allBooks,bookmaker_count:allBooks.length,
    all_bookmaker_prices:byRole,best_odds:pool.chosen.map(o=>({role:o.role,odds:o.odds,book:o.book}))};
}
async function scan(sport){
  const providers=[];
  // Independent feeds run together; an unavailable bookmaker does not block others.
  const [pr,nr,lr,sr]=await Promise.allSettled([
    pointsBet(),
    entainBook('api.neds.com.au','Neds',[],sport),
    entainBook('api.ladbrokes.com.au','Ladbrokes AU',[],sport),
    sockOdds()
  ]);
  const pe=pr.status==='fulfilled'?pr.value:[];
  if(pr.status==='fulfilled')providers.push({provider:'PointsBet AU',ok:true,events:pe.length});
  else providers.push({provider:'PointsBet AU',ok:false,events:0,error:String(pr.reason?.message||pr.reason).slice(0,200)});
  const empty={events:[],listed:0,cards:0,cardFailures:0,categoryErrors:[]};
  const neds=nr.status==='fulfilled'?nr.value:empty;
  const lads=lr.status==='fulfilled'?lr.value:empty;
  for(const [name,result,values] of [['Neds',nr,neds],['Ladbrokes AU',lr,lads]]){
    if(result.status==='fulfilled')providers.push({
      provider:name,ok:!values.categoryErrors?.length,events:values.events.length,
      listed:values.listed,cards:values.cards,card_failures:values.cardFailures,parser_stats:values.parser_stats,
      rejected_card_samples:values.rejected_card_samples,schema_sample:values.schema_sample,
      categories:values.categories||[],
      error:values.categoryErrors?.length?values.categoryErrors.join(' | '):undefined
    });
    else providers.push({provider:name,ok:false,events:0,error:String(result.reason?.message||result.reason).slice(0,200)});
  }
  const sock=sr.status==='fulfilled'?sr.value:{events:[],rawEvents:0,configured:true,error:String(sr.reason?.message||sr.reason)};
  providers.unshift({provider:'SockOdds',ok:!sock.error,events:sock.events.length,listed:sock.rawEvents??0,league:sock.league,configured:sock.configured,bookmakers:sock.bookmakers??[],bookmaker_count:sock.bookmakers?.length??0,retry_at:sock.retry_at,error:sock.error});
  let all=[...pe,...neds.events,...lads.events,...sock.events];
  if(sport)all=all.filter(e=>e.sport===sport);
  const buckets=merge(all);
  const distinctBooks=[...new Set(all.map(x=>x.book))].sort();
  const cross=buckets.filter(b=>b.books.size>=2);
  const arbs=cross.map(arb).filter(Boolean).sort((a,b)=>b.arb_pct-a.arb_pct).slice(0,25);

  const auditReasons={mixed_outcome_counts:0,incomplete_outcomes:0,invalid_prices:0,comparable:0};
  const rejectedExamples=[];
  for(const b of cross){
    const counts=[...b.outcomeCounts.values()];
    const roles=counts[0]===3?['home','draw','away']:['home','away'];
    let reason;
    const groups=[2,3].filter(count=>[...b.outcomeCounts.values()].filter(n=>n===count).length>=2);
    if(!groups.length)reason='mixed_outcome_counts';
    else if(groups.every(count=>(count===3?['home','draw','away']:['home','away']).some(role=>!b.offers.some(o=>o.role===role&&b.outcomeCounts.get(o.book)===count))))reason='incomplete_outcomes';
    else if(groups.every(count=>(count===3?['home','draw','away']:['home','away']).some(role=>!b.offers.some(o=>o.role===role&&b.outcomeCounts.get(o.book)===count&&Number.isFinite(o.odds)&&o.odds>1))))reason='invalid_prices';
    else reason='comparable';
    auditReasons[reason]++;
    if(reason!=='comparable'&&rejectedExamples.length<3)rejectedExamples.push({fixture:b.home+' vs '+b.away,reason,books:[...b.books],outcomes:[...b.outcomeCounts].map(([book,count])=>({book,count}))});
  }
  const audited=cross.map(priceAudit).filter(Boolean).sort((a,b)=>b.roi_pct-a.roi_pct);
  const singles=buckets.filter(b=>b.books.size===1).sort((a,z)=>parseMs(a.time)-parseMs(z.time));
  const singleGames=singles.slice(0,25).map(b=>{
    const best=new Map();
    for(const offer of b.offers)if(!best.has(offer.role)||offer.odds>best.get(offer.role).odds)best.set(offer.role,offer);
    const quotes=[...best.values()].map(o=>({role:o.role,odds:o.odds,book:o.book}));
    const byRole={};
    for(const q of quotes)byRole[q.role]=[q];
    return {fixture:b.home+' vs '+b.away,sport:b.sport,commence_time:b.time,
      bookmaker_count:1,books:[...b.books],all_bookmaker_prices:byRole,best_odds:quotes};
  });
  return {engine:ENGINE,scanned_at:new Date().toISOString(),providers,active_bookmakers:distinctBooks,active_bookmaker_count:distinctBooks.length,merged_games:buckets.length,cross_book_games:cross.length,comparable_markets:audited.length,validation_reasons:auditReasons,rejected_examples:rejectedExamples,closest_markets:audited.slice(0,5),comparisons:audited.slice(0,35),single_book_games_total:singles.length,single_book_games:singleGames,arbs:arbs.length,results:arbs,scan_scope:'Limited requests with cooldown on provider rate limits'};
}
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
  const raw=typeof req.query.sport_key==='string'?req.query.sport_key.trim().toLowerCase():'';
  const sport=ALIASES.get(raw)||raw,mode=String(req.query.market_mode||'all').toLowerCase(),debug=String(req.query.debug||'')==='1';
  if(!['all','h2h','lines','spreads','totals'].includes(mode))return res.status(400).json({error:'Unsupported market_mode'});
  if(!['all','h2h'].includes(mode)&&!debug)return res.status(200).json([]);
  const key=sport||'all';let item=scanCache.get(key);
  if(!item||item.expires<Date.now()){
    item={expires:Date.now()+90*1000,promise:scan(sport)};
    scanCache.set(key,item);
  }
  try{
    const data=await item.promise;
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=300');
    return res.status(200).json(debug?data:data.results);
  }catch(e){
    scanCache.delete(key);
    return res.status(503).json({error:'Odds sources temporarily unavailable',detail:String(e?.message||e).slice(0,180)});
  }
}
