import {randomUUID} from 'node:crypto';
import {constants, createWriteStream} from 'node:fs';
import {lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {join, posix} from 'node:path';
import {pipeline} from 'node:stream/promises';

function outputFormat(service, tool, extension) {
  if (service === 'mailbridge' && tool === 'mail_export' && ['csv', 'json'].includes(extension)) return extension;
  if (service === 'xuexitong' && tool === 'export_schedule_ics' && extension === 'ics') return extension;
  return null;
}

function outputRequest(binding, method, params) {
  if (method !== 'tools/call') return null;
  const args = params.arguments || {};
  const tool = params.name;
  const request = tool === 'mail_export' ? args.out_path : args.filename ?? '课表.ics';
  if (typeof request !== 'string') return null;
  const extension = tool === 'mail_export' ? (request.endsWith('.json') ? 'json' : 'csv') : 'ics';
  if (!outputFormat(binding.service, tool, extension)) return null;
  const name = posix.basename(request.replaceAll('\\', '/')).replace(/[\x00-\x1f]/g, '').slice(0, 160) || `result.${extension}`;
  return {tool, extension, name};
}

async function directory(path, optional = false) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (optional && error.code === 'ENOENT') return false; throw error; }
  if (!info.isDirectory() || await realpath(path) !== path) throw new Error('Invalid durable output directory');
  return true;
}

export async function openOutputFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || await realpath(process.platform === 'linux' ? `/proc/self/fd/${file.fd}` : path) !== path) {
      throw new Error('Invalid durable output file');
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function copyOutput(path, target) {
  const file = await openOutputFile(path);
  try {
    await pipeline(file.createReadStream({autoClose: false}), createWriteStream(target, {mode: 0o600, flags: 'wx'}));
  } finally { await file.close(); }
}

export async function preserveWorkerOutput(layout, binding, method, params, invoke) {
  const request = outputRequest(binding, method, params);
  if (!request) return invoke();
  const downloads = layout.downloads(binding);
  await mkdir(downloads, {recursive: true, mode: 0o700});
  await directory(downloads);
  const work = await mkdtemp(join(downloads, '.export-'));
  const filename = `result.${request.extension}`;
  const file = join(work, filename);
  let kept = false;
  try {
    const result = await invoke(file);
    if (result.isError || !await lstat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })) return result;
    const location = layout.outputDirectory(binding);
    await mkdir(location, {recursive: true, mode: 0o700});
    await directory(location);
    const stage = await mkdtemp(join(location, '.pending-'));
    try {
      const id = randomUUID();
      await copyOutput(file, join(stage, filename));
      const record = {version: 1, id, owner: binding.user_id, binding: binding.id, service: binding.service,
        tool: request.tool, name: request.name, filename, created: new Date().toISOString()};
      await writeFile(join(stage, 'record.json'), JSON.stringify(record) + '\n', {mode: 0o600, flag: 'wx'});
      await rename(stage, join(location, id));
      kept = true;
    } finally { await rm(stage, {recursive: true, force: true}); }
    return result;
  } finally {
    // An existing MCP client may use the returned workspace path for a follow-up attachment call.
    if (!kept) await rm(work, {recursive: true, force: true});
  }
}

export async function listOutputs(layout) {
  if (!await directory(layout.outputs, true)) return [];
  const records = [];
  for (const owner of (await readdir(layout.outputs)).sort()) {
    const ownerPath = join(layout.outputs, owner);
    await directory(ownerPath);
    for (const id of (await readdir(ownerPath)).sort()) {
      const location = layout.outputDirectory({user_id: owner, id});
      await directory(location);
      for (const artifact of (await readdir(location)).sort()) {
        if (artifact.startsWith('.pending-')) continue;
        if (!/^[a-f0-9-]{36}$/.test(artifact)) throw new Error('Invalid durable output identifier');
        const path = join(location, artifact);
        await directory(path);
        const entry = await openOutputFile(join(path, 'record.json'));
        let record;
        try { record = JSON.parse(await entry.readFile('utf8')); }
        catch { throw new Error('Unreadable durable output record'); }
        finally { await entry.close(); }
        const extension = /^result\.(csv|json|ics)$/.exec(record.filename)?.[1];
        if (record.version !== 1 || record.id !== artifact || record.owner !== owner || record.binding !== id
            || !outputFormat(record.service, record.tool, extension) || typeof record.name !== 'string'
            || !Number.isFinite(Date.parse(record.created))) throw new Error('Invalid durable output record');
        const names = await readdir(path);
        if (names.length !== 2 || !names.includes(record.filename)) throw new Error('Incomplete durable output');
        const file = await openOutputFile(join(path, record.filename));
        try { records.push({record, path, bytes: (await file.stat()).size}); }
        finally { await file.close(); }
      }
    }
  }
  return records;
}
