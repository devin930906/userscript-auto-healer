import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {link,mkdir,mkdtemp,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyExactCandidateBytesReadOnly} from '../../src/version/candidate-bytes';

async function inTemporaryDirectory(run:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-candidate-bounds-'));
 try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
test('TEST-020: exact staged bytes match; same-size edits do not',async()=>{
 await inTemporaryDirectory(async(root)=>{
  const file=join(root,'reviewed.candidate.user.js');
  const expected=Buffer.from("document.querySelector('#new');");
  await writeFile(file,expected);
  assert.equal(await verifyExactCandidateBytesReadOnly(file,expected),'MATCH');
  await writeFile(file,Buffer.from("document.querySelector('#bad');"));
  assert.equal(await verifyExactCandidateBytesReadOnly(file,expected),'MISMATCH');
 });
});
test('TEST-020: unexpectedly grown candidate is refused before bulk read',async()=>{
 await inTemporaryDirectory(async(root)=>{
  const file=join(root,'reviewed.candidate.user.js');
  await writeFile(file,Buffer.alloc(2*1024*1024,0x58));
  assert.equal(await verifyExactCandidateBytesReadOnly(file,Buffer.from('safe')),'CHANGED');
 });
});
test('TEST-020: hard-link alias refuses otherwise matching candidate',async()=>{
 await inTemporaryDirectory(async(root)=>{
  const file=join(root,'reviewed.candidate.user.js');
  const alias=join(root,'alias.user.js');
  const expected=Buffer.from('valid');
  await writeFile(file,expected);
  await link(file,alias);
  assert.equal(await verifyExactCandidateBytesReadOnly(file,expected),'CHANGED');
  await unlink(alias);
  assert.equal(await verifyExactCandidateBytesReadOnly(file,expected),'MATCH');
 });
});
test('TEST-020: symlink and ancestor junction cannot receive matching receipt',async(t)=>{
 await inTemporaryDirectory(async(root)=>{
  const target=join(root,'target.user.js');
  const alias=join(root,'alias.user.js');
  const expected=Buffer.from('valid');
  await writeFile(target,expected);
  try{await symlink(target,alias,'file');}
  catch(error){
   if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
    t.diagnostic('Symlink privilege unavailable');return;
   }
   throw error;
  }
  assert.equal(await verifyExactCandidateBytesReadOnly(alias,expected),'CHANGED');
  const nested=join(root,'nested');await mkdir(nested);
  await writeFile(join(nested,'candidate.user.js'),expected);
  const dirAlias=join(root,'dir-alias');
  try{await symlink(nested,dirAlias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
    t.diagnostic('Junction privilege unavailable');return;
   }
   throw error;
  }
  assert.equal(await verifyExactCandidateBytesReadOnly(
   join(dirAlias,'candidate.user.js'),expected),'CHANGED');
 });
});
