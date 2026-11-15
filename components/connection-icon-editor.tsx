"use client";
import {useRef,useState} from 'react';
import {Upload,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ServiceIcon} from '@/components/service-icon';
import type {Service} from '@/lib/services';

export function ConnectionIconEditor({service,value,onChange,onBusyChange,disabled=false}:{service:Service;value:string|null;onChange:(value:string|null)=>void;onBusyChange:(value:boolean)=>void;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null),[reading,setReading]=useState(false),[error,setError]=useState('');
 const select=async(file?:File)=>{
  if(!file)return;
  setError('');setReading(true);onBusyChange(true);
  try{
   if(file.type!=='image/png')throw Error('请选择 PNG 图片');
   if(file.size>10240)throw Error('图标不能超过 10 KB');
   const src=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('图片读取失败，请重试'));r.readAsDataURL(file);});
   const image=new Image();image.src=src;await image.decode();
   if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>1024||image.naturalHeight>1024)throw Error('图标尺寸不能超过 1024 × 1024');
   onChange(src);
  }catch(e){setError((e as Error).message||'图片无法读取');}
  finally{setReading(false);onBusyChange(false);if(input.current)input.current.value='';}
 };
 return <div className="icon-editor"><input className="icon-file-input" tabIndex={-1} type="file" ref={input} accept="image/png" aria-label="上传连接图标" disabled={disabled||reading} onChange={e=>void select(e.target.files?.[0])}/>
  <button className="icon-preview" type="button" aria-label="更换连接图标" disabled={disabled||reading} onClick={()=>input.current?.click()}><ServiceIcon service={service} src={value}/><span className="icon-upload-mark">{reading?<Loader2 size={14} className="spinner"/>:<Upload size={14}/>}</span></button>
  <div className="icon-editor-controls"><div><Button type="button" variant="outline" size="sm" disabled={disabled||reading} onClick={()=>input.current?.click()}>更换图标</Button>{value&&<Button type="button" variant="ghost" size="sm" disabled={disabled||reading} onClick={()=>{onChange(null);setError('');}}>恢复默认</Button>}</div><span>PNG，10 KB 内</span></div>
  {error&&<p className="form-error icon-error" role="alert">{error}</p>}
 </div>;
}
