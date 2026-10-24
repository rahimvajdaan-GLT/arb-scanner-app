'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runChecks,assetPath}=require('../scripts/site-health.cjs');

const SAMPLE_PAGE='<html><button id="scanLiveBtn"></button><section id="scanCoverageText"></section><div id="liveResults"></div><details id="feedDetails"></details><script src="/live.js?v=46"></script></html>';
const SCRIPT="function buildBoard(x) { return x.filter(item=>item.plan.profit > 0) } new CustomEvent('arb:scan', {detail:null})";
function mocked(status=200,body=''){
  return {ok:status>=200&&status<300,status,text:async()=>body};
}
test('health checker verifies correct deployment without calling odds-consuming APIs',async()=>{
  const requested=[];
  const fetchImpl=async url=>{
    requested.push(url);
    if(url.includes('/scanner.html'))return mocked(200,SAMPLE_PAGE);
    if(url.includes('/live.js?v=46'))return mocked(200,SCRIPT);
    if(url.includes('/api/sports'))return mocked(200,JSON.stringify([{key:'afl',title:'Australian Rules'}]));
    return mocked(404,'not found');
  };
  const report=await runChecks({siteUrl:'https://arb-scanner-app.vercel.app',fetchImpl,localHtml:SAMPLE_PAGE});
  assert.equal(report.ok,true,JSON.stringify(report.checks));
  assert.equal(report.oddsApiTested,false);
  assert.equal(requested.length,3);
  assert.equal(requested.some(url=>url.includes('/api/arbitrage')),false);
});
test('health checker detects old production JavaScript version',async()=>{
  const requested=[];
  const fetchImpl=async url=>{
    requested.push(url);
    if(url.includes('/scanner.html'))return mocked(200,SAMPLE_PAGE.replace('v=46','v=45'));
    if(url.includes('/live.js?v=45'))return mocked(200,SCRIPT);
    return mocked(200,JSON.stringify([{key:'afl',title:'AFL'}]));
  };
  const report=await runChecks({fetchImpl,localHtml:SAMPLE_PAGE});
  assert.equal(report.ok,false);
  assert.equal(report.checks.find(x=>x.name==='production-version').status,'fail');
});
test('health checker detects missing UI elements and script failures',async()=>{
  const fetchImpl=async url=>{
    if(url.includes('/scanner.html'))return mocked(200,SAMPLE_PAGE.replace('id="scanCoverageText"','id="not-working"'));
    if(url.includes('/live.js'))return mocked(200,'function unrelated(){}');
    return mocked(200,JSON.stringify([{key:'afl',title:'AFL'}]));
  };
  const report=await runChecks({fetchImpl,localHtml:SAMPLE_PAGE});
  assert.equal(report.ok,false);
  assert.equal(report.checks.find(x=>x.name==='scanner-page').status,'fail');
  assert.equal(report.checks.find(x=>x.name==='frontend-script').status,'fail');
});
test('health checker recognizes versioned bundle',()=>assert.equal(assetPath(SAMPLE_PAGE),'/live.js?v=46'));
