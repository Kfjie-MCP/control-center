import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema,ReadResourceResultSchema,ListToolsResultSchema,ListResourcesResultSchema,ListResourceTemplatesResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {HttpError,check} from './catalog.mjs';
const schemas={'tools/list':ListToolsResultSchema,'tools/call':CallToolResultSchema,'resources/read':ReadResourceResultSchema,'resources/list':ListResourcesResultSchema,'resources/templates/list':ListResourceTemplatesResultSchema};
export class WorkerPool{
 sandbox(home,paths,command,args){
  // No host home directories, credentials, sibling tenants, or Docker socket.
  const flags=['--die-with-parent','--new-session','--unshare-pid','--unshare-ipc','--unshare-uts'];
  for(const path of ['/usr','/lib','/lib64','/bin','/sbin'])if(existsSync(path))flags.push('--ro-bind',path,path);
  flags.push('--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc');
  for(const path of ['/etc/ssl','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf'])if(existsSync(path))flags.push('--ro-bind',path,path);
  for(const path of paths)flags.push('--ro-bind',path,path);
  flags.push('--bind',home,home,'--chdir',home,'--',command,...args);
  return {command:'/usr/bin/bwrap',args:flags};
 }
 constructor({store,stateDir,sourceRoot='/opt/mcp',videoRoot='/opt/mcp/control-center/vendor/transcriptor'}){this.store=store;this.stateDir=stateDir;this.sourceRoot=sourceRoot;this.videoRoot=videoRoot;this.workers=new Map();this.creating=new Map();this.timer=setInterval(()=>{for(const [id,w]of this.workers)if(!w.busy&&Date.now()-w.used>300000)this.stop(id);},60000);this.timer.unref();}
 stop(id){const w=this.workers.get(id);if(w){w.close();this.workers.delete(id);}this.creating.get(id)?.then(w=>{w.close();if(this.workers.get(id)===w)this.workers.delete(id);}).catch(()=>{});}
 discard(binding){this.stop(binding.id);const home=resolve(this.stateDir,'workspaces',binding.user_id,binding.id);check(home.startsWith(resolve(this.stateDir,'workspaces')+'/'),'Invalid workspace');const clean=()=>rmSync(home,{recursive:true,force:true});const pending=this.creating.get(binding.id);if(pending)pending.finally(clean).catch(()=>{});else clean();}
 stopForAccount(id){for(const [key,w]of this.workers)if(w.accountIds.includes(id))this.stop(key);}
 close(){clearInterval(this.timer);for(const id of this.workers.keys())this.stop(id);}
 async get(binding){const accounts=binding.accounts.map(id=>this.store.account(binding.user_id,id,true));check(accounts.length&&accounts.every(a=>a&&a.service===binding.service),'连接账号已失效',403);
  const signature=accounts.map(a=>a.id+':'+a.version).join('|');let worker=this.workers.get(binding.id);if(worker&&worker.signature!==signature){this.stop(binding.id);worker=null;}if(worker)return worker;
  if(this.creating.has(binding.id))return this.creating.get(binding.id);
  const pending=this.create(binding,accounts,signature).finally(()=>this.creating.delete(binding.id));this.creating.set(binding.id,pending);return pending;
 }
 async create(binding,accounts,signature){
  if(this.workers.size+this.creating.size>=16)throw new HttpError(503,'当前连接较多，请稍后重试');
  const home=join(this.stateDir,'workspaces',binding.user_id,binding.id);mkdirSync(home,{recursive:true,mode:0o700});
  const guards=fileURLToPath(new URL('../workers',import.meta.url));
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:guards,LANG:'C.UTF-8',NODE_ENV:'production',TMPDIR:home};
  let worker;
  if(binding.service==='momo'){
   const origin='http://127.0.0.1:8787/momo';
   // This upstream is stateless and identifies every request by the supplied user's token.
   worker={call:async(method,params)=>{const response=await fetch(origin,{method:'POST',headers:{Authorization:'Bearer '+accounts[0].credentials.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(90000)});if(!response.ok)throw new HttpError(502,'墨墨请求失败');const text=await response.text();const value=text.trim().startsWith('{')?JSON.parse(text):JSON.parse(text.split('\n').find(l=>l.startsWith('data:')).slice(5));if(value.error)throw new HttpError(502,'墨墨接口返回错误');return value.result;},close:()=>{}};
  }else if(binding.service==='transcriptor'){
   writeFileSync(join(home,'package.json'),readFileSync(join(this.videoRoot,'package.json')),{mode:0o600});
   const cookiePath=join(home,'cookies.txt');writeFileSync(cookiePath,accounts[0].credentials.cookies||'# Netscape HTTP Cookie File\n',{mode:0o600});
   const videoVenv=join(this.sourceRoot,'control-center','.video-venv');
   const sandbox=this.sandbox(home,[this.videoRoot,videoVenv,guards],process.execPath,[join(this.videoRoot,'dist/mcp.js')]);
   const transport=new StdioClientTransport({...sandbox,cwd:home,env:{...env,PATH:videoVenv+'/bin:'+env.PATH,COOKIES_FILE_PATH:cookiePath,CACHE_MODE:'off',CANARY_INTERVAL_MS:'0',LOG_LEVEL:'silent',YT_DLP_MAX_CONCURRENCY:'1',YT_DLP_TIMEOUT:'90000',WHISPER_MODE:'local',WHISPER_BASE_URL:process.env.WHISPER_BASE_URL||'',WHISPER_MAX_DURATION_SECONDS:'1800',NODE_OPTIONS:'--max-old-space-size=256'},stderr:'pipe'});
   transport.stderr?.on('data',()=>{});
   const client=new Client({name:'mcp-center',version:'1.0.0'});try{await client.connect(transport);}catch(error){await transport.close();throw error;}worker={call:(method,params)=>client.request({method,params},schemas[method],{timeout:120000}),close:()=>void client.close()};
  }else{
   const source=join(this.sourceRoot,binding.service==='xuexitong'?'xuexitong-cli':binding.service);
   const script=fileURLToPath(new URL('../workers/isolated.py',import.meta.url));
   const paths=[join(source,'.venv'),guards];
   if(binding.service==='mailbridge')paths.push(join(source,'upstream/server'));
   if(binding.service==='xuexitong')paths.push(join(source,'xuexitong_mcp'));
   if(binding.service==='agent-reach'){paths.push(join(source,'server.py'),join(source,'bin'),join(source,'uv-tools'));env.PATH=join(source,'bin')+':'+env.PATH;env.UV_CACHE_DIR=join(home,'.cache');}
   const sandbox=this.sandbox(home,paths,join(source,'.venv/bin/python'),[script]);
   const child=spawn(sandbox.command,sandbox.args,{cwd:home,env,stdio:['pipe','pipe','pipe'],windowsHide:true});child.stderr.on('data',()=>{});
   let serial=0;const pending=new Map();let bootResolve,bootReject;const boot=new Promise((res,rej)=>{bootResolve=res;bootReject=rej;});
   const fail=()=>{const error=new HttpError(502,'服务暂时不可用，请稍后重试');bootReject(error);for(const entry of pending.values())entry.reject(error);pending.clear();if(this.workers.get(binding.id)===worker)this.workers.delete(binding.id);};
   child.on('error',fail);child.on('exit',fail);
   createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line);if(message.ready)bootResolve();else if(message.error)bootReject(new HttpError(502,'服务启动失败'));else{const entry=pending.get(message.id);if(entry){pending.delete(message.id);entry.resolve(message.result);}}}catch{}});
   child.stdin.write(JSON.stringify({service:binding.service,source,accounts})+'\n');
   const timeout=setTimeout(()=>{child.kill();bootReject(new HttpError(504,'服务启动超时'));},20000);try{await boot;}finally{clearTimeout(timeout);}
   worker={call:(method,params)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');}),close:()=>child.kill()};
  }
  worker={...worker,accountIds:accounts.map(a=>a.id),signature,used:Date.now(),busy:0,queue:Promise.resolve()};this.workers.set(binding.id,worker);return worker;
 }
 async call(binding,method,params={}){
  if(binding.service==='transcriptor'&&method==='tools/call'){
   const domains=['youtube.com','youtu.be','bilibili.com','b23.tv','vimeo.com','reddit.com','redd.it','tiktok.com','twitch.tv','twitter.com','x.com','instagram.com','facebook.com','fb.watch','vk.com','vk.ru','vkvideo.ru','dailymotion.com','dai.ly'];
   for(const [key,value]of Object.entries(params.arguments||{}))if(/url/i.test(key)&&typeof value==='string'){
    let url;try{url=new URL(value);}catch{throw new HttpError(400,'请输入有效的视频链接');}
    check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&(!url.port||['80','443'].includes(url.port))&&domains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)),'此连接只接受受支持视频平台的公开链接');
   }
  }
  const w=await this.get(binding);check(w.busy<8,'请求排队中，请稍后重试',429);w.busy++;w.used=Date.now();
  const operation=w.queue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.stop(binding.id);reject(new HttpError(504,'操作超时，请重试'));},125000);Promise.resolve(w.call(method,params)).then(resolve,reject).finally(()=>clearTimeout(timeout));}));w.queue=operation;
  try{return await operation;}finally{w.busy--;w.used=Date.now();}
 }
}
