import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
const derive=promisify(scrypt);
export const now=()=>Math.floor(Date.now()/1000);
export const random=()=>randomBytes(32).toString('base64url');
export const hash=value=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(value){const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(value,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex');}
export async function passwordMatches(value,stored){try{const [salt,key]=stored.split(':');const actual=await derive(value,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
export class Store{
 constructor(path,key){if(key.length!==32)throw Error('A 32-byte encryption key is required');this.key=key;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),service TEXT NOT NULL,label TEXT NOT NULL,identity TEXT NOT NULL,secret TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,verified INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS accounts_owner ON accounts(user_id);
 CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),service TEXT NOT NULL,label TEXT NOT NULL,client TEXT NOT NULL,accounts TEXT NOT NULL,password TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,last_used INTEGER);
 CREATE INDEX IF NOT EXISTS bindings_owner ON bindings(user_id);
 CREATE TABLE IF NOT EXISTS oauth(binding TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(binding,kind,key));
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,target TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS events_owner ON events(user_id,created);
 `);}
 seal(value,owner,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(owner+':'+id));const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
 unseal(value,owner,id){const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));cipher.setAAD(Buffer.from(owner+':'+id));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString());}
 async createUser(username,password,admin=false){const id=randomUUID();const digest=await passwordHash(password);this.db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id,username,digest,admin?1:0,now());return {id,username,admin};}
 user(id){const row=this.db.prepare('SELECT id,username,admin FROM users WHERE id=?').get(id);return row?{...row,admin:!!row.admin}:null;}
 newSession(userId){const token=random();this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),userId,now()+7*86400);return token;}
 session(token){if(!token)return null;const row=this.db.prepare('SELECT user_id FROM sessions WHERE key=? AND expires>?').get(hash(token),now());return row?this.user(row.user_id):null;}
 event(owner,action,target,result='success'){this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').run(randomUUID(),owner,action,target,result,now());this.db.prepare('DELETE FROM events WHERE user_id=? AND id NOT IN (SELECT id FROM events WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 300)').run(owner,owner);}
 account(owner,id,secret=false){const row=this.db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(id,owner);if(!row)return null;const result={...row};delete result.secret;const credentials=this.unseal(row.secret,owner,id);if(secret)result.credentials=credentials;else result.settings=Object.fromEntries(['provider','imap_host','smtp_host','smtp_port'].filter(key=>credentials[key]!==undefined).map(key=>[key,credentials[key]]));return result;}
 createAccount(owner,service,label,identity,credentials){const id=randomUUID();this.db.prepare('INSERT INTO accounts(id,user_id,service,label,identity,secret,created) VALUES (?,?,?,?,?,?,?)').run(id,owner,service,label,identity,this.seal(credentials,owner,id),now());this.event(owner,'添加账号',label);return this.account(owner,id);}
 binding(id,owner){const row=owner?this.db.prepare('SELECT * FROM bindings WHERE id=? AND user_id=?').get(id,owner):this.db.prepare('SELECT * FROM bindings WHERE id=?').get(id);return row?{...row,accounts:JSON.parse(row.accounts)}:null;}
 publicBinding(row){const value={...row};delete value.password;delete value.user_id;return value;}
 snapshot(owner){return {accounts:this.db.prepare('SELECT id FROM accounts WHERE user_id=? ORDER BY created,id').all(owner).map(r=>{const a=this.account(owner,r.id);delete a.user_id;return a;}),bindings:this.db.prepare('SELECT id FROM bindings WHERE user_id=? ORDER BY created DESC,rowid DESC').all(owner).map(r=>this.publicBinding(this.binding(r.id,owner))),events:this.db.prepare('SELECT id,action,target,result,created FROM events WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 100').all(owner)};}
 oauthGet(binding,kind,key){const row=this.db.prepare('SELECT value FROM oauth WHERE binding=? AND kind=? AND key=? AND (expires=0 OR expires>?)').get(binding,kind,key,now());return row?JSON.parse(row.value):undefined;}
 oauthPut(binding,kind,key,value,expires=0){this.db.prepare('DELETE FROM oauth WHERE expires>0 AND expires<=?').run(now());this.db.prepare('INSERT OR REPLACE INTO oauth VALUES (?,?,?,?,?)').run(binding,kind,key,JSON.stringify(value),expires);}
 oauthRemove(binding,kind,key){this.db.prepare('DELETE FROM oauth WHERE binding=? AND kind=? AND key=?').run(binding,kind,key);}
 close(){this.db.close();}
}
