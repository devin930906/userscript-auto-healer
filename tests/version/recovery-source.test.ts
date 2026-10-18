import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,rm,symlink,truncate,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {verifyBackupRecoverySource} from '../../src/version/recovery-source';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';

const original=Buffer.from('// ==UserScript==\n// @name recovery-fixture\n// ==/UserScript==\nconst answer=42;\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type RecoveryRequest={
  sourcePath:string;backupDirectory:string;backupFileName:string;
  expectedSha256:string;expectedByteLength:number;userApproved:boolean;
};
async function fixture(run:(req:RecoveryRequest,backup:string,source:string,dir:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'uah-recovery-'));
  const source=join(dir,'my-script.user.js');
  const backup=join(dir,'backups');
  try{
    await mkdir(backup);
    await writeFile(source,original);
    const b=await createVerifiedBackupOnly({
      sourcePath:source,backupDirectory:backup,
      expectedSha256:sha(original),userApproved:true
    });
    assert.equal(b.status,'BACKUP_ONLY',JSON.stringify(b));
    if(b.status!=='BACKUP_ONLY')return;
    await run({sourcePath:source,backupDirectory:backup,
      backupFileName:b.backupFileName,expectedSha256:b.sha256,
      expectedByteLength:b.byteLength,userApproved:true},join(backup,b.backupFileName),source,dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('TEST-020: a byte-identical standalone backup is a read-only recovery source, never restore permission',async()=>{
  await fixture(async(req,backup,source)=>{
    const before=await readFile(source);
    const result=await verifyBackupRecoverySource(req);
    assert.deepEqual(result,{
      status:'RECOVERY_SOURCE_VERIFIED_READ_ONLY',
      sha256:sha(original),byteLength:original.length,
      automaticPatchAllowed:false,automaticRollbackAllowed:false,
      tampermonkeyVerified:false,businessVerified:false
    });
    assert.deepEqual(await readFile(source),before);
    assert.deepEqual(await readFile(backup),original);
    assert.equal(JSON.stringify(result).includes(source),false);
    assert.equal(JSON.stringify(result).includes(backup),false);
  });
});

test('TEST-020: matching bytes cannot substitute another script backup',async()=>{
  await fixture(async(req,backup,source,dir)=>{
    const unrelated=join(dir,'another-script.user.js');
    await writeFile(unrelated,original);
    const mistaken=await verifyBackupRecoverySource({...req,sourcePath:unrelated});
    assert.equal(mistaken.status,'BLOCKED');
    if(mistaken.status==='BLOCKED')
      assert.equal(mistaken.reason,'BACKUP_SOURCE_MISMATCH');
    assert.equal(mistaken.automaticRollbackAllowed,false);
    assert.deepEqual(await readFile(unrelated),original);
    assert.deepEqual(await readFile(source),original);
    assert.deepEqual(await readFile(backup),original);

    // An extended prefix with a genuine-looking UUID is also rejected.
    const insertedName='my-script.extra.'+
      req.backupFileName.slice('my-script.'.length);
    const falsePrefix=await verifyBackupRecoverySource({
      ...req,backupFileName:insertedName
    });
    assert.equal(falsePrefix.status,'BLOCKED');
    if(falsePrefix.status==='BLOCKED')
      assert.equal(falsePrefix.reason,'BACKUP_SOURCE_MISMATCH');
    assert.deepEqual(await readFile(source),original);
  });
});

test('TEST-020: changed, truncated or missing recovery bytes fail without writing to original',async()=>{
  await fixture(async(req,backup,source)=>{
    await writeFile(backup,Buffer.from('tampered'));
    const changed=await verifyBackupRecoverySource(req);
    assert.equal(changed.status,'BLOCKED');
    if(changed.status==='BLOCKED')assert.equal(changed.reason,'HASH_MISMATCH');
    assert.deepEqual(await readFile(source),original);
    await unlink(backup);
    const missing=await verifyBackupRecoverySource(req);
    assert.equal(missing.status,'BLOCKED');
    assert.equal(missing.automaticRollbackAllowed,false);
    assert.deepEqual(await readFile(source),original);
  });
});

test('TEST-020: consent claim, version, name and exact input schema are mandatory',async()=>{
  await fixture(async(req,backup,source)=>{
    const invalid:unknown[]=[
      {...req,userApproved:false},
      {...req,userApproved:'true'},
      {...req,expectedSha256:'0'.repeat(64)},
      {...req,expectedSha256:req.expectedSha256.toUpperCase()},
      {...req,expectedByteLength:0},
      {...req,expectedByteLength:req.expectedByteLength+1},
      {...req,sourcePath:'relative.user.js'},
      {...req,backupDirectory:'relative'},
      {...req,backupFileName:'../../wrong.user.js'},
      {...req,backupFileName:'.hidden'},
      {...req,automaticRollbackAllowed:true},
      {get backupDirectory(){throw Error('do not leak');}},
      Object.create(req),
      null
    ];
    for(const input of invalid){
      const result=await verifyBackupRecoverySource(input);
      assert.equal(result.status,'BLOCKED',JSON.stringify(result));
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(result.automaticRollbackAllowed,false);
      assert.equal(JSON.stringify(result).includes(source),false);
      assert.equal(JSON.stringify(result).includes(backup),false);
    }
    assert.deepEqual(await readFile(source),original);
    assert.deepEqual(await readFile(backup),original);
  });
});

test('TEST-020: refuse a source hard link impersonating a backup and redirected backup paths',async(t)=>{
  await fixture(async(req,backup,source,dir)=>{
    await unlink(backup);
    await link(source,backup);
    const aliased=await verifyBackupRecoverySource(req);
    assert.equal(aliased.status,'BLOCKED');
    if(aliased.status==='BLOCKED')assert.equal(aliased.reason,'BACKUP_ALIAS_REJECTED');
    assert.deepEqual(await readFile(source),original);
    await unlink(backup);
    await writeFile(backup,original);
    const target=join(dir,'redirect.user.js');
    try {await symlink(backup,target,'file');}
    catch(e){
      if((e as NodeJS.ErrnoException).code==='EPERM'){t.diagnostic('Symlinks unavailable on this Windows runner');return;}
      throw e;
    }
    // A syntactically authentic backup name cannot be replaced with a symlink.
    await unlink(backup);
    await symlink(target,backup,'file');
    const redirected=await verifyBackupRecoverySource(req);
    assert.equal(redirected.status,'BLOCKED');
    if(redirected.status==='BLOCKED')assert.equal(redirected.reason,'SYMLINK_REJECTED');
    assert.deepEqual(await readFile(source),original);
  });
});

test('TEST-020: a hard-linked original is not an eligible recovery source even with a valid separate backup',async()=>{
  await fixture(async(req,backup,source,dir)=>{
    const alias=join(dir,'second-path.user.js');
    await link(source,alias);
    try{
      // This backup was sound before the source acquired another native path.
      // Reject aliases even though the bytes, expected hash and backup match.
      const result=await verifyBackupRecoverySource(req);
      assert.equal(result.status,'BLOCKED');
      if(result.status==='BLOCKED')assert.equal(result.reason,'SOURCE_HARDLINK_REJECTED');
      assert.equal(result.automaticRollbackAllowed,false);
      assert.equal(result.automaticPatchAllowed,false);
      assert.deepEqual(await readFile(source),original);
      assert.deepEqual(await readFile(alias),original);
      assert.deepEqual(await readFile(backup),original);
    }finally{await unlink(alias);}
    const safeAgain=await verifyBackupRecoverySource(req);
    assert.equal(safeAgain.status,'RECOVERY_SOURCE_VERIFIED_READ_ONLY');
    assert.equal(safeAgain.automaticRollbackAllowed,false);
  });
});

test('TEST-020: symlinked destination directory is not a trusted recovery source',async(t)=>{
  await fixture(async(req,backup,source,dir)=>{
    const linkDir=join(dir,'redirected');
    try{await symlink(req.backupDirectory,linkDir,'dir');}
    catch(e){
      if((e as NodeJS.ErrnoException).code==='EPERM'){t.diagnostic('Directory symlinks unavailable');return;}
      throw e;
    }
    const result=await verifyBackupRecoverySource({...req,backupDirectory:linkDir});
    assert.equal(result.status,'BLOCKED');
    if(result.status==='BLOCKED')assert.equal(result.reason,'BACKUP_DIRECTORY_INVALID');
    assert.deepEqual(await readFile(backup),original);
    assert.deepEqual(await readFile(source),original);
  });
});

test('TEST-020: identical script names and bytes in different directories cannot share recovery backups',async()=>{
  const root=await mkdtemp(join(tmpdir(),'uah-path-binding-'));
  const firstDir=join(root,'first');
  const secondDir=join(root,'second');
  const backups=join(root,'backups');
  const firstPath=join(firstDir,'same.user.js');
  const secondPath=join(secondDir,'same.user.js');
  try{
    await mkdir(firstDir);
    await mkdir(secondDir);
    await mkdir(backups);
    await writeFile(firstPath,original);
    await writeFile(secondPath,original);
    const first=await createVerifiedBackupOnly({
      sourcePath:firstPath,backupDirectory:backups,
      expectedSha256:sha(original),userApproved:true
    });
    const second=await createVerifiedBackupOnly({
      sourcePath:secondPath,backupDirectory:backups,
      expectedSha256:sha(original),userApproved:true
    });
    assert.equal(first.status,'BACKUP_ONLY',JSON.stringify(first));
    assert.equal(second.status,'BACKUP_ONLY',JSON.stringify(second));
    if(first.status!=='BACKUP_ONLY'||second.status!=='BACKUP_ONLY')return;
    assert.notEqual(
      first.backupFileName.slice(0,-(1+36+'.backup.user.js'.length)),
      second.backupFileName.slice(0,-(1+36+'.backup.user.js'.length))
    );
    const own=await verifyBackupRecoverySource({
      sourcePath:firstPath,backupDirectory:backups,
      backupFileName:first.backupFileName,expectedSha256:first.sha256,
      expectedByteLength:first.byteLength,userApproved:true
    });
    assert.equal(own.status,'RECOVERY_SOURCE_VERIFIED_READ_ONLY',JSON.stringify(own));
    const substituted=await verifyBackupRecoverySource({
      sourcePath:secondPath,backupDirectory:backups,
      backupFileName:first.backupFileName,expectedSha256:first.sha256,
      expectedByteLength:first.byteLength,userApproved:true
    });
    assert.equal(substituted.status,'BLOCKED');
    if(substituted.status==='BLOCKED')
      assert.equal(substituted.reason,'BACKUP_SOURCE_MISMATCH');
    assert.equal(substituted.automaticRollbackAllowed,false);
    assert.deepEqual(await readFile(firstPath),original);
    assert.deepEqual(await readFile(secondPath),original);
    assert.deepEqual(await readFile(join(backups,first.backupFileName)),original);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('TEST-020: sound backup does not authorize inspecting an empty or oversized source',async()=>{
 for(const size of [0,MAX_SCRIPT_BYTES+1]){
  await fixture(async(req,backup,source)=>{
   await truncate(source,size);
   const result=await verifyBackupRecoverySource(req);
   assert.equal(result.status,'BLOCKED');
   if(result.status==='BLOCKED')assert.equal(result.reason,'SIZE_LIMIT');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(JSON.stringify(result).includes(source),false);
   assert.deepEqual(await readFile(backup),original);
  });
 }
});
