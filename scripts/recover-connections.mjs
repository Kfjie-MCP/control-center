// Run on the server as root with a private JSON source manifest.
import {readFileSync} from 'node:fs';
import {Store} from '../server/store.mjs';
import {recoverConnections} from '../server/legacy.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/recover-connections.mjs /private/sources.json');
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const state=process.env.STATE_DIRECTORY||'/var/lib/mcp-center';
const store=new Store(state+'/center.sqlite',Buffer.from(readFileSync(state+'/encryption-key','utf8').trim(),'hex'));
try{
 const owner=store.db.prepare('SELECT id FROM users WHERE username=? AND admin=1').get(config.owner);
 if(!owner)throw Error('Administrator not found');
 const recovered=recoverConnections({store,owner:owner.id,sources:config.sources});
 console.log(JSON.stringify({recovered:recovered.length,services:recovered}));
}finally{store.close();}
