const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseAuthorizedHtml} = require('../lib/authorized-html-collector.cjs');

const now = Date.parse('2026-11-14T12:00:00Z');
const event = {
  '@context':'https://schema.org','@type':'SportsEvent',startDate:'2026-11-14T15:00:00Z',
  homeTeam:{name:'Sydney'},awayTeam:{name:'Melbourne'},
  offers:[{name:'Sydney',price:2.15},{name:'Melbourne',price:1.90}]
};
const html = data => `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;
const args = {source:'authorized-fixture',sport:'afl',bookmaker:'Book A',approved:true,capturedAt:'2026-11-14T11:59:30Z',now};

test('permissioned HTML schema snapshot becomes a comparable full-match quote',()=>{
  const result=parseAuthorizedHtml({...args,html:html(event)});
  assert.equal(result.length,1);
  assert.deepEqual(result[0].offers.map(o=>[o.role,o.odds]),[['home',2.15],['away',1.9]]);
  assert.equal(result[0].book,'Book A');
});
test('collector refuses sources not explicitly approved',()=>{
  assert.throws(()=>parseAuthorizedHtml({...args,approved:false,html:html(event)}),/permission/);
});
test('rejects stale snapshots, past fixtures and unrelated markets',()=>{
  assert.equal(parseAuthorizedHtml({...args,capturedAt:'2026-11-14T11:45:00Z',html:html(event)}).length,0);
  assert.equal(parseAuthorizedHtml({...args,html:html({...event,startDate:'2026-11-14T11:00:00Z'})}).length,0);
  assert.equal(parseAuthorizedHtml({...args,html:html({...event,offers:[{name:'First half Sydney',price:2.5},{name:'Melbourne',price:1.9}]})}).length,0);
});
test('soccer must include draw prices; malformed scripts do not cause requests',()=>{
  assert.equal(parseAuthorizedHtml({...args,sport:'soccer',html:html(event)}).length,0);
  const withDraw={...event,offers:[...event.offers,{name:'Draw',price:3.2}]};
  assert.equal(parseAuthorizedHtml({...args,sport:'soccer',html:html(withDraw)}).length,1);
  assert.deepEqual(parseAuthorizedHtml({...args,html:'<script type="application/ld+json">oops</script>'}),[]);
});
