const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../scanner.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../games-board.js'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'../api/arbitrage.js'),'utf8');
test('games board is loaded on scanner without an extra API request',()=>{
 assert.match(html,/id="gamesBoard"/);
 assert.match(html,/id="gamesBoardMode"/);
 assert.match(html,/games-board\.js\?v=1/);
 assert.match(js,/addEventListener\('arb:scan'/);
 assert.doesNotMatch(js,/fetch\s*\(/);
});
test('single bookmaker and comparison feeds displayed without fabrication',()=>{
 assert.match(js,/data\?\.comparisons/);
 assert.match(js,/data\?\.single_book_games/);
 assert.match(js,/One bookmaker · no arb comparison/);
 assert.match(js,/No positive arb/);
 assert.match(api,/commence_time:b\.time/);
});
test('quotes expired and fetch failures clear game listings',()=>{
 assert.match(js,/arb:scan-expired/);
 assert.match(js,/arb:scan-error/);
 assert.match(js,/snapshot=null/);
});
