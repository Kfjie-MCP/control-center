import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Store, hash, now} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
import {createAttachmentDelivery} from '../server/attachments.mjs';

const modulePath = process.env.MAILBRIDGE_DOWNLOAD_MODULE || resolve('../mailbridge/gateway/src/downloads.mjs');
test('MCP attachment delivery: tenant boundaries, password reset, account update and revocation', {skip: !existsSync(modulePath) && 'MailBridge source required (MAILBRIDGE_DOWNLOAD_MODULE)'}, async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'center-download-')), store = new Store(':memory:', randomBytes(32));
  let app, unsafe = false;
  const server = createServer((req, res) => app(req, res)); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const attachments = await createAttachmentDelivery({store, stateDir, origin, modulePath});
  const pool = {async call(binding, method) {
    if (method === 'tools/list') return {tools: [{name: 'mail_download_attachment', inputSchema: {type: 'object'}}]};
    const root = join(stateDir, 'workspaces', binding.user_id, binding.id, 'downloads'); await mkdir(root, {recursive: true});
    const file = join(unsafe ? stateDir : root, 'paper.pdf'); await writeFile(file, '%PDF-' + binding.user_id);
    return {content: [{type: 'text', text: JSON.stringify({saved_to: file, filename: 'paper.pdf', bytes: 1})}], isError: false};
  }};
  app = createApp({store, pool, origin, attachments, secure: false, render: () => {}, log: () => {}});
  async function tenant(username) {
    const user = await store.createUser(username, 'example-long-password');
    const account = store.createAccount(user.id, 'mailbridge', username, username + '@example.com', {provider: 'qq'});
    const id = randomUUID();
    store.db.prepare('INSERT INTO bindings(id,user_id,service,label,client,accounts,password,created) VALUES (?,?,?,?,?,?,?,?)').run(id, user.id, 'mailbridge', username, 'test', JSON.stringify([account.id]), 'example-password-hash', now());
    const token = randomBytes(32).toString('hex');
    store.oauthPut(id, 'access', hash(token), {owner: user.id, binding: id, clientId: 'personal', resource: origin + '/connect/' + id + '/mcp', scopes: ['mail:full'], expiresAt: now() + 3600}, now() + 3600);
    return {user, account, id, token};
  }
  const rpc = async (tenant, method = 'tools/call') => {
    const response = await fetch(origin + '/connect/' + tenant.id + '/mcp', {method: 'POST', headers: {Authorization: 'Bearer ' + tenant.token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params: {name: 'mail_download_attachment', arguments: {message_id: 'INBOX|1', attachment: '0'}}})});
    assert.equal(response.status, 200); const value = await response.json(); assert.ok(!value.error, JSON.stringify(value)); return value.result;
  };
  try {
    const alice = await tenant('alice'), bob = await tenant('bob');
    assert.match((await rpc(alice, 'tools/list')).tools[0].description, /download_url/);
    const a = await rpc(alice), b = await rpc(bob);
    assert.equal(a.isError, false); assert.equal(a.content[1].type, 'resource_link');
    const url = a.structuredContent.download_url;
    assert.equal(await (await fetch(url)).text(), '%PDF-' + alice.user.id);
    assert.equal(await (await fetch(b.structuredContent.download_url)).text(), '%PDF-' + bob.user.id);
    assert.equal((await fetch(url.replace(alice.id, bob.id))).status, 404);
    store.db.prepare('UPDATE bindings SET password=? WHERE id=?').run('changed-password-hash', alice.id);
    assert.equal((await fetch(url)).status, 404);
    const fresh = await rpc(alice);
    store.db.prepare('UPDATE accounts SET version=version+1 WHERE id=?').run(alice.account.id);
    assert.equal((await fetch(fresh.structuredContent.download_url)).status, 404);
    const updated = await rpc(alice);
    store.db.prepare('UPDATE bindings SET revoked=1 WHERE id=?').run(alice.id);
    assert.equal((await fetch(updated.structuredContent.download_url)).status, 404);
    assert.equal((await fetch(b.structuredContent.download_url)).status, 200);
    unsafe = true; assert.equal((await rpc(bob)).isError, true);
    store.db.prepare('DELETE FROM accounts WHERE id=?').run(bob.account.id);
    assert.equal((await fetch(b.structuredContent.download_url)).status, 404);
  } finally { attachments.close(); await new Promise(r => server.close(r)); store.close(); await rm(stateDir, {recursive: true, force: true}); }
});
