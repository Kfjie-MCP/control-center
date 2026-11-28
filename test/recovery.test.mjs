import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {access, appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {listOutputs} from '../server/outputs.mjs';
import {exportRecovery, verifyRecovery} from '../server/recovery.mjs';
import {stateLayout} from '../server/state.mjs';
import {Store, hash, now, passwordMatches} from '../server/store.mjs';
import {WorkerPool} from '../server/workers.mjs';

test('retains completed exports across worker cleanup and restores accounts, grants and output files', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'center-recovery-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const layout = stateLayout({STATE_DIRECTORY: root, ENCRYPTION_KEY_FILE: join(root, 'effective-key')});
  const key = randomBytes(32);
  const environment = join(root, 'runtime.env');
  const receipt = join(root, 'owner.json');
  const password = 'fixture-recovery-owner-password';
  await writeFile(layout.keyFile, `${key.toString('hex')}\n`, {mode: 0o600});
  await writeFile(environment, `PUBLIC_URL=https://example.invalid\nSTATE_DIRECTORY=${root}\nENCRYPTION_KEY_FILE=${layout.keyFile}\n`);
  await writeFile(receipt, JSON.stringify({username: 'owner', password}), {mode: 0o600});
  const store = new Store(layout.database, key);
  const pool = new WorkerPool({store, layout, log: () => {}});
  let writes = 0;
  pool.get = async () => ({busy: 0, queue: Promise.resolve(), call: async (_method, {name}, output) => {
    if (name === 'mail_download_attachment') {
      assert.equal(output, undefined);
      return {content: [{type: 'text', text: 'independent mail attachment'}]};
    }
    if (++writes === 3) return {content: [{type: 'text', text: 'no calendar file was written'}]};
    await writeFile(output, name === 'mail_export' ? '[{"result":42}]' : 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
    return {content: [{type: 'text', text: output}]};
  }});
  try {
    const owner = await store.createUser('owner', password, true);
    const account = store.createAccount(owner.id, 'mailbridge', 'mail', 'fixture@example.invalid', {password: 'fixture-upstream-pass'});
    const mail = {user_id: owner.id, id: randomUUID(), service: 'mailbridge'};
    const study = {user_id: owner.id, id: randomUUID(), service: 'xuexitong'};
    store.oauthPut(mail.id, 'refresh', hash('fixture-grant'), {owner: owner.id}, now() + 3600);
    const session = store.newSession(owner.id);
    const result = await pool.call(mail, 'tools/call', {name: 'mail_export', arguments: {out_path: 'report.json'}});
    assert.equal(await readFile(result.content[0].text, 'utf8'), '[{"result":42}]');
    await pool.call(mail, 'tools/call', {name: 'mail_download_attachment'});
    await pool.call(study, 'tools/call', {name: 'export_schedule_ics', arguments: {filename: '课表.ics'}});
    await pool.call(study, 'tools/call', {name: 'export_schedule_ics'});
    pool.discard(mail);
    pool.discard(study);
    await assert.rejects(access(result.content[0].text), {code: 'ENOENT'});
    const outputs = await listOutputs(layout);
    assert.deepEqual(outputs.map(entry => entry.record.name).sort(), ['report.json', '课表.ics']);
    await mkdir(layout.attachmentLinks);
    await writeFile(join(layout.attachmentLinks, 'expiring.bin'), 'temporary copy');
    const bundle = join(root, 'bundle');
    const manifest = await exportRecovery(bundle, {env: environment, ownerReceipt: receipt});
    assert.equal(manifest.statistics.outputs.count, 2);
    assert.equal(manifest.statistics.owner_receipt, true);
    assert.equal(Object.keys(manifest.files).length, 8);
    assert.ok(!Object.keys(manifest.files).some(path => /attachment-links|workspaces/.test(path)));
    assert.equal(JSON.stringify(manifest).includes(password), false);
    assert.equal((await verifyRecovery(bundle)).verified, true);
    const restoredPath = join(root, 'restored.sqlite');
    await copyFile(join(bundle, 'data/center.sqlite'), restoredPath);
    const restored = new Store(restoredPath, key);
    try {
      assert.equal(restored.account(owner.id, account.id, true).credentials.password, 'fixture-upstream-pass');
      assert.equal(restored.session(session).id, owner.id);
      assert.equal(restored.oauthGet(mail.id, 'refresh', hash('fixture-grant')).owner, owner.id);
      const row = restored.db.prepare('SELECT password FROM users WHERE id=?').get(owner.id);
      assert.ok(await passwordMatches(password, row.password));
    } finally { restored.close(); }

    const exported = Object.keys(manifest.files).find(path => path.endsWith('result.ics'));
    await appendFile(join(bundle, exported), 'altered data');
    await assert.rejects(verifyRecovery(bundle), /checksum mismatch/);
    await writeFile(layout.keyFile, randomBytes(32).toString('hex'));
    const failed = join(root, 'wrong-key');
    await assert.rejects(exportRecovery(failed, {env: environment}), /Encryption key cannot open/);
    await assert.rejects(access(failed), {code: 'ENOENT'});
  } finally { pool.close(); store.close(); }
});
