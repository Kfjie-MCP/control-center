import {randomBytes} from 'node:crypto';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeJson=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

// Complete the form navigation before entering the OAuth client's redirect chain.
// Otherwise Chromium applies the consent page's form-action to subsequent hops.
export function sendAuthorizationRedirect(req,res,target){
 const url=new URL(target);
 if(!['https:','http:'].includes(url.protocol))throw new Error('Invalid callback protocol');
 res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 if(!req.get('accept')?.includes('text/html'))return res.redirect(302,target);
 const nonce=randomBytes(24).toString('base64'),href=escapeHtml(url.href);
 res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
 return res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>返回客户端</title><noscript><meta http-equiv="refresh" content="0;url=${href}"></noscript><style>html{color-scheme:light dark}body{margin:0;min-height:100svh;display:grid;place-items:center;font:16px/1.7 system-ui;background:light-dark(#f7f8fa,#13161b);color:light-dark(#242930,#edf0f5)}main{margin:24px;padding:32px;max-width:360px;border:1px solid light-dark(#e5e9ef,#303742);border-radius:20px;background:light-dark(white,#1b1f26);box-shadow:0 12px 40px #0001}h1{font-size:23px;margin:0 0 10px}p{margin:0 0 24px}a{display:block;padding:10px 20px;border-radius:10px;background:light-dark(#272d35,#e9edf4);color:light-dark(white,#20252d);text-align:center;text-decoration:none}</style></head><body><main><h1>授权已通过</h1><p>正在返回客户端。若未自动跳转，可点击下方按钮。</p><a href="${href}" rel="noreferrer">继续返回客户端</a></main><script nonce="${nonce}">window.location.replace(${safeJson(url.href)});</script></body></html>`);
}
