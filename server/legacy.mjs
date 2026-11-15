import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {catalog,check} from './catalog.mjs';
import {now} from './store.mjs';

// This administrator-only import reads source databases without copying tokens.
// Legacy requests continue to use their original gateway, accounts and OAuth store.
export function recoverConnections({store,owner,sources}){
 check(store.user(owner)?.admin,'仅管理员可恢复旧连接',403);
 check(Array.isArray(sources),'恢复配置无效');
 const recovered=[];
 for(const source of sources){
  check(catalog[source.service]&&typeof source.database==='string'&&/^\/[a-z0-9/-]+\/mcp$/.test(source.path),'旧连接来源配置无效');
  const db=new DatabaseSync(source.database,{readOnly:true});
  try{
   const rows=db.prepare('SELECT kind,key,value,expires FROM oauth').all();
   const granted=new Set(rows.filter(row=>['access','refresh'].includes(row.kind)&&(!row.expires||row.expires>now())).map(row=>JSON.parse(row.value).clientId));
   for(const row of rows){
    if(row.kind!=='client'||!granted.has(row.key))continue;
    const client=JSON.parse(row.value);
    const chatgpt=client.redirect_uris?.some(uri=>{try{const url=new URL(uri);return url.protocol==='https:'&&['chatgpt.com','chat.openai.com'].includes(url.hostname);}catch{return false;}});
    if(!chatgpt)continue;
    const inserted=store.db.prepare('INSERT INTO legacy_bindings(id,user_id,service,source_client,label,client,path,created) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,service,source_client) DO NOTHING').run(randomUUID(),owner,source.service,row.key,catalog[source.service].name,'ChatGPT',source.path,Number.isSafeInteger(client.client_id_issued_at)?client.client_id_issued_at:now());
    if(inserted.changes){recovered.push(source.service);store.event(owner,'找回旧连接',catalog[source.service].name);}
   }
  }finally{db.close();}
 }
 return recovered;
}
