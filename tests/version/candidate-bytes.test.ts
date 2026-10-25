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

test('TEST-020: removed or unavailable staged candidate fails closed as CHANGED',async()=>{
 await inTemporaryDirectory(async root=>{
  const expected=Buffer.from('trusted-review-bytes');
  const candidate=join(root,'reviewed.candidate.user.js');
  // A receipt can outlive its staged candidate: never throw or elevate it.
  assert.equal(await verifyExactCandidateBytesReadOnly(candidate,expected),'CHANGED');
  await writeFile(candidate,expected);
  assert.equal(await verifyExactCandidateBytesReadOnly(candidate,expected),'MATCH');
  await unlink(candidate);
  assert.equal(await verifyExactCandidateBytesReadOnly(candidate,expected),'CHANGED');
  // An absent ancestor is also a revoked candidate, not an uncaught IO error.
  assert.equal(await verifyExactCandidateBytesReadOnly(
   join(root,'removed','reviewed.candidate.user.js'),expected),'CHANGED');
 });
});

test('TEST-020/026: candidate receipt snapshots expected bytes before asynchronous I/O',async()=>{
 await inTemporaryDirectory(async(root)=>{
  const file=join(root,'reviewed.candidate.user.js');
  await writeFile(file,Buffer.from('trusted'));
  const expected=Buffer.from('trusted');
  const inFlight=verifyExactCandidateBytesReadOnly(file,expected);
  // Callers must not be able to change an already-started review
  // by mutating a same-length Buffer during asynchronous path checks.
  expected.write('altered');
  assert.equal(await inFlight,'MATCH',
   'the original expected bytes matched at the instant review was requested');

  await writeFile(file,Buffer.from('altered'));
  const anotherExpected=Buffer.from('trusted');
  const secondInFlight=verifyExactCandidateBytesReadOnly(file,anotherExpected);
  anotherExpected.write('altered');
  assert.equal(await secondInFlight,'MISMATCH',
   'a later caller mutation must never turn unapproved bytes into MATCH');
 });
});
