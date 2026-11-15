import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Store,hash,now} from '../server/store.mjs';
import {BindingProvider} from '../server/provider.mjs';
import {createApp} from '../server/app.mjs';

test('expired bearer signals refresh and a confidential client automatically retries',async()=>{
 const store=new Store(':memory:',randomBytes(32)),logs=[];let app,client;
 const server=createServer((req,res)=>app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const owner=await store.createUser('owner','test-only-owner-password');
  const account=store.createAccount(owner.id,'mailbridge','Fixture','fixture@example.com',{email:'fixture@example.com',password:'private-fixture'});
  const id=randomUUID(),path='/connect/'+id;
  store.db.prepare('INSERT INTO bindings(id,user_id,service,label,client,accounts,password,created) VALUES (?,?,?,?,?,?,?,?)').run(id,owner.id,'mailbridge','Fixture','Google',JSON.stringify([account.id]),'unused',now());
  app=createApp({store,pool:{call:async()=>({tools:[]})},origin,secure:false,render:()=>{},log:r=>logs.push(r)});
  const missing=await fetch(origin+path+'/mcp');assert.equal(missing.status,401);assert(!missing.headers.get('www-authenticate').includes('error='));await missing.body.cancel();
  const metadata={client_name:'Confidential fixture',redirect_uris:['https://example.com/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'client_secret_post'};
  const registration=await fetch(origin+path+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)});assert.equal(registration.status,201);
  const information=await registration.json(),provider=new BindingProvider({store,id,origin});
  let tokens={...provider.issue({clientId:information.client_id,scopes:['mail:full']}),issuer:origin+path};const old=tokens.access_token,oldRefresh=tokens.refresh_token;
  store.db.prepare("UPDATE oauth SET expires=? WHERE binding=? AND kind='access' AND key=?").run(now()-1,id,hash(old));
  const expired=await fetch(origin+path+'/mcp',{headers:{Authorization:'Bearer '+old}});
  assert.equal(expired.status,401);assert.equal(expired.headers.get('cache-control'),'no-store');
  const challenge=expired.headers.get('www-authenticate');assert.match(challenge,/error="invalid_token"/);assert.match(challenge,/scope="mail:full"/);assert(challenge.includes('resource_metadata="'+origin+'/.well-known/oauth-protected-resource'+path+'/mcp"'));await expired.body.cancel();
  const auth={redirectUrl:metadata.redirect_uris[0],clientMetadata:metadata,clientInformation:()=>information,saveClientInformation:()=>{},tokens:()=>tokens,saveTokens:value=>{tokens=value;},redirectToAuthorization:()=>{throw Error('A refresh must not require interactive authorization');},saveCodeVerifier:()=>{},codeVerifier:()=>''};
  client=new Client({name:'refresh-regression',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+path+'/mcp'),{authProvider:auth}));
  assert.deepEqual((await client.listTools()).tools,[]);assert.notEqual(tokens.access_token,old);assert.notEqual(tokens.refresh_token,oldRefresh);
  assert(logs.some(r=>r.event==='oauth_token'&&r.grant==='refresh_token'&&r.status===200));
  assert(logs.some(r=>r.event==='mcp_auth_denied'&&r.reason==='invalid_or_expired_token'));
  for(const secret of [old,oldRefresh,tokens.access_token,tokens.refresh_token,information.client_secret,'private-fixture'])assert(!JSON.stringify(logs).includes(secret));
 }finally{await client?.close();await new Promise(r=>server.close(r));store.close();}
});
