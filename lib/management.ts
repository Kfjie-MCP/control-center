export type User={id:string;username:string;admin:boolean};
export type Account={id:string;service:string;label:string;identity:string;verified:number;created:number;settings?:{provider?:string;imap_host?:string;smtp_host?:string;smtp_port?:number}};
export type Binding={id:string;service:string;label:string;client:string;icon?:string|null;accounts:string[];revoked:number;created:number;last_used:number|null;legacy?:boolean;path?:string;auth?:'oauth'|'bearer'};
export type Event={id:string;action:string;target:string;result:string;created:number};
export type Snapshot={accounts:Account[];bindings:Binding[];events:Event[]};
export const emptySnapshot:Snapshot={accounts:[],bindings:[],events:[]};
export const platforms=['ChatGPT','Gemini','Claude','Gemini CLI','Claude Code','VS Code','通用客户端'];
export async function api(path:string,method='GET',body?:unknown){const response=await fetch('/center/api'+path,{method,credentials:'same-origin',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.endsWith('/verify')?130000:30000)});let data;try{data=await response.json();}catch{throw Error('服务暂时不可用，请稍后重试');}if(!response.ok)throw Error(data.error||'操作失败');return data;}
export const connectionUrl=(binding:Binding,origin:string)=>origin+(binding.legacy?binding.path:'/connect/'+binding.id+'/mcp');
export function configFor(binding:Binding,origin:string){const url=connectionUrl(binding,origin),id=binding.label.trim().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'')||binding.service;if(['ChatGPT','Gemini','Claude'].includes(binding.client))return url;if(binding.client==='Claude Code')return `claude mcp add --transport http ${id} ${url}`;if(binding.client==='VS Code')return JSON.stringify({servers:{[id]:{type:'http',url}}},null,2);return JSON.stringify({mcpServers:{[id]:binding.client==='Gemini CLI'?{httpUrl:url}:{url}}},null,2);}
