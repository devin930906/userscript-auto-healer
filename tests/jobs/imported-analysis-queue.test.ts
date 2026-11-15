import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importApprovedPaths} from '../../src/import/import-service';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';

/** TASK-013 / Issue #857 / TEST-022: each imported file must receive its
 * independent read-only AST opportunity. A 16-file count segment cannot
 * silently exhaust the separate 1 MiB isolated Worker byte budget.
 * All files are disposable, locally generated, and never executed.
 */
test('TASK-013/TEST-022: valid later scripts are not skipped by earlier segment bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-byte-aware-'));
 try{
  const files:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'byte-budget-'+i+'.user.js');
   const source='// ==UserScript==\n// @name byte-budget-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#target");\n/*'+'x'.repeat(400*1024)+'*/';
   await writeFile(file,source);
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  assert.equal(imported.scripts.length,3,'all three authorized scripts must import');
  const counts:number[]=[];
  const previews=await runImportedReadOnlyAnalysisQueue(
   imported.scripts,undefined,(processed,total)=>{
    assert.equal(total,3);
    counts.push(processed);
   });
  assert.equal(previews.length,3);
  for(let i=0;i<previews.length;i++){
   assert.equal(previews[i].status,'STATIC_ANALYSIS_ONLY',
    'script '+i+' is below the per-file ceiling and must not be skipped solely by its preceding files');
   assert.equal(previews[i].tampermonkeyVerified,false);
   assert.equal(previews[i].businessVerified,false);
   assert.equal(previews[i].automaticPatchAllowed,false);
  }
  assert.equal(counts.at(-1),3);
 }finally{await rm(root,{recursive:true,force:true});}
});
