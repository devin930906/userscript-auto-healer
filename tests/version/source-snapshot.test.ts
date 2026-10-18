import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,symlink,truncate,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';
import {verifyApprovedSourceFingerprint} from '../../src/version/source-snapshot';

const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const text='// ==UserScript==\n// @name test\n// ==/UserScript==\n';
async function fixture(run:(file:string,dir:string)=>Promise<void>):Promise<void>{
  const dir=await mkdtemp(join(tmpdir(),'uah-fingerprint-'));
  const file=join(dir,'approved.user.js');
  try{await writeFile(file,text);await run(file,dir);}
  finally{await rm(dir,{recursive:true,force:true});}
}
test('TEST-020: explicitly selected unchanged original matches only as a read-only receipt',async()=>{
  await fixture(async file=>{
    const before=await readFile(file);
    const result=await verifyApprovedSourceFingerprint({
      sourcePath:file,expectedSha256:sha(before),userApproved:true
    });
    assert.deepEqual(result,{status:'MATCHED_READ_ONLY',sha256:sha(before),
      byteLength:before.byteLength,automaticPatchAllowed:false});
    assert.deepEqual(await readFile(file),before);
    assert.equal(JSON.stringify(result).includes(file),false);
  });
});
test('TEST-020: deny missing consent, stale source, invalid paths and forged fields',async()=>{
  await fixture(async file=>{
    const args={sourcePath:file,expectedSha256:sha(text),userApproved:true};
    for(const unsafe of [
      {...args,userApproved:false},{...args,userApproved:'true'},
      {...args,expectedSha256:'0'.repeat(64)},
      {...args,expectedSha256:sha(text).toUpperCase()},
      {...args,sourcePath:'relative.user.js'},
      {...args,sourcePath:join(file,'..','a.js')},
      {...args,automaticPatchAllowed:true},
      {get sourcePath(){throw Error('private data');}},
      Object.create({sourcePath:file}),
      null
    ]){
      const result=await verifyApprovedSourceFingerprint(unsafe);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(JSON.stringify(result).includes(file),false);
    }
    await writeFile(file,text+'// changed\n');
    const stale=await verifyApprovedSourceFingerprint(args);
    assert.equal(stale.status,'BLOCKED');
    if(stale.status==='BLOCKED')assert.equal(stale.reason,'HASH_MISMATCH');
  });
});
test('TEST-020: reject directories, oversize files and symlinks without modification',async(t)=>{
  await fixture(async(file,dir)=>{
    const args={sourcePath:file,expectedSha256:sha(text),userApproved:true};
    const directory=await verifyApprovedSourceFingerprint({...args,sourcePath:dir});
    assert.equal(directory.status,'BLOCKED');
    await truncate(file,MAX_SCRIPT_BYTES+1);
    const huge=await verifyApprovedSourceFingerprint(args);
    assert.equal(huge.status,'BLOCKED');
    if(huge.status==='BLOCKED')assert.equal(huge.reason,'SIZE_LIMIT');
    const link=join(dir,'link.user.js');
    try{await symlink(file,link,'file');}
    catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){t.diagnostic('symlink creation unavailable');return;}throw e;}
    const symlinkResult=await verifyApprovedSourceFingerprint({...args,sourcePath:link});
    assert.equal(symlinkResult.status,'BLOCKED');
    if(symlinkResult.status==='BLOCKED')assert.equal(symlinkResult.reason,'SYMLINK_REJECTED');
  });
});
