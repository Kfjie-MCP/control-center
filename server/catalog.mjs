export const catalog={
 mailbridge:{name:'MailBridge',scope:'mail:full'},
 'agent-reach':{name:'Agent Reach',scope:'reach:read'},
 transcriptor:{name:'Transcriptor',scope:'videos:read'},
 xuexitong:{name:'学习通',scope:'xuexitong:read'},
 momo:{name:'墨墨',scope:'momo:full'},
};
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export const check=(ok,message='请求参数无效',status=400)=>{if(!ok)throw new HttpError(status,message);};
export function cleanText(value,min=1,max=80){check(typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max&&!/[\x00-\x1f]/.test(value));return value.trim();}
export function credentialsFor(service,input){check(input&&typeof input==='object'&&!Array.isArray(input));
 if(service==='mailbridge'){
  const email=cleanText(input.email,3,254);check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'邮箱地址无效');
  const provider=cleanText(input.provider);check(['qq','163','126','gmail','icloud','yahoo','fastmail','generic'].includes(provider),'邮箱服务商无效');
  const data={email,provider,password:cleanText(input.password,1,512),kind:'imap'};
  if(provider==='generic'){for(const key of ['imap_host','smtp_host']){const host=cleanText(input[key],3,253);check(/^[a-z0-9.-]+$/i.test(host)&&host.includes('.')&&!host.endsWith('.local')&&!host.endsWith('.internal'),'请输入公网邮件服务器域名');data[key]=host;}data.imap_port=993;data.smtp_port=Number(input.smtp_port||465);check([465,587].includes(data.smtp_port),'SMTP 端口须为 465 或 587');data.smtp_mode=data.smtp_port===465?'ssl':'starttls';}
  return {identity:email,credentials:data};
 }
 if(service==='xuexitong'){const phone=cleanText(input.phone,5,40);check(/^[+0-9@._a-z-]+$/i.test(phone),'账号格式无效');return {identity:phone,credentials:{phone,password:cleanText(input.password,1,512)}};}
 if(service==='momo')return {identity:'墨墨 API Token',credentials:{token:cleanText(input.token,16,2048)}};
 if(service==='agent-reach')return {identity:'独立公开内容配置',credentials:{}};
 if(service==='transcriptor'){const cookies=input.cookies||'';check(typeof cookies==='string'&&Buffer.byteLength(cookies)<=256*1024,'Cookie 文件不能超过 256 KB');if(cookies.trim())check(cookies.startsWith('# Netscape HTTP Cookie File')||cookies.startsWith('# HTTP Cookie File'),'请提供 Netscape 格式的 Cookie 文件');return {identity:cookies.trim()?'个人 Cookie':'不使用登录 Cookie',credentials:{cookies}};}
 throw new HttpError(400,'未知服务');
}
