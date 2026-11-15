// Only fixed categories and request metadata belong in operational logs.
// Never record request bodies, upstream messages, credentials or OAuth tokens.
export const diagnostic=record=>console.info(JSON.stringify(record));
const reasons=new Map([
 ['Invalid refresh token','invalid_refresh_token'],
 ['Invalid authorization code','invalid_authorization_code'],
 ['Unexpected resource','unexpected_resource'],
 ['Unexpected redirect','unexpected_redirect'],
 ['Scope escalation','scope_escalation'],
 ['Unexpected scope','unexpected_scope'],
 ['code_verifier does not match the challenge','pkce_mismatch'],
]);
const errors=new Set(['invalid_grant','invalid_request','invalid_client','invalid_scope','server_error','unsupported_grant_type']);
export function tokenDiagnostics(log=diagnostic){return(req,res,next)=>{
 const start=Date.now(),json=res.json;let error,reason;
 res.json=function(body){error=errors.has(body?.error)?body.error:undefined;reason=reasons.get(body?.error_description);return json.call(this,body);};
 res.on('finish',()=>log({event:'oauth_token',binding:req.provider.id,grant:['authorization_code','refresh_token'].includes(req.body?.grant_type)?req.body.grant_type:'other',status:res.statusCode,ms:Date.now()-start,...(error?{error}:{}),...(reason?{reason}:{})}));
 next();
};}
