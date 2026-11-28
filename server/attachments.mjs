import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stateLayout} from './state.mjs';

export async function createAttachmentDelivery({store, stateDir, layout = stateLayout({STATE_DIRECTORY: stateDir}), origin, sourceRoot = '/opt/mcp', modulePath = join(sourceRoot, 'mailbridge/gateway/src/downloads.mjs'), ttlMs}) {
  // Shared implementation with the legacy MailBridge gateway.
  const {AttachmentDownloads, describeDownloads} = await import(pathToFileURL(modulePath).href);
  function signature(binding) {
    if (!binding || binding.revoked || binding.service !== 'mailbridge') return null;
    const accounts = binding.accounts.map(id => store.account(binding.user_id, id));
    if (!accounts.length || accounts.some(account => !account || account.service !== 'mailbridge')) return null;
    return createHash('sha256').update(JSON.stringify([binding.user_id, binding.password, accounts.map(account => [account.id, account.version])])).digest('hex');
  }
  const downloads = new AttachmentDownloads({directory: layout.attachmentLinks, ttlMs, validateScope: scope => {
    const current = store.binding(scope.namespace);
    return Boolean(current && current.user_id === scope.owner && signature(current) === scope.signature);
  }});
  return {
    close: () => downloads.close(),
    serve: (req, res) => downloads.serve(req, res, req.params.id),
    async transform(binding, method, params, result) {
      if (binding.service !== 'mailbridge') return result;
      if (method === 'tools/list') describeDownloads(result.tools);
      if (method === 'tools/call' && params?.name === 'mail_download_attachment' && !result.isError) {
        try {
          return await downloads.publish(result, {root: layout.downloads(binding), urlPrefix: `${origin}/connect/${binding.id}/downloads`, scope: {namespace: binding.id, owner: binding.user_id, signature: signature(binding)}});
        } catch {
          return {isError: true, content: [{type: 'text', text: '附件下载链接生成失败，请重试。'}]};
        }
      }
      return result;
    },
  };
}
