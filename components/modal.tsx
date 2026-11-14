"use client";
import {useEffect,useRef,useId,type ReactNode} from "react";
import {X} from "lucide-react";
import {Button} from "@/components/ui/button";
export function Modal({title,children,onClose,drawer=false}:{title:string;children:ReactNode;onClose:()=>void;drawer?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className={drawer?"modal drawer":"modal"} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close.current();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close.current();}}}>
    <header className="modal-header"><h2 id={titleId}>{title}</h2><Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X/></Button></header>{children}
  </dialog>;
}
