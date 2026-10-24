'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const SEO=require('../scripts/seo-manager.cjs');

const SITE=SEO.ORIGIN;
function testSite(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arb-seo-'));
 function page(name,title,desc=true,canonical=true,robots=''){
  let html='<!doctype html><html><head><title>'+title+'</title>';
  if(desc)html+='<meta name="description" content="Useful factual guidance about sports odds and balanced wagers.">';
  if(canonical)html+='<link rel="canonical" href="'+SITE+(name==='index.html'?'/':'/'+name)+'">';
  if(robots)html+='<meta name="robots" content="'+robots+'">';
  fs.writeFileSync(path.join(dir,name),html+'</head><body><h1>'+title+'</h1></body></html>');
 }
 try{return fn({dir,page})}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('SEO generator lists only existing canonical indexable pages',()=>testSite(({dir,page})=>{
 page('index.html','Homepage');page('scanner.html','Scanner');page('bookmakers.html','Bookmakers');
 page('account.html','Account');page('login.html','Login');page('404.html','404');
 page('hidden.html','Hidden',true,true,'noindex');
 const report=SEO.run('--apply',dir,true);
 assert.deepEqual(report.pagesIncluded,['index.html','scanner.html','bookmakers.html']);
 const map=fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8');
 assert.match(map,/<loc>https:\/\/arb-scanner-app\.vercel\.app\/bookmakers\.html<\/loc>/);
 assert.doesNotMatch(map,/account\.html|login\.html|404\.html|hidden\.html|<lastmod>/);
 assert.equal((map.match(/<url>/g)||[]).length,3);
 assert.equal(SEO.run('--check',dir).status,'clean');
 assert.equal(SEO.run('--apply',dir,true).changed.length,0);
}));
test('SEO generator detects bad canonical and never promotes fake URLs',()=>testSite(({dir,page})=>{
 page('index.html','Home');
 page('bad.html','Incorrect canonical',true,false);
 const report=SEO.run('--audit',dir,false);
 assert.equal(report.pagesIncluded.length,1);
 assert.equal(report.recommendations[0].reason,'missing-canonical');
 assert.deepEqual(report.changed.sort(),['robots.txt','sitemap.xml']);
}));
test('SEO audit does not modify any files until apply',()=>testSite(({dir,page})=>{
 page('scanner.html','Scanner');
 const audit=SEO.run('--audit',dir,false);
 assert.equal(audit.changed.length,2);
 assert.equal(fs.existsSync(path.join(dir,'sitemap.xml')),false);
 assert.equal(SEO.run('--check',dir,false).status,'out-of-date');
}));
test('real website metadata produces useful sitemap including bookmaker connections',()=>{
 const r=SEO.analyze();
 assert.ok(r.included.includes('index.html'));
 assert.ok(r.included.includes('scanner.html'));
 assert.ok(r.included.includes('bookmakers.html'));
 assert.ok(!r.included.includes('account.html'));
 assert.ok(!r.included.includes('login.html'));
 assert.deepEqual(r.warnings,[],'fix factual page metadata rather than silently excluding intended pages');
});
