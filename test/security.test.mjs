import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {Store,hash,now} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';

test('tenant isolation, OAuth PKCE, CSRF, token audience and immediate revocation',async()=>{
 const store=new Store(':memory:',randomBytes(32));let app;
 const server=createServer((req,res)=>app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const pool={stop:()=>{},stopForAccount:()=>{},call:async(binding,method)=>method==='tools/list'?{tools:[{name:'private_accounts',description:'Test',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:JSON.stringify(binding.accounts)}]}};
 app=createApp({store,pool,origin,secure:false,registrationEnabled:true,render:(res,context)=>res.json(context)});
 const req=async(path,{method='GET',body,cookie,token,form,badOrigin,approvalJson=false,accept='application/json, text/event-stream'}={})=>{const response=await fetch(origin+path,{method,redirect:'manual',headers:{Origin:badOrigin||origin,...(approvalJson?{'X-MCP-Approval':'json'}:{}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),Accept:accept},body:body?(form?new URLSearchParams(body):JSON.stringify(body)):undefined});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,headers:response.headers};};
 try{
  const signup=async username=>{const r=await req('/center/api/register',{method:'POST',body:{username,password:'test-only-long-password-42'}});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie').split(';')[0],user:r.data.user};};
  const a=await signup('alice'),b=await signup('bob');assert.equal(a.user.admin,false);
  assert.equal((await req('/center/api/data')).status,401);
  assert.equal((await req('/center/api/accounts',{method:'POST',cookie:a.cookie,badOrigin:'https://other.example',body:{}})).status,403);
  const account=async(owner,label)=>{const r=await req('/center/api/accounts',{method:'POST',cookie:owner.cookie,body:{service:'mailbridge',label,credentials:{email:label+'@example.com',provider:'qq',password:'upstream-private-example'}}});assert.equal(r.status,201);assert.equal(r.data.credentials,undefined);return r.data;};
  const aa=await account(a,'account-a'),bb=await account(b,'account-b');
  const snapshot=await req('/center/api/data',{cookie:b.cookie});assert.deepEqual(snapshot.data.accounts.map(v=>v.id),[bb.id]);assert.ok(!JSON.stringify(snapshot.data).includes('upstream-private-example'));
  const sealed=store.db.prepare('SELECT secret FROM accounts WHERE id=?').get(aa.id).secret;assert.ok(!sealed.includes('upstream-private-example'));assert.throws(()=>store.unseal(sealed,b.user.id,aa.id));
  assert.equal((await req('/center/api/accounts/'+aa.id,{method:'DELETE',cookie:b.cookie,body:{}})).status,404);
  assert.equal((await req('/center/api/bindings',{method:'POST',cookie:b.cookie,body:{service:'mailbridge',client:'Gemini',label:'Foreign account',accounts:[aa.id]}})).status,403);
  const createBinding=async(owner,acc)=>{const r=await req('/center/api/bindings',{method:'POST',cookie:owner.cookie,body:{service:'mailbridge',client:'Gemini',label:'Private mail',accounts:[acc.id]}});assert.equal(r.status,201);return r.data;};
  const ba=await createBinding(a,aa),ba2=await createBinding(a,aa),bbind=await createBinding(b,bb),path='/connect/'+ba.binding.id;
  assert.equal((await req('/center/api/bindings/'+ba.binding.id+'/token',{method:'POST',cookie:b.cookie,body:{}})).status,404);
  const register=await req(path+'/oauth/register',{method:'POST',body:{client_name:'Gemini test',redirect_uris:['http://127.0.0.1:19999/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}});assert.equal(register.status,201);
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),resource=origin+path+'/mcp';
  const query=new URLSearchParams({response_type:'code',client_id:register.data.client_id,redirect_uri:'http://127.0.0.1:19999/callback',scope:'mail:full',resource,code_challenge:challenge,code_challenge_method:'S256',state:'test-state'});
  const authorize=await req(path+'/oauth/authorize?'+query);assert.equal(authorize.status,200);assert.equal(authorize.data.accountLabel,'account-a');assert.equal(authorize.data.action,path+'/oauth/approve');
  assert.equal((await req(path+'/oauth/approve',{method:'POST',form:true,body:{request:authorize.data.request,password:'wrong'}})).status,401);
  const browserApproval=await req(path+'/oauth/approve',{method:'POST',form:true,accept:'text/html',body:{request:authorize.data.request,password:ba.password}});assert.equal(browserApproval.status,200);assert.match(browserApproval.headers.get('content-security-policy'),/form-action 'none'/);assert.equal(browserApproval.headers.get('cache-control'),'no-store');assert.match(browserApproval.data,/window\.location\.replace/);assert.ok(!browserApproval.data.includes(ba.password));
  const jsonDenied=await req(path+'/oauth/approve',{method:'POST',form:true,approvalJson:true,body:{request:authorize.data.request,password:'wrong'}});assert.equal(jsonDenied.status,401);assert.equal(jsonDenied.data.error,'password_incorrect');
  const jsonApproved=await req(path+'/oauth/approve',{method:'POST',form:true,approvalJson:true,body:{request:authorize.data.request,password:ba.password}});assert.equal(jsonApproved.status,200);assert.equal(new URL(jsonApproved.data.redirect).searchParams.get('state'),'test-state');assert.equal(jsonApproved.headers.get('cache-control'),'no-store');
  const approval=await req(path+'/oauth/approve',{method:'POST',form:true,body:{request:authorize.data.request,password:ba.password}});assert.equal(approval.status,302);const redirect=new URL(approval.headers.get('location'));assert.equal(redirect.searchParams.get('state'),'test-state');
  const exchange={grant_type:'authorization_code',client_id:register.data.client_id,redirect_uri:'http://127.0.0.1:19999/callback',code:redirect.searchParams.get('code'),code_verifier:verifier,resource};
  assert.equal((await req(path+'/oauth/token',{method:'POST',form:true,body:{...exchange,code_verifier:'wrong-verifier'}})).status,400);
  const tokens=await req(path+'/oauth/token',{method:'POST',form:true,body:exchange});assert.equal(tokens.status,200);
  assert.equal((await req(path+'/oauth/token',{method:'POST',form:true,body:exchange})).status,400);
  const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'private_accounts',arguments:{}}};
  const result=await req(path+'/mcp',{method:'POST',body:rpc,token:tokens.data.access_token});assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.data.result.content[0].text),[aa.id]);
  assert.equal((await req('/connect/'+bbind.binding.id+'/mcp',{method:'POST',body:rpc,token:tokens.data.access_token})).status,401);
  assert.equal((await req('/connect/'+ba2.binding.id+'/mcp',{method:'POST',body:rpc,token:tokens.data.access_token})).status,401);
  const pat=await req('/center/api/bindings/'+ba.binding.id+'/token',{method:'POST',cookie:a.cookie,body:{}});assert.equal(pat.status,200);
  assert.equal((await req(path+'/mcp',{method:'POST',body:rpc,token:pat.data.token})).status,200);
  await req('/center/api/bindings/'+ba.binding.id+'/password',{method:'POST',cookie:a.cookie,body:{}});
  assert.equal((await req(path+'/mcp',{method:'POST',body:rpc,token:pat.data.token})).status,401);
  assert.equal((await req(path+'/mcp',{method:'POST',body:rpc,token:tokens.data.access_token})).status,401);
  await req('/center/api/accounts/'+aa.id,{method:'DELETE',cookie:a.cookie,body:{}});
  assert.equal(store.binding(ba2.binding.id).revoked,1);assert.equal(store.binding(bbind.binding.id).revoked,0);
  await req('/center/api/logout',{method:'POST',cookie:b.cookie,body:{}});assert.equal((await req('/center/api/data',{cookie:b.cookie})).status,401);
 }finally{await new Promise(r=>server.close(r));store.close();}
});

test('registration is closed by default while existing users can sign in',async()=>{
 const store=new Store(':memory:',randomBytes(32));let app;
 const server=createServer((req,res)=>app(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 app=createApp({store,pool:{},origin,secure:false,render:()=>{}});
 try{
  await store.createUser('existing','test-only-existing-password');
  const session=await (await fetch(origin+'/center/api/session')).json();assert.equal(session.registrationEnabled,false);
  const post=(path,body)=>fetch(origin+'/center/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const denied=await post('register',{username:'newuser',password:'test-only-new-password'});assert.equal(denied.status,403);assert.equal((await denied.json()).error,'注册已关闭');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  const login=await post('login',{username:'existing',password:'test-only-existing-password'});assert.equal(login.status,200);assert.equal((await login.json()).user.username,'existing');assert.ok(login.headers.get('set-cookie'));
 }finally{await new Promise(r=>server.close(r));store.close();}
});