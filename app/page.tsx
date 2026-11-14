"use client";

import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,BookOpen,Check,ChevronDown,ChevronRight,Copy,History,KeyRound,Mail,Moon,Network,Search,ShieldCheck,Star,Sun,Trash2,Video,X,Globe2,Layers3} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Modal} from "@/components/modal";
import {services,type Service,type RecordItem} from "@/lib/services";

const STORAGE="mcp-center-v1";
const icons={mail:Mail,reach:Globe2,video:Video,study:BookOpen,memo:Layers3};
const time=(stamp:number)=>new Date(stamp).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
function ServiceIcon({service,small=false}:{service:Service;small?:boolean}){const Icon=icons[service.kind];return <span className={`service-icon ${service.kind} ${small?"small":""}`}><Icon strokeWidth={1.7}/></span>;}

export default function Center(){
 const [view,setView]=useState<"services"|"history">("services");
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("全部");
 const [favorites,setFavorites]=useState<string[]>([]);
 const [records,setRecords]=useState<RecordItem[]>([]);
 const [ready,setReady]=useState(false);
 const [dark,setDark]=useState(false);
 const [origin,setOrigin]=useState("https://mcp.example.com");
 const [selected,setSelected]=useState<Service|null>(null);
 const [client,setClient]=useState("通用");
 const [clearDialog,setClearDialog]=useState(false);
 const [toast,setToast]=useState("");
 const searchRef=useRef<HTMLInputElement>(null);
 const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=(text:string)=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(text);toastTimer.current=setTimeout(()=>setToast(""),2800);};
 useEffect(()=>{
  setDark(document.documentElement.dataset.theme==="dark");
  const configured=process.env.NEXT_PUBLIC_MCP_ORIGIN;
  if(configured){try{const url=new URL(configured);if(url.protocol==="https:")setOrigin(url.origin);}catch{}}
  else if(location.protocol==="https:"&&!['localhost','127.0.0.1'].includes(location.hostname))setOrigin(location.origin);
  try{const value=JSON.parse(localStorage.getItem(STORAGE)||"null");if(value){if(Array.isArray(value.favorites))setFavorites(value.favorites.filter((id:unknown)=>typeof id==="string"&&services.some(s=>s.id===id)));if(Array.isArray(value.records))setRecords(value.records.filter((r:RecordItem)=>services.some(s=>s.id===r.serviceId)&&["复制地址","复制配置"].includes(r.action)&&Number.isFinite(r.at)).slice(0,50));}}catch{}
  setReady(true);
  const key=(event:KeyboardEvent)=>{if(event.key==="/"&&!document.querySelector("dialog[open]")&&!['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();setView("services");setTimeout(()=>searchRef.current?.focus(),0);}};
  window.addEventListener("keydown",key);return()=>{window.removeEventListener("keydown",key);if(toastTimer.current)clearTimeout(toastTimer.current);};
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(STORAGE,JSON.stringify({favorites,records}));}catch{}},[favorites,records,ready]);
 const switchTheme=()=>{const next=!dark;setDark(next);document.documentElement.dataset.theme=next?"dark":"light";try{localStorage.setItem("mcp-manager-theme",next?"dark":"light");}catch{}};
 const toggleFavorite=(id:string)=>setFavorites(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const copy=async(text:string,service:Service,action:RecordItem["action"])=>{try{await navigator.clipboard.writeText(text);setRecords(v=>[{id:crypto.randomUUID(),serviceId:service.id,action,at:Date.now()},...v].slice(0,50));notify(action==="复制地址"?"MCP 地址已复制":"配置已复制");}catch{notify("复制失败，请选中地址手动复制");}};
 const openConnect=(service:Service)=>{setClient("通用");setSelected(service);};
 const filtered=services.filter(s=>(category==="全部"||category===s.category||(category==="收藏"&&favorites.includes(s.id)))&&`${s.name} ${s.purpose} ${s.category}`.toLowerCase().includes(query.trim().toLowerCase()));
 const getConfig=(service:Service)=>JSON.stringify({mcpServers:{[service.id]:{...(client==="Gemini CLI"?{httpUrl:origin+service.path}:{url:origin+service.path}),...(service.auth==="Token"?{headers:{Authorization:"Bearer <MAIMEMO_TOKEN>"}}:{})}}},null,2);

 return <div className="app-shell">
  <header className="topbar"><div className="topbar-inner">
   <a className="brand" href="#services" onClick={e=>{e.preventDefault();setView("services");}} aria-label="kfjie MCP 服务"><span className="brand-mark"><Network size={20} strokeWidth={1.7}/></span><strong>kfjie</strong><span className="brand-separator">/</span><span>MCP</span></a>
   <nav className="topnav" aria-label="主导航"><button className={view==="services"?"active":""} onClick={()=>setView("services")}><Network size={16}/>服务</button><button className={view==="history"?"active":""} onClick={()=>setView("history")}><History size={16}/>记录</button></nav>
   <div className="topbar-actions"><span className="preview-tag">预览</span><Button variant="ghost" size="icon" aria-label={dark?"切换浅色模式":"切换深色模式"} title={dark?"切换浅色模式":"切换深色模式"} onClick={switchTheme}>{dark?<Sun/>:<Moon/>}</Button></div>
  </div></header>
  <main className="workspace">
   {view==="services"?<>
    <div className="page-heading"><div className="heading-title"><h1>服务</h1><span className="count">{services.length}</span></div><div className="searchbox"><Search size={17}/><Input ref={searchRef} placeholder="搜索服务" aria-label="搜索服务" value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button className="clear-search" onClick={()=>{setQuery("");searchRef.current?.focus();}} aria-label="清空搜索"><X size={15}/></button>:<kbd>/</kbd>}</div></div>
    <div className="filterbar" aria-label="筛选服务"><div className="categories">{["全部","通信","内容","学习"].map(item=><button key={item} aria-pressed={category===item} className={category===item?"selected":""} onClick={()=>setCategory(item)}>{item}</button>)}</div><button className={`favorite-filter ${category==="收藏"?"selected":""}`} aria-pressed={category==="收藏"} onClick={()=>setCategory(category==="收藏"?"全部":"收藏")}><Star size={15}/>收藏{favorites.length>0&&<span>{favorites.length}</span>}</button></div>
    <section className="service-region" aria-label="可连接的服务">
     {filtered.length?<div className="service-grid">{filtered.map(service=><article key={service.id} className="service-card">
      <div className="card-top"><ServiceIcon service={service}/><button className={`favorite-button ${favorites.includes(service.id)?"is-favorite":""}`} onClick={()=>toggleFavorite(service.id)} aria-pressed={favorites.includes(service.id)} aria-label={`${favorites.includes(service.id)?"取消收藏":"收藏"}${service.name}`} title={favorites.includes(service.id)?"取消收藏":"收藏"}><Star size={17}/></button></div>
      <button className="service-title" onClick={()=>openConnect(service)}><h2>{service.name}</h2><ChevronRight size={17}/></button>
      <p className="service-purpose">{service.purpose}</p>
      <div className="service-meta"><span>{service.category}</span><i/><span>{service.auth==="OAuth"?<ShieldCheck size={14}/>:<KeyRound size={14}/>} {service.auth}</span></div>
      <div className="card-actions"><Button variant="ghost" className="copy-action" onClick={()=>copy(origin+service.path,service,"复制地址")}><Copy size={15}/>复制地址</Button><Button className="connect-action" onClick={()=>openConnect(service)}>连接<ArrowRight size={15}/></Button></div>
     </article>)}</div>:<div className="empty-state">{category==="收藏"?<Star size={28}/>:<Search size={28}/>}<h2>{query?"没有匹配的服务":category==="收藏"?"还没有收藏的服务":"暂无服务"}</h2><Button variant="outline" onClick={()=>{setQuery("");setCategory("全部");}}>查看全部服务</Button></div>}
    </section>
    {origin==="https://mcp.example.com"&&<footer className="workspace-footer">当前使用示例地址</footer>}
   </>:<>
    <div className="page-heading history-heading"><div><h1>操作记录</h1><p className="local-note">仅保存在此浏览器</p></div><Button variant="outline" disabled={!records.length} onClick={()=>setClearDialog(true)}><Trash2 size={15}/>清空</Button></div>
    <section className="history-region" aria-label="本机操作记录">{records.length?<div className="history-table"><div className="history-labels"><span>服务</span><span>操作</span><span>时间</span></div>{records.map(record=>{const service=services.find(s=>s.id===record.serviceId)!;return <div key={record.id} className="history-row"><button onClick={()=>openConnect(service)}><ServiceIcon service={service} small/><strong>{service.name}</strong></button><span className="record-action"><Check size={14}/>{record.action}</span><time dateTime={new Date(record.at).toISOString()}>{time(record.at)}</time></div>;})}</div>:<div className="empty-state"><History size={30}/><h2>还没有操作记录</h2><Button variant="outline" onClick={()=>setView("services")}><ArrowLeft size={15}/>浏览服务</Button></div>}</section>
   </>}
  </main>
  {selected&&<Modal title={`连接 ${selected.name}`} onClose={()=>setSelected(null)}>
   <div className="modal-body">
    <label className="field-label" htmlFor="endpoint">MCP 地址</label><div className="endpoint-field"><Input id="endpoint" readOnly value={origin+selected.path} onFocus={e=>e.target.select()}/><Button variant="ghost" size="icon" aria-label="复制 MCP 地址" title="复制地址" onClick={()=>copy(origin+selected.path,selected,"复制地址")}><Copy/></Button></div>
    {origin==="https://mcp.example.com"&&<p className="field-note">示例地址，尚未指向真实服务。</p>}
    <dl className="connection-facts"><div><dt>身份验证</dt><dd>{selected.auth==="OAuth"?"OAuth · 自动发现":"墨墨官方 Token"}</dd></div><div><dt>传输方式</dt><dd>Streamable HTTP</dd></div>{selected.scope&&<div><dt>授权范围</dt><dd><code>{selected.scope}</code></dd></div>}</dl>
    <details className="disclosure"><summary>如何连接<ChevronDown size={16}/></summary><ol className="connection-steps"><li>在客户端添加自定义 MCP 服务，粘贴上面的地址。</li><li>{selected.auth==="OAuth"?"选择 OAuth，在授权页面输入此服务的连接密码。":"选择 Bearer Token，填入墨墨提供的 API Token。"}</li></ol></details>
    <details className="disclosure"><summary>客户端配置<ChevronDown size={16}/></summary><div className="config-controls"><label htmlFor="config-client">格式</label><select id="config-client" value={client} onChange={e=>setClient(e.target.value)}><option>通用</option><option>Gemini CLI</option></select><Button variant="ghost" size="sm" onClick={()=>copy(getConfig(selected),selected,"复制配置")}><Copy size={14}/>复制</Button></div><pre tabIndex={0} aria-label="MCP 客户端配置">{getConfig(selected)}</pre>{selected.auth==="Token"&&<p className="field-note">将 &lt;MAIMEMO_TOKEN&gt; 替换为你的 Token。</p>}</details>
    <details className="disclosure"><summary>可用功能<span className="summary-end">{selected.tools} 个工具<ChevronDown size={16}/></span></summary><ul className="capability-list">{selected.capabilities.map(item=><li key={item}><Check size={15}/>{item}</li>)}</ul></details>
   </div>
   <footer className="modal-footer"><Button variant="outline" onClick={()=>setSelected(null)}>关闭</Button><Button onClick={()=>copy(origin+selected.path,selected,"复制地址")}><Copy size={15}/>复制 MCP 地址</Button></footer>
   {toast&&<div className="modal-feedback" role="status">{toast}</div>}
  </Modal>}
  {clearDialog&&<Modal title="清空操作记录？" onClose={()=>setClearDialog(false)}><div className="modal-body"><p className="confirm-copy">将删除此浏览器中的 {records.length} 条记录，已建立的服务连接不受影响。</p></div><footer className="modal-footer"><Button variant="outline" onClick={()=>setClearDialog(false)}>取消</Button><Button variant="destructive" onClick={()=>{setRecords([]);setClearDialog(false);notify("操作记录已清空");}}>清空记录</Button></footer></Modal>}
  <div className={`toast ${toast?"visible":""}`} role="status" aria-live="polite">{toast&&<><span className="toast-icon"><Check size={16}/></span>{toast}</>}</div>
 </div>;
}
