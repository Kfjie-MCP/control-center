import {parseArgs} from 'node:util';
import {listOutputs} from '../server/outputs.mjs';
import {describeRecovery, exportRecovery, recoverySources, verifyRecovery} from '../server/recovery.mjs';

const usage = 'Usage: data:recovery describe|check|outputs [--env FILE] [--state-directory DIR]\n'
  + '       data:recovery export NEW_DIRECTORY --env FILE [--state-directory DIR] [--unit FILE] [--owner-receipt FILE]\n'
  + '       data:recovery verify DIRECTORY';

async function main([command, ...args]) {
  if (!command || command === '--help') { console.log(usage); return; }
  const {values, positionals} = parseArgs({args, allowPositionals: true, options: {
    env: {type: 'string'}, unit: {type: 'string'}, 'state-directory': {type: 'string'},
    'owner-receipt': {type: 'string'}, owner: {type: 'string'},
  }});
  const options = {env: values.env, unit: values.unit, stateDirectory: values['state-directory'], ownerReceipt: values['owner-receipt']};
  let result;
  if (command === 'verify' && positionals.length === 1 && !Object.keys(values).length) result = await verifyRecovery(positionals[0]);
  else if (command === 'export' && positionals.length === 1) result = await exportRecovery(positionals[0], options);
  else if (['describe', 'check'].includes(command) && !positionals.length) result = await describeRecovery(options, command === 'check');
  else if (command === 'outputs' && !positionals.length) {
    const {layout} = await recoverySources(options);
    const outputs = await listOutputs(layout);
    result = outputs.filter(item => !values.owner || item.record.owner === values.owner)
      .map(({record, path, bytes}) => ({...record, path, bytes}));
  } else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
