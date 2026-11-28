import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {chmod, lstat, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {backup, DatabaseSync} from 'node:sqlite';
import {pipeline} from 'node:stream/promises';
import {parseEnv} from 'node:util';
import {listOutputs, openOutputFile} from './outputs.mjs';
import {decodeStateKey, stateLayout} from './state.mjs';
import {openAccountSecret, passwordMatches} from './store.mjs';

const format = 'mcp-center-recovery';
const version = 1;
const dbMember = 'data/center.sqlite';
const keyMember = 'config/encryption-key';
const envMember = 'config/runtime.env';
const receiptMember = 'config/owner-bootstrap.json';
const unitMember = 'deploy/mcp-center.service';
const manifestName = 'manifest.json';

async function readOriginal(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFile(path);
}

export async function recoverySources(options) {
  const environment = options.env ? await readOriginal(resolve(options.env)) : null;
  const env = environment ? parseEnv(environment.toString('utf8')) : {...process.env};
  if (options.stateDirectory) env.STATE_DIRECTORY = resolve(options.stateDirectory);
  return {layout: stateLayout(env), environment};
}

function readOnly(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
    return db;
  } catch (error) { db.close(); throw error; }
}

async function databaseInventory(path, key, receipt) {
  const db = readOnly(path);
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('MCP Center database failed integrity checks');
    }
    const counts = {};
    for (const table of ['users', 'accounts', 'bindings', 'legacy_bindings', 'sessions', 'events']) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }
    const oauth = db.prepare('SELECT kind, COUNT(*) AS n FROM oauth GROUP BY kind ORDER BY kind').all();
    for (const row of db.prepare('SELECT id, user_id, secret FROM accounts').iterate()) {
      try { openAccountSecret(key, row.secret, row.user_id, row.id); }
      catch { throw new Error('Encryption key cannot open a saved account'); }
    }
    let ownerReceiptValid = false;
    if (receipt) {
      let saved;
      try { saved = JSON.parse(receipt.toString('utf8')); }
      catch { throw new Error('Malformed owner bootstrap receipt'); }
      const owner = typeof saved?.username === 'string' && typeof saved?.password === 'string'
        ? db.prepare('SELECT password FROM users WHERE username=? AND admin=1').get(saved.username) : null;
      ownerReceiptValid = Boolean(owner && await passwordMatches(saved.password, owner.password));
    }
    const users = new Set(db.prepare('SELECT id FROM users').all().map(row => row.id));
    return {counts, oauth, ownerReceiptValid, users};
  } finally { db.close(); }
}

async function receiptContents(path) {
  if (!path) return null;
  const info = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.mode & 0o077) throw new Error('Owner bootstrap receipt must be a private regular file');
  return readFile(path);
}

function outputInventory(outputs, users) {
  if (outputs.some(item => !users.has(item.record.owner))) throw new Error('Durable output owner is missing from the database');
  return {count: outputs.length, bytes: outputs.reduce((total, item) => total + item.bytes, 0)};
}

export async function describeRecovery(options, check = false) {
  const {layout, environment} = await recoverySources(options);
  const outputs = await listOutputs(layout);
  const description = {format, version, paths: {database: layout.database, key: layout.keyFile, outputs: layout.outputs,
    environment: environment ? resolve(options.env) : null, unit: options.unit ?? null}, outputs: outputs.length};
  if (!check) return description;
  const key = decodeStateKey(await readOriginal(layout.keyFile));
  const state = await databaseInventory(layout.database, key, await receiptContents(options.ownerReceipt));
  return {...description, counts: state.counts, oauth: state.oauth, owner_receipt: state.ownerReceiptValid,
    outputs: outputInventory(outputs, state.users)};
}

async function digest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return {sha256: hash.digest('hex'), bytes};
}

async function snapshotSqlite(source, target) {
  await writeFile(target, '', {flag: 'wx', mode: 0o600});
  const live = readOnly(source);
  try { await backup(live, target); }
  finally { live.close(); }
  const snapshot = new DatabaseSync(target);
  try { snapshot.exec('PRAGMA journal_mode=DELETE;'); }
  finally { snapshot.close(); }
  await chmod(target, 0o600);
}

async function copyPublished(path, target) {
  const file = await openOutputFile(path);
  try {
    await pipeline(file.createReadStream({autoClose: false}), createWriteStream(target, {mode: 0o600, flags: 'wx'}));
  } finally { await file.close(); }
}

function outputMembers(root, outputs) {
  return outputs.flatMap(({path, record}) => ['record.json', record.filename].map(name => relative(root, join(path, name)).split(sep).join('/')));
}

export async function exportRecovery(directory, options) {
  const {layout, environment} = await recoverySources(options);
  if (!environment) throw new Error('Export requires --env with the effective runtime environment file');
  const target = resolve(directory);
  const key = await readOriginal(layout.keyFile);
  const receipt = await receiptContents(options.ownerReceipt);
  const unit = options.unit ? await readOriginal(resolve(options.unit)) : null;
  await mkdir(target, {mode: 0o700});
  try {
    const outputs = await listOutputs(layout);
    const save = async (member, contents) => {
      const path = join(target, member);
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      await writeFile(path, contents, {mode: 0o600, flag: 'wx'});
    };
    await mkdir(dirname(join(target, dbMember)), {mode: 0o700});
    await snapshotSqlite(layout.database, join(target, dbMember));
    const state = await databaseInventory(join(target, dbMember), decodeStateKey(key), receipt);
    const statistics = {counts: state.counts, oauth: state.oauth, owner_receipt: state.ownerReceiptValid,
      outputs: outputInventory(outputs, state.users)};
    const members = [dbMember, keyMember, envMember];
    await save(keyMember, key);
    await save(envMember, environment);
    if (unit) { await save(unitMember, unit); members.push(unitMember); }
    if (statistics.owner_receipt) { await save(receiptMember, receipt); members.push(receiptMember); }
    for (const member of outputMembers(layout.root, outputs)) {
      const path = join(target, member);
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      await copyPublished(join(layout.root, member), path);
      members.push(member);
    }
    const files = {};
    for (const member of members.sort()) files[member] = await digest(join(target, member));
    const manifest = {format, version, statistics, files};
    await save(manifestName, JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } catch (error) {
    await rm(target, {force: true, recursive: true});
    throw error;
  }
}

async function bundleFiles(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), {withFileTypes: true})) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await bundleFiles(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error('Unexpected recovery bundle entry');
  }
  return result;
}

export async function verifyRecovery(directory) {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory()) throw new Error('Expected a recovery directory');
  const present = new Set(await bundleFiles(root));
  let manifest;
  try { manifest = JSON.parse(await readOriginal(join(root, manifestName))); }
  catch { throw new Error('Unreadable MCP Center recovery manifest'); }
  if (manifest?.format !== format || manifest.version !== version || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Unsupported MCP Center recovery manifest');
  }
  const outputs = await listOutputs(stateLayout({STATE_DIRECTORY: root}));
  const members = [dbMember, keyMember, envMember, ...outputMembers(root, outputs)];
  if (present.has(unitMember)) members.push(unitMember);
  if (present.has(receiptMember)) members.push(receiptMember);
  if (present.size !== members.length + 1 || Object.keys(manifest.files).length !== members.length
      || !members.every(name => present.has(name) && Object.hasOwn(manifest.files, name))) {
    throw new Error('Recovery file list does not match the manifest');
  }
  for (const member of members) {
    const info = await digest(join(root, member));
    const recorded = manifest.files[member];
    if (info.bytes !== recorded?.bytes || info.sha256 !== recorded?.sha256) throw new Error(`Recovery checksum mismatch: ${member}`);
  }
  const key = decodeStateKey(await readOriginal(join(root, keyMember)));
  const state = await databaseInventory(join(root, dbMember), key, present.has(receiptMember) ? await readOriginal(join(root, receiptMember)) : null);
  const statistics = {counts: state.counts, oauth: state.oauth, owner_receipt: state.ownerReceiptValid,
    outputs: outputInventory(outputs, state.users)};
  if ((present.has(receiptMember) && !state.ownerReceiptValid) || JSON.stringify(statistics) !== JSON.stringify(manifest.statistics)) {
    throw new Error('Recovered state differs from the manifest');
  }
  return {verified: true, format, version, statistics, files: members.length};
}
