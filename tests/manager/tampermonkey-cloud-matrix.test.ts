/** TASK-007 / REQ-017/018 / TEST-017/018: real manager original/candidate
 * comparisons must be registered for every supported injection mode.
 * Case registration alone is NOT proof of any real manager or business GATE.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

test('TASK-007/TEST-017/018: original/candidate real manager CI matrix covers four injection modes',()=>{
 const workflow=readFileSync(join(process.cwd(),'.github/workflows/task007-tampermonkey-cloud.yml'),'utf8');
 for(const runAt of ['document-start','document-body','document-end','document-idle']){
  for(const variant of ['product-original','product-candidate']){
   assert.ok(workflow.includes(JSON.stringify({run_at:runAt,variant})),
    'missing independently installed product comparison: '+runAt+' / '+variant);
  }
 }
});
