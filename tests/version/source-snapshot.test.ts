import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,lstat,mkdtemp,readFile,rm,symlink,truncate,unlink,writeFile} from 'node:fs/promises';
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

test('TEST-020: hard-linked source cannot receive a trusted fingerprint receipt',async()=>{
  await fixture(async(file,dir)=>{
    const alias=join(dir,'second-name.user.js');
    const request={sourcePath:file,expectedSha256:sha(text),userApproved:true};
    await link(file,alias);
    const first=await verifyApprovedSourceFingerprint(request);
    assert.deepEqual(first,{
      status:'BLOCKED',reason:'HARDLINK_REJECTED',automaticPatchAllowed:false
    });
    const second=await verifyApprovedSourceFingerprint({...request,sourcePath:alias});
    assert.equal(second.status,'BLOCKED');
    if(second.status==='BLOCKED')assert.equal(second.reason,'HARDLINK_REJECTED');
    assert.deepEqual(await readFile(file),Buffer.from(text));
    await unlink(alias);
    const recovered=await verifyApprovedSourceFingerprint(request);
    assert.equal(recovered.status,'MATCHED_READ_ONLY');
    assert.equal(recovered.automaticPatchAllowed,false);
  });
});

test('TEST-020: read-only fingerprint refuses nested junction ancestor',async t=>{
  await fixture(async(file,root)=>{
    const alias=join(root,'junction-to-root');
    try{
      await symlink(root,alias,process.platform==='win32'?'junction':'dir');
    }catch(error){
      if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
        t.diagnostic('Directory junction creation unavailable on this runner');return;
      }
      throw error;
    }
    const redirected=join(alias,'approved.user.js');
    assert.equal((await lstat(redirected)).isSymbolicLink(),false);
    const result=await verifyApprovedSourceFingerprint({
      sourcePath:redirected,expectedSha256:sha(text),userApproved:true
    });
    assert.equal(result.status,'BLOCKED');
    if(result.status==='BLOCKED')assert.equal(result.reason,'SYMLINK_REJECTED');
    assert.deepEqual(await readFile(file),Buffer.from(text));
  });
});
