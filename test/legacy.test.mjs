import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Store,now} from '../server/store.mjs';
import {recoverConnections} from '../server/legacy.mjs';
import {createApp} from '../server/app.mjs';

test('recover authorized ChatGPT connections without modifying or exposing legacy credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mcp-legacy-')),database=join(dir,'legacy.sqlite'),store=new Store(':memory:',randomBytes(32));let server;
 try{
  const source=new DatabaseSync(database);source.exec('CREATE TABLE oauth(kind TEXT,key TEXT,value TEXT,expires INTEGER,PRIMARY KEY(kind,key))');
  const put=(kind,key,data,expires=0)=>source.prepare('INSERT INTO oauth VALUES (?,?,?,?)').run(kind,key,JSON.stringify(data),expires);
  for(const [id,redirect]of [['real','https://chatgpt.com/connector_platform_oauth_redirect'],['test','https://example.org/callback'],['expired','https://chatgpt.com/connector_platform_oauth_redirect'],['registered-only','https://chatgpt.com/connector_platform_oauth_redirect']]){
   put('client',id,{client_name:'ChatGPT',client_secret:'private-'+id,redirect_uris:[redirect],client_id_issued_at:now()-86400});
   if(id!=='registered-only')put('refresh','private-token-'+id,{clientId:id,resource:'https://example.com/mailbridge/mcp'},id==='expired'?now()-1:now()+86400);
  }
  source.close();const checksum=()=>createHash('sha256').update(readFileSync(database)).digest('hex'),before=checksum();
  const owner=await store.createUser('owner','fixture-only-password',true),other=await store.createUser('other','fixture-only-password'),sources=[{service:'mailbridge',database,path:'/mailbridge/mcp'}];
  assert.throws(()=>recoverConnections({store,owner:other.id,sources}),/管理员/);
  assert.deepEqual(recoverConnections({store,owner:owner.id,sources}),['mailbridge']);
  assert.equal(checksum(),before);
  const records=store.snapshot(owner.id).bindings;assert.equal(records.length,1);const legacy=records[0];
  assert.equal(legacy.legacy,true);assert.equal(legacy.client,'ChatGPT');assert.equal(legacy.path,'/mailbridge/mcp');assert.equal(legacy.source_client,undefined);
  assert.deepEqual(store.snapshot(other.id).bindings,[]);assert(!JSON.stringify(store.snapshot(owner.id)).includes('private-'));
  let app;server=createServer((req,res)=>app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  app=createApp({store,pool:{},origin,secure:false,render:()=>{}});
  const cookie=id=>'mcp_center_session='+store.newSession(id);
  const update=(session,body)=>fetch(origin+'/center/api/legacy-bindings/'+legacy.id,{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session},body:JSON.stringify(body)});
  assert.equal((await update(cookie(other.id),{label:'Foreign edit'})).status,404);
  const edited=await update(cookie(owner.id),{label:'My existing mailbox',icon:null});assert.equal(edited.status,200);assert.equal((await edited.json()).path,'/mailbridge/mcp');
  assert.deepEqual(recoverConnections({store,owner:owner.id,sources}),[]);assert.equal(store.snapshot(owner.id).bindings[0].label,'My existing mailbox');assert.equal(checksum(),before);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM oauth').get().n,0);
 }finally{if(server)await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});
