import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {Store} from '../server/store.mjs';
import {WorkerPool} from '../server/workers.mjs';

test('real Linux workers isolate account data and reject private URLs', {skip:process.env.MCP_WORKER_INTEGRATION!=='1'}, async()=>{
 const stateDir=mkdtempSync('/var/lib/mcp-center/verification-');
 const store=new Store(':memory:',randomBytes(32));
 const pool=new WorkerPool({store,stateDir});
 try{
  const alice=await store.createUser('alice','test-only-password-alice'),bob=await store.createUser('bob','test-only-password-bob');
  const account=(u,s,c)=>store.createAccount(u.id,s,'test','test@example.com',c);
  const binding=(u,a)=>({id:randomUUID(),user_id:u.id,service:a.service,accounts:[a.id]});
  const a=account(alice,'mailbridge',{kind:'imap',provider:'qq',email:'alice@example.com',password:'dummy'}),b=account(bob,'mailbridge',{kind:'imap',provider:'qq',email:'bob@example.com',password:'dummy'});
  const ab=binding(alice,a),bb=binding(bob,b);
  for(const [bound,own,other]of [[ab,a,b],[bb,b,a]]){
   const tools=await pool.call(bound,'tools/list');assert(tools.tools.length>10);
   const list=await pool.call(bound,'tools/call',{name:'mail_list_accounts',arguments:{}});assert(!list.isError);const text=JSON.stringify(list);assert(text.includes(own.id));assert(!text.includes(other.id));assert(!text.includes('dummy'));
   const denied=await pool.call(bound,'tools/call',{name:'mail_list_folders',arguments:{account:other.id}});assert(denied.isError);
  }
  for(const [service,creds,tool]of [['xuexitong',{phone:'13800000000',password:'dummy'},null],['agent-reach',{},'reach_channels'],['transcriptor',{cookies:''},null],['momo',{token:'invalid-test-token-12345'},null]]){
   const a=account(alice,service,creds),bound=binding(alice,a);const list=await pool.call(bound,'tools/list');assert(list.tools.length>0);assert(!list.tools.some(t=>t.name==='login'));
   if(tool){const result=await pool.call(bound,'tools/call',{name:tool,arguments:{}});assert(!result.isError);assert(!JSON.stringify(result).includes('INVALID_OUTPUT'));}
   if(service==='transcriptor')await assert.rejects(pool.call(bound,'tools/call',{name:'get_video_info',arguments:{url:'http://127.0.0.1:18760/mcp'}}));
   console.log(service+': '+list.tools.length+' tools');
  }
 }finally{pool.close();store.close();rmSync(stateDir,{recursive:true,force:true});}
});
