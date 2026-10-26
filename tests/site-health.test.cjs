'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runChecks,assetPath}=require('../scripts/site-health.cjs');
const SEO=require('../scripts/seo-manager.cjs');

const SAMPLE_PAGE='<html><button id="scanLiveBtn"></button><section id="scanCoverageText"></section><div id="liveResults"></div><details id="feedDetails"></details><script src="/live.js?v=46"></script></html>';
const SCRIPT="function buildBoard(x) { return x.filter(item=>item.plan.profit > 0) } new CustomEvent('arb:scan', {detail:null})";
function mocked(status=200,body=''){
  return {ok:status>=200&&status<300,status,text:async()=>body};
}
function seoResponse(url){
  if(url.endsWith('/robots.txt'))return mocked(200,SEO.robots());
  if(url.endsWith('/sitemap.xml'))return mocked(200,SEO.sitemap(SEO.analyze().included));
  return null;
}
test('health checker verifies correct deployment without calling odds-consuming APIs',async()=>{
  const requested=[];
  const fetchImpl=async url=>{
    requested.push(url);
    const seo=seoResponse(url);if(seo)return seo;
    if(url.includes('/scanner.html'))return mocked(200,SAMPLE_PAGE);
    if(url.includes('/live.js?v=46'))return mocked(200,SCRIPT);
    if(url.includes('/api/sports'))return mocked(200,JSON.stringify([{key:'afl',title:'Australian Rules'}]));
    return mocked(404,'not found');
  };
  const report=await runChecks({siteUrl:'https://arb-scanner-app.vercel.app',fetchImpl,localHtml:SAMPLE_PAGE});
  assert.equal(report.ok,true,JSON.stringify(report.checks));
  assert.equal(report.oddsApiTested,false);
  assert.equal(requested.length,5);
  assert.equal(report.checks.find(x=>x.name==='robots-txt').status,'pass');
  assert.equal(report.checks.find(x=>x.name==='sitemap-xml').status,'pass');
  assert.equal(requested.some(url=>url.includes('/api/arbitrage')),false);
});
test('health checker detects old production JavaScript version',async()=>{
  const requested=[];
  const fetchImpl=async url=>{
    requested.push(url);
    const seo=seoResponse(url);if(seo)return seo;
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
    const seo=seoResponse(url);if(seo)return seo;
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

test('health checker rejects missing, redirected, malformed or stale production SEO assets',async t=>{
  const expectedMap=SEO.sitemap(SEO.analyze().included);
  const cases=[
    {name:'missing sitemap',resource:'/sitemap.xml',response:mocked(404,'not found'),check:'sitemap-xml'},
    {name:'redirected sitemap',resource:'/sitemap.xml',response:mocked(302,''),check:'sitemap-xml'},
    {name:'malformed sitemap',resource:'/sitemap.xml',response:mocked(200,'<urlset>'),check:'sitemap-xml'},
    {name:'stale sitemap',resource:'/sitemap.xml',response:mocked(200,expectedMap.replace('/scanner.html','/removed.html')),check:'sitemap-xml'},
    {name:'robots missing sitemap directive',resource:'/robots.txt',response:mocked(200,SEO.robots().replace(/^Sitemap:.*\\n/m,'')),check:'robots-txt'},
    {name:'redirected robots',resource:'/robots.txt',response:mocked(302,''),check:'robots-txt'}
  ];
  for(const scenario of cases){
    await t.test(scenario.name,async()=>{
      const requested=[];
      const fetchImpl=async url=>{
        requested.push(url);
        if(url.endsWith(scenario.resource))return scenario.response;
        if(url.endsWith('/scanner.html'))return mocked(200,SAMPLE_PAGE);
        if(url.includes('/live.js?v=46'))return mocked(200,SCRIPT);
        if(url.endsWith('/api/sports'))return mocked(200,JSON.stringify([{key:'afl',title:'AFL'}]));
        return seoResponse(url)||mocked(404,'not found');
      };
      const report=await runChecks({fetchImpl,localHtml:SAMPLE_PAGE});
      assert.equal(report.ok,false,scenario.name);
      assert.equal(report.checks.find(x=>x.name===scenario.check).status,'fail',scenario.name);
      assert.equal(requested.some(url=>url.includes('/api/arbitrage')),false);
    });
  }
});
