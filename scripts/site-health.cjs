#!/usr/bin/env node
'use strict';
// Health monitor does NOT fetch /api/arbitrage or consume bookmaker API quota.
const fs=require('node:fs');
const path=require('node:path');
const DEFAULT_SITE='https://arb-scanner-app.vercel.app';
function baseUrl(raw){
  const u=new URL(raw||DEFAULT_SITE);
  if(!['http:','https:'].includes(u.protocol))throw new Error('SITE_URL must use HTTP(S)');
  return u.origin;
}
function assetPath(html){
  const match=String(html).match(/<script\s+src=["'](\/live\.js\?v=\d+)["']/i);
  return match?.[1]||null;
}
async function request(base,p,fetchImpl){
  const url=new URL(p,base).href;
  let last;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await fetchImpl(url,{
        redirect:'manual',
        headers:{Accept:'text/html,application/json,text/javascript,*/*','Cache-Control':'no-cache','User-Agent':'TopNotchArb-Maintainer/1.0'},
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)throw new Error('HTTP '+response.status);
      const body=await response.text();
      if(body.length>1250000)throw new Error('Response unexpectedly large');
      return body;
    }catch(e){last=e;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1200))}
  }
  throw new Error(p+': '+String(last?.message||last));
}
async function runChecks({siteUrl=DEFAULT_SITE,fetchImpl=fetch,localHtml}={}){
  const base=baseUrl(siteUrl),checks=[];
  function record(name,ok,detail){checks.push({name,status:ok?'pass':'fail',detail:String(detail).slice(0,400)})}
  const expectedHtml=localHtml===undefined?fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8'):localHtml;
  const expectedAsset=assetPath(expectedHtml);
  try{
    const html=await request(base,'/scanner.html',fetchImpl);
    const required=['id="scanLiveBtn"','id="liveResults"','id="scanCoverageText"','id="feedDetails"'];
    const absent=required.filter(marker=>!html.includes(marker));
    record('scanner-page',!absent.length,absent.length?'Missing UI: '+absent.join(', '):'Scanner controls and positive-only sections present');
    const actualAsset=assetPath(html);
    record('production-version',Boolean(actualAsset&&actualAsset===expectedAsset),
      'production='+(actualAsset||'not found')+' repository='+(expectedAsset||'not found'));
    if(actualAsset){
      try{
        const js=await request(base,actualAsset,fetchImpl);
        const ok=js.includes('function buildBoard(')&&js.includes('plan.profit > 0')&&js.includes("new CustomEvent('arb:scan'");
        record('frontend-script',ok,ok?'Positive-only filter and scan event present':'Missing scanner functionality');
      }catch(e){record('frontend-script',false,e.message)}
    }else record('frontend-script',false,'No versioned scanner JavaScript reference found');
  }catch(e){
    record('scanner-page',false,e.message);
    record('production-version',false,'Could not load scanner page');
    record('frontend-script',false,'Could not load scanner page');
  }
  try{
    const data=JSON.parse(await request(base,'/api/sports',fetchImpl));
    const ok=Array.isArray(data)&&data.some(item=>item&&item.key&&item.title);
    record('sports-catalog',ok,ok?data.length+' sports returned':'Missing or invalid sports catalog');
  }catch(e){record('sports-catalog',false,e.message)}
  return {checkedAt:new Date().toISOString(),site:base,ok:checks.every(x=>x.status==='pass'),checks,
    oddsApiTested:false,note:'No bookmaker API requests. Cannot guarantee profitable opportunities.'};
}
if(require.main===module){
  runChecks({siteUrl:process.env.SITE_URL||DEFAULT_SITE}).then(result=>{
    fs.mkdirSync('reports',{recursive:true});
    fs.writeFileSync('reports/site-health.json',JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
    if(process.env.GITHUB_STEP_SUMMARY){
      const rows=result.checks.map(x=>'| '+x.name+' | '+(x.status==='pass'?'Pass':'FAIL')+' | '+x.detail.replace(/\|/g,'/')+' |').join('\n');
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Top Notch Arb site health\n\n| Check | Result | Detail |\n|---|---|---|\n'+rows+'\n\nNo bookmaker-credit-consuming endpoints called.\n');
    }
    if(!result.ok)process.exitCode=1;
  }).catch(e=>{console.error('Monitor failed: '+e.message);process.exitCode=1});
}
module.exports={runChecks,assetPath,baseUrl};
