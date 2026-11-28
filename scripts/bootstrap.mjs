// Run locally on the server as root; no credentials are printed.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {Store,random} from '../server/store.mjs';
import {readStateKey,stateLayout} from '../server/state.mjs';
const layout=stateLayout();
const store=new Store(layout.database,readStateKey(layout));
if(store.db.prepare('SELECT id FROM users WHERE username=?').get('kfjie'))throw Error('Owner already initialized');
const password=random(),owner=await store.createUser('kfjie',password,true);
const mail='/var/lib/mailbridge/.mailbridge/accounts.json';
if(existsSync(mail))for(const account of JSON.parse(readFileSync(mail,'utf8')).accounts||[]){if(account.kind==='imap')store.createAccount(owner.id,'mailbridge',account.name,account.email,account);}
const study='/opt/mcp/xuexitong-cli/config.json';
if(existsSync(study)){const config=JSON.parse(readFileSync(study,'utf8'));const phone=config.phone||config.chaoxing_phone,password=config.password||config.chaoxing_password;if(phone&&password)store.createAccount(owner.id,'xuexitong','学习通',String(phone),{phone:String(phone),password});}
store.createAccount(owner.id,'agent-reach','公开内容','独立公开内容配置',{});
const cookies='/opt/mcp/transcriptor/secrets/cookies/combined.txt';
store.createAccount(owner.id,'transcriptor','视频服务',existsSync(cookies)?'个人 Cookie':'不使用登录 Cookie',{cookies:existsSync(cookies)?readFileSync(cookies,'utf8'):''});
writeFileSync('/var/backups/mcp-center-owner-login.json',JSON.stringify({username:'kfjie',password})+'\n',{mode:0o600});
store.close();console.log('Owner initialized; credentials written to private root-only receipt.');
