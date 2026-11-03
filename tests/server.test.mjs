import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';

test('local server serves the app on Windows, restricts methods and confines static paths',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'fw-test-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',WORKROOM_DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
  try {
    const base=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),5000);
      let output='';child.stdout.on('data',data=>{output+=data;const match=output.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited with ${code}`));});
    });
    const health=await fetch(base+'/health');assert.deepEqual(await health.json(),{ok:true,mode:'live',trading:false});
    const home=await fetch(base+'/');assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(await home.text(),/봇 작업실/);
    const script=await fetch(base+'/app.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
    const vendor=await fetch(base+'/vendor/lightweight-charts.js');assert.equal(vendor.status,200);
    assert.equal((await fetch(base+'/health',{method:'POST'})).status,405);
    assert.ok([403,404].includes((await fetch(base+'/%2e%2e%5cserver.mjs')).status));
    assert.equal((await fetch(base+'/missing-file')).status,404);
    assert.equal((await fetch(base+'/api/status')).status,403);
    assert.equal((await fetch(base+'/api/storage/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/formula/markets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:'BTCUSDT',source:'A.종가@1h'})})).status,403);
    assert.equal((await fetch(base+'/api/positions/insights')).status,403);
    const {token}=await (await fetch(base+'/api/session')).json();const headers={'X-Workroom-Token':token,'Content-Type':'application/json'};
    const status=await (await fetch(base+'/api/status',{headers})).json();assert.equal(status.connected,false);assert.equal(status.storageFault,null);
    assert.equal((await fetch(base+'/api/storage/retry',{method:'POST',headers,body:'{}'})).status,200);assert.deepEqual(status.bots,[]);assert.deepEqual(status.positionOwners,[]);
    for(const body of [{symbol:'../bad',source:'TRUE@1h'},{symbol:'BTCUSDT',source:'A.constructor@1h'},{symbol:'BTCUSDT',source:'A.종가@1h',aliases:{A:'../bad'}}])assert.equal((await fetch(base+'/api/formula/markets',{method:'POST',headers,body:JSON.stringify(body)})).status,400);
    assert.equal((await fetch(base+'/api/positions/insights',{headers})).status,400);
    assert.equal((await fetch(base+'/api/trading',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{"enabled":true}'})).status,403);
    const reboundStatus=await new Promise((resolve,reject)=>{const request=httpRequest(base+'/api/status',{headers:{...headers,Host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});assert.equal(reboundStatus,403);
    assert.equal((await fetch(base+'/api/trading',{method:'POST',headers,body:'{"enabled":true}'})).status,400);
  } finally { const exited=once(child,'exit');child.kill();await exited;assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'fw-test-'));await rm(directory,{recursive:true,force:true}); }
});
