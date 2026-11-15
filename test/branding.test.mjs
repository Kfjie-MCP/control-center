import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,hash,now} from '../server/store.mjs';

test('branding migration preserves existing connections, credentials and authorizations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mcp-branding-')),file=join(dir,'state.sqlite'),key=randomBytes(32);let store;
 try{
  store=new Store(file,key);const owner=await store.createUser('fixture','test-only-long-password'),a=store.createAccount(owner.id,'mailbridge','Mailbox','fixture@example.com',{password:'fixture-secret'}),id=randomUUID();
  store.db.prepare('INSERT INTO bindings(id,user_id,service,label,client,accounts,password,created) VALUES (?,?,?,?,?,?,?,?)').run(id,owner.id,'mailbridge','Gemini · MailBridge','Gemini',JSON.stringify([a.id]),'saved-hash',now());
  store.oauthPut(id,'access',hash('fixture-access'),{binding:id,clientId:'fixture-client'},now()+3600);
  const legacyId=randomUUID();store.db.prepare('INSERT INTO legacy_bindings(id,user_id,service,source_client,label,client,path,created) VALUES (?,?,?,?,?,?,?,?)').run(legacyId,owner.id,'mailbridge','fixture-client','Existing mailbox','ChatGPT','/mailbridge/mcp',now());
  store.db.exec('ALTER TABLE bindings DROP COLUMN icon; ALTER TABLE legacy_bindings DROP COLUMN auth');store.close();
  store=new Store(file,key);const binding=store.binding(id);
  assert.equal(binding.icon,null);assert.equal(binding.password,'saved-hash');assert.equal(store.publicBinding(binding).label,'MailBridge');assert.equal(binding.label,'Gemini · MailBridge');assert.equal(store.account(owner.id,a.id,true).credentials.password,'fixture-secret');assert.equal(store.oauthGet(id,'access',hash('fixture-access')).clientId,'fixture-client');
  assert.equal(store.legacyBinding(legacyId,owner.id).auth,'oauth');assert.equal(store.legacyBinding(legacyId,owner.id).label,'Existing mailbox');
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
