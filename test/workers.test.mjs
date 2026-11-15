import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerPool} from '../server/workers.mjs';

test('timeout rejects queued calls promptly and the next request gets a fresh worker',async()=>{
 const pool=new WorkerPool({store:{},stateDir:'/unused',callTimeoutMs:30,log:()=>{}});
 let starts=0,closed=0;
 pool.get=async()=>{
  if(pool.workers.has('binding'))return pool.workers.get('binding');
  const generation=++starts;
  const worker={closed:false,busy:0,used:Date.now(),queue:Promise.resolve(),call:()=>generation===1?new Promise(()=>{}):Promise.resolve({ok:true}),close(){this.closed=true;closed++;}};
  pool.workers.set('binding',worker);return worker;
 };
 const binding={id:'binding',service:'mailbridge'};
 try{
  const results=await Promise.allSettled([pool.call(binding,'tools/call'),pool.call(binding,'tools/list'),pool.call(binding,'tools/list')]);
  assert.equal(results[0].reason.status,504);
  assert.deepEqual(results.slice(1).map(r=>r.reason.status),[503,503]);
  assert.equal(closed,1);
  assert.deepEqual(await pool.call(binding,'tools/list'),{ok:true});
  assert.equal(starts,2);
 }finally{pool.close();}
});

test('synchronous worker failures do not keep a timeout alive or break the queue',async()=>{
 const records=[],pool=new WorkerPool({store:{},stateDir:'/unused',callTimeoutMs:20,log:r=>records.push(r)});
 let count=0;
 const worker={closed:false,busy:0,queue:Promise.resolve(),call:()=>{if(!count++)throw Error('upstream');return Promise.resolve({ok:true});}};
 pool.get=async()=>worker;
 try{
  await assert.rejects(pool.call({id:'binding',service:'mailbridge'},'tools/list'),/upstream/);
  assert.deepEqual(await pool.call({id:'binding',service:'mailbridge'},'tools/list'),{ok:true});
  await new Promise(r=>setTimeout(r,40));assert.equal(records.length,0);assert.equal(worker.busy,0);
 }finally{pool.close();}
});
