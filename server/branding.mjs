import {check,catalog} from './catalog.mjs';

export function connectionName(binding){
 const service=catalog[binding.service]?.name;
 return binding.label===`${binding.client} · ${service}`?service:binding.label;
}

export function connectionIcon(value){
 if(value===undefined||value===null||value==='')return null;
 check(typeof value==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value),'请上传 PNG 图标');
 const encoded=value.slice(22),data=Buffer.from(encoded,'base64');
 check(data.length<=10240,'图标不能超过 10 KB');
 check(data.length>=33&&data.toString('base64')===encoded&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR','PNG 图标无效');
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 check(width>0&&height>0&&width<=1024&&height<=1024,'图标尺寸不能超过 1024 × 1024');
 return value;
}
