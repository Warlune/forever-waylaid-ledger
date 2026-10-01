import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
const app = readFileSync(new URL('../dist/app.js', import.meta.url),'utf8');
function harness(fetcher = async()=>{throw Error('offline');}) {
  const elements = new Map();
  const element = key => {
    if(!elements.has(key)) elements.set(key,{innerHTML:'',textContent:'',value:'',setAttribute(){}});
    return elements.get(key);
  };
  const ctx={document:{querySelector:element,querySelectorAll:()=>[],documentElement:{dataset:{}}},
    window:{ShoppingTab:{setFaction(){}}},localStorage:{setItem(){}},fetch:fetcher};
  runInNewContext(app.replace(/initialize\(\);\s*$/, `renderStatus=()=>{};renderResults=()=>{};globalThis.api={state,setFaction,loadPrices,parsePriceTable};`),ctx);
  return {...ctx.api,element};
}
test('website has no owner scan requests or source control',()=>{
  assert.doesNotMatch(app,/owner-scan|OWNER_|parseOwnerSnapshot|price-source/);
  assert.doesNotMatch(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),/Owner scan|Owner Auctionator|price-source/);
});
test('all realm types retain separate faction markets',async()=>{
  const h=harness();
  for(const f of ['horde','alliance']) for(const type of ['pvp','normal','rp']) {
    await h.setFaction(f,{market:`forever.${type}.${f}.us`,animate:false});
    assert.equal(h.state.market,`forever.${type}.${f}.us`);
    assert.match(h.element('#scan-help-copy').textContent,/AHledger/);
  }
});
test('AHledger refresh keeps last good feed on errors and ignores older scans',async()=>{
  let body='AHL1|forever/pvp/horde/us|200|1\n123:500:400:2',fail=false;
  const urls=[];
  const h=harness(async url=>{urls.push(url);if(fail)throw Error('offline');return{ok:true,text:async()=>body};});
  await h.loadPrices();assert.equal(h.state.prices.get(123).min,400);
  body='AHL1|forever/pvp/horde/us|100|1\n123:500:100:2';
  await h.loadPrices();assert.equal(h.state.prices.get(123).min,400);
  fail=true;await h.loadPrices();assert.equal(h.state.priceState,'ready');assert.equal(h.state.prices.get(123).min,400);
  assert.ok(urls.every(u=>u==='https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us'));
});
test('in-flight response cannot leak Horde prices into Alliance',async()=>{
  let finish;
  const h=harness(()=>new Promise(resolve=>finish=resolve));
  const pending=h.loadPrices();
  h.state.market='forever.pvp.alliance.us';h.state.marketGeneration++;
  finish({ok:true,text:async()=>'AHL1|forever/pvp/horde/us|200|1\n123:500:400:2'});
  await pending;assert.equal(h.state.prices.size,0);
});
