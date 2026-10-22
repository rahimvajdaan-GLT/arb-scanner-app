const ENGINE='au-openbooks-v29-bookmaker-identity';
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
      hostCooldown.set(host,Date.now()+(Number.isFinite(retry)&&retry>0?Math.min(retry*1000,3600000):15*60*1000));
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
function same(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y||x.replace(/\s/g,'')===y.replace(/\s/g,''))return true;if(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x)))return true;const A=new Set(x.split(' ')),B=new Set(y.split(' '));return [...A].filter(z=>B.has(z)).length/Math.max(1,Math.min(A.size,B.size))>=.6}
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
  return{sport,home:h,away:a,time:iso,book,offers:[...best.values()],outcomeCount:best.size,source};
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
  // Use a small, sequential discovery batch to avoid request bursts.
  const selected=metas.slice(0,3);
  const lists=[];
  for(const meta of selected){
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
  const dedup=[...new Map(listed.filter(x=>x.id).map(x=>[x.id,x])).values()].sort((a,b)=>parseMs(a.time)-parseMs(b.time)).slice(0,8);
  const cards=[];
  for(const x of dedup){
    try{
      const card=await getJson(`https://${host}/v2/sport/event-card?id=${encodeURIComponent(x.id)}`,headers,16000);
      cards.push({status:'fulfilled',value:{x,card}});
    }catch(e){
      cards.push({status:'rejected',reason:e});
      if(/HTTP 429/.test(String(e?.message||e)))break;
    }
  }
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
    if(!b){b={sport:e.sport,home:e.home,away:e.away,time:e.time,offers:[],books:new Set(),outcomeCounts:new Map()};buckets.push(b)}
    b.books.add(e.book);b.outcomeCounts.set(e.book,e.outcomeCount);const rev=same(e.home,b.away)&&same(e.away,b.home);
    for(const o of e.offers){let r=o.role;if(rev&&(r==='home'||r==='away'))r=r==='home'?'away':'home';b.offers.push({...o,role:r})
    }
  }
  return buckets;
}
function arb(b){
  if(b.books.size<2)return null;
  // Two-way and three-way match-winner markets have different settlement rules.
  // Never combine them into a synthetic arbitrage.
  // Do not discard an entire fixture when providers quote different settlement markets.
  // Evaluate two-way and three-way pools independently, never mix their selections.
  const candidates=[];
  for(const count of [2,3]){
    const roles=count===3?['home','draw','away']:['home','away'];
    const allowed=new Set([...b.outcomeCounts].filter(([,n])=>n===count).map(([name])=>name));
    if(allowed.size<2)continue;
    const best={};
    for(const offer of b.offers){
      if(!allowed.has(offer.book)||!roles.includes(offer.role))continue;
      if(!best[offer.role]||offer.odds>best[offer.role].odds)best[offer.role]=offer;
    }
    if(roles.some(r=>!best[r]))continue;
    const sels=roles.map(r=>({name:r==='home'?b.home:r==='away'?b.away:'Draw',point:null,best_price:Number(best[r].odds),best_bookmaker:best[r].book}));
    if(new Set(sels.map(x=>x.best_bookmaker)).size<2)continue;
    const inv=sels.reduce((sum,x)=>sum+1/x.best_price,0);
    if(Number.isFinite(inv)&&inv<1)candidates.push({sels,inv});
  }
  if(!candidates.length)return null;
  const {sels,inv}=candidates.sort((a,z)=>a.inv-z.inv)[0];
  const roi=(1/inv-1)*100;

  return{event_id:`${b.sport}-${norm(b.home).replace(/\s/g,'')}-${norm(b.away).replace(/\s/g,'')}-${Math.round(parseMs(b.time)/60000)}`,sport_key:b.sport,home_team:b.home,away_team:b.away,commence_time:b.time,market_type:'h2h',source_type:ENGINE,is_arb:true,arb_pct:Number(roi.toFixed(3)),selections:sels,optimal_stakes:sels.map(x=>({name:x.name,point:null,price:x.best_price,bookmaker:x.best_bookmaker,stake:((1/x.best_price)/inv)*100}))};
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
 const candidates=[];
 for(const count of [2,3]){
   const eligible=[...b.outcomeCounts].filter(([,n])=>n===count).map(([name])=>name);
   if(eligible.length<2)continue;
   const roles=count===3?['home','draw','away']:['home','away'];
   const best=roles.map(role=>b.offers.filter(o=>eligible.includes(o.book)&&o.role===role).sort((a,z)=>z.odds-a.odds)[0]);
   if(best.some(o=>!o))continue;
   if(new Set(best.map(o=>o.book)).size<2)continue;
   const inv=best.reduce((sum,o)=>sum+1/o.odds,0);
   if(Number.isFinite(inv))candidates.push({inv,count,best});
 }
 if(!candidates.length)return null;
 const {inv,count,best}=candidates.sort((a,z)=>a.inv-z.inv)[0];
 const allPrices=b.offers.filter(o=>b.outcomeCounts.get(o.book)===count&&Number.isFinite(o.odds)&&o.odds>1).map(o=>({role:o.role,odds:o.odds,book:o.book}));
 const byRole={};for(const role of count===3?['home','draw','away']:['home','away'])byRole[role]=allPrices.filter(o=>o.role===role).sort((x,y)=>y.odds-x.odds).slice(0,15);
 return {fixture:b.home+' vs '+b.away,sport:b.sport,
   roi_pct:Number(((1/inv-1)*100).toFixed(3)),outcomes:count,
   books:[...new Set(allPrices.map(o=>o.book))],bookmaker_count:new Set(allPrices.map(o=>o.book)).size,
   all_bookmaker_prices:byRole,best_odds:best.map(o=>({role:o.role,odds:o.odds,book:o.book}))};
}
async function scan(sport){
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

  const sock=await sockOdds();
  providers.unshift({provider:'SockOdds',ok:!sock.error,events:sock.events.length,listed:sock.rawEvents??0,league:sock.league,configured:sock.configured,bookmakers:sock.bookmakers??[],bookmaker_count:sock.bookmakers?.length??0,error:sock.error});
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
  return {engine:ENGINE,providers,active_bookmakers:distinctBooks,active_bookmaker_count:distinctBooks.length,merged_games:buckets.length,cross_book_games:cross.length,comparable_markets:audited.length,validation_reasons:auditReasons,rejected_examples:rejectedExamples,closest_markets:audited.slice(0,5),comparisons:audited.slice(0,35),arbs:arbs.length,results:arbs,scan_scope:'Limited requests with cooldown on provider rate limits'};
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
    res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=30');
    return res.status(200).json(debug?data:data.results);
  }catch(e){
    scanCache.delete(key);
    return res.status(503).json({error:'Odds sources temporarily unavailable',detail:String(e?.message||e).slice(0,180)});
  }
}
