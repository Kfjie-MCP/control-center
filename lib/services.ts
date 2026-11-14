export type Service = {
  id: string; name: string; kind: "mail" | "reach" | "video" | "study" | "memo";
  category: "通信" | "内容" | "学习"; purpose: string; path: string;
  auth: "OAuth" | "Token"; tools: number; scope?: string; capabilities: string[];
};
export const services: Service[] = [
  {id:"mailbridge",name:"MailBridge",kind:"mail",category:"通信",purpose:"收发邮件，处理附件与文件夹。",path:"/mailbridge/mcp",auth:"OAuth",tools:14,scope:"mail:full",capabilities:["搜索、读取与整理邮件","发送、回复与转发邮件","下载附件，管理文件夹"]},
  {id:"agent-reach",name:"Agent Reach",kind:"reach",category:"内容",purpose:"搜索多平台公开内容，读取链接。",path:"/agent-reach/mcp",auth:"OAuth",tools:5,scope:"reach:read",capabilities:["跨平台搜索帖子和文章","读取公开网页和链接内容","汇总、比较检索结果"]},
  {id:"transcriptor",name:"Transcriptor",kind:"video",category:"内容",purpose:"读取视频字幕，转录音频与视频。",path:"/transcriptor/mcp",auth:"OAuth",tools:9,scope:"videos:read",capabilities:["获取视频信息与字幕","转录音频并生成时间轴","提取指定时间的视频画面"]},
  {id:"xuexitong",name:"学习通",kind:"study",category:"学习",purpose:"查看课程与作业，获取课件和课表。",path:"/xuexitong/mcp",auth:"OAuth",tools:18,scope:"xuexitong:read",capabilities:["读取课程、章节与作业信息","获取课程资料与课件","导出课表"]},
  {id:"momo",name:"墨墨",kind:"memo",category:"学习",purpose:"查询单词与学习进度，整理复习。",path:"/momo",auth:"Token",tools:47,capabilities:["查询单词、释义与助记","查看学习进度、管理云词本","记录复习反馈与易错词"]},
];
export type RecordItem={id:string;serviceId:string;action:"复制地址"|"复制配置";at:number};
