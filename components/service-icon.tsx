import {BookOpen,Globe2,Layers3,Mail,Video} from 'lucide-react';
import type {Service} from '@/lib/services';
const icons={mail:Mail,reach:Globe2,video:Video,study:BookOpen,memo:Layers3};
export function ServiceIcon({service,small=false,src}:{service:Service;small?:boolean;src?:string|null}){
 const Icon=icons[service.kind];
 return <span className={`service-icon ${service.kind} ${small?'small':''} ${src?'custom-icon':''}`}>
  {src?<img src={src} alt=""/>:<Icon strokeWidth={1.7}/>}
 </span>;
}
