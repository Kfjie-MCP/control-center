import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

function segment(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value)) throw new Error('Invalid state directory identifier');
  return value;
}

export function stateLayout(env = process.env) {
  const root = resolve(env.STATE_DIRECTORY?.split(':')[0] || '/var/lib/mcp-center');
  const workspaces = join(root, 'workspaces');
  const outputs = join(root, 'outputs');
  const connectionPath = (base, binding) => join(base, segment(binding.user_id), segment(binding.id));
  return {
    root,
    database: join(root, 'center.sqlite'),
    keyFile: resolve(env.ENCRYPTION_KEY_FILE || join(root, 'encryption-key')),
    workspaces,
    outputs,
    attachmentLinks: join(root, 'attachment-links'),
    workspace: binding => connectionPath(workspaces, binding),
    downloads: binding => join(connectionPath(workspaces, binding), 'downloads'),
    outputDirectory: binding => connectionPath(outputs, binding),
  };
}

export function decodeStateKey(contents) {
  const hex = contents.toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('A 32-byte hexadecimal encryption key is required');
  return Buffer.from(hex, 'hex');
}

export function readStateKey(layout) {
  return decodeStateKey(readFileSync(layout.keyFile));
}
