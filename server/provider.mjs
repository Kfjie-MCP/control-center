import {InvalidGrantError,InvalidRequestError,InvalidScopeError,InvalidTokenError} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {now,random,hash,passwordMatches} from './store.mjs';
import {catalog} from './catalog.mjs';
import {connectionName} from './branding.mjs';
export class BindingProvider{
 constructor({store,id,origin,render}){this.store=store;this.id=id;this.origin=origin;this.resource=origin+'/connect/'+id+'/mcp';this.issuer=origin+'/connect/'+id;this.render=render;this.clientsStore={getClient:async key=>this.get('client',key),registerClient:async client=>{if(this.store.db.prepare("SELECT COUNT(*) AS n FROM oauth WHERE binding=? AND kind='client'").get(id).n>=100)throw new InvalidRequestError('Client limit reached');this.put('client',client.client_id,client);return client;}};}
 binding(){const b=this.store.binding(this.id);if(!b||b.revoked)throw new InvalidTokenError('Connection revoked');return b;}
 get(kind,key){return this.store.oauthGet(this.id,kind,key);}
 put(kind,key,value,expires){this.store.oauthPut(this.id,kind,key,value,expires);}
 remove(kind,key){this.store.oauthRemove(this.id,kind,key);}
 resourceCheck(value){if(value&&String(value)!==this.resource)throw new InvalidRequestError('Unexpected resource');}
 scopesCheck(scopes){const expected=catalog[this.binding().service].scope;if(scopes?.some(s=>s!==expected))throw new InvalidScopeError('Unexpected scope');return scopes?.length?scopes:[expected];}
 async authorize(client,params,res){this.resourceCheck(params.resource);const b=this.binding(),request=random(),expiresAt=now()+600;this.put('request',request,{...params,resource:this.resource,scopes:this.scopesCheck(params.scopes),clientId:client.client_id,clientName:client.client_name||b.client,expiresAt},expiresAt);return this.renderPage(request,res);}
 renderPage(request,res,error=null){const grant=this.get('request',request),b=this.binding();const labels=b.accounts.map(id=>this.store.account(b.user_id,id)?.label).filter(Boolean).join('、');return this.render(res,{service:b.service,connectionName:connectionName(b),connectionIcon:b.icon||undefined,platformName:b.client,accountLabel:labels,request:grant?request:'',clientName:grant?.clientName||b.client,redirectUri:grant?.redirectUri,expiresAt:grant?.expiresAt||0,error:grant?error:'request_expired',action:'/connect/'+this.id+'/oauth/approve'});}
 async approve(request,password){const b=this.binding(),grant=this.get('request',request);if(!grant)return {error:'request_expired'};if(!await passwordMatches(password,b.password))return {error:'password_incorrect'};
  if(grant.redirect&&this.get('code',hash(new URL(grant.redirect).searchParams.get('code'))))return {redirect:grant.redirect};
  const code=random();this.put('code',hash(code),{...grant,request},now()+300);const uri=new URL(grant.redirectUri);uri.searchParams.set('code',code);if(grant.state!==undefined)uri.searchParams.set('state',grant.state);uri.searchParams.set('iss',this.issuer);this.put('request',request,{...grant,redirect:uri.href},grant.expiresAt);return {redirect:uri.href};
 }
 codeGrant(client,code){this.binding();const grant=this.get('code',hash(code));if(!grant||grant.clientId!==client.client_id)throw new InvalidGrantError('Invalid authorization code');return grant;}
 async challengeForAuthorizationCode(client,code){return this.codeGrant(client,code).codeChallenge;}
 async exchangeAuthorizationCode(client,code,_verifier,redirectUri,resource){const grant=this.codeGrant(client,code);this.resourceCheck(resource);if(redirectUri!==grant.redirectUri)throw new InvalidGrantError('Unexpected redirect');this.remove('code',hash(code));this.remove('request',grant.request);const b=this.binding();this.store.event(b.user_id,'授权连接',b.label);return this.issue(grant);}
 issue(grant){const b=this.binding(),access=random(),refresh=random();const info={clientId:grant.clientId,scopes:grant.scopes,resource:this.resource,owner:b.user_id,binding:this.id};this.put('access',hash(access),{...info,expiresAt:now()+3600},now()+3600);this.put('refresh',hash(refresh),info,now()+30*86400);return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:info.scopes.join(' ')};}
 async exchangeRefreshToken(client,token,scopes,resource){this.binding();this.resourceCheck(resource);const grant=this.get('refresh',hash(token));if(!grant||grant.clientId!==client.client_id)throw new InvalidGrantError('Invalid refresh token');if(scopes?.some(s=>!grant.scopes.includes(s)))throw new InvalidScopeError('Scope escalation');this.remove('refresh',hash(token));return this.issue({...grant,scopes:scopes??grant.scopes});}
 async verifyAccessToken(token){const b=this.binding(),info=this.get('access',hash(token));if(!info||info.owner!==b.user_id||info.binding!==b.id||info.resource!==this.resource)throw new InvalidTokenError('Invalid access token');return {...info,token};}
 async revokeToken(client,{token}){for(const kind of ['access','refresh'])if(this.get(kind,hash(token))?.clientId===client.client_id)this.remove(kind,hash(token));}
}
