import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,mkdir,readFile,readdir,rm,symlink,truncate,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {verifyBackupRecoverySource} from '../../src/version/recovery-source';

const script=Buffer.from('// ==UserScript==\n// @name safe backup\n// ==/UserScript==\n', 'utf8');
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(file:string,backupDir:string,dir:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'uah-backup-only-'));
  const backupDir=join(dir,'backups');
  const file=join(dir,'sample.user.js');
  try{
    await mkdir(backupDir);
    await writeFile(file,script);
    await run(file,backupDir,dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('TEST-020: explicit backup-only creates independently verified immutable-name copies',async()=>{
  await fixture(async(file,backupDir)=>{
    const before=await readFile(file);
    const request={sourcePath:file,backupDirectory:backupDir,
      expectedSha256:hash(before),userApproved:true};
    const first=await createVerifiedBackupOnly(request);
    const second=await createVerifiedBackupOnly(request);
    assert.equal(first.status,'BACKUP_ONLY',JSON.stringify(first));
    assert.equal(second.status,'BACKUP_ONLY',JSON.stringify(second));
    if(first.status!=='BACKUP_ONLY'||second.status!=='BACKUP_ONLY')return;
    assert.notEqual(first.backupFileName,second.backupFileName);
    for(const result of [first,second]){
      assert.match(result.backupFileName,/\.backup\.user\.js$/);
      assert.equal(result.sha256,hash(before));
      assert.equal(result.byteLength,before.length);
      assert.equal(result.automaticPatchAllowed,false);
      assert.deepEqual(await readFile(join(backupDir,result.backupFileName)),before);
      // No staged hard-link may remain when BACKUP_ONLY is reported.
      const backupStat=await lstat(join(backupDir,result.backupFileName),{bigint:true});
      assert.equal(backupStat.nlink,1n);
      assert.equal(JSON.stringify(result).includes(file),false);
    }
    assert.deepEqual((await readdir(backupDir)).sort(),
      [first.backupFileName,second.backupFileName].sort());
    assert.deepEqual(await readFile(file),before);
  });
});

test('TEST-020: missing approval, hostile options, stale SHA never produce backups',async()=>{
  await fixture(async(file,backupDir)=>{
    const safe={sourcePath:file,backupDirectory:backupDir,
      expectedSha256:hash(script),userApproved:true};
    const hostile:unknown[]=[
      {...safe,userApproved:false},
      {...safe,userApproved:'true'},
      {...safe,expectedSha256:'f'.repeat(64)},
      {...safe,expectedSha256:hash(script).toUpperCase()},
      {...safe,sourcePath:'relative.user.js'},
      {...safe,sourcePath:join(backupDir,'unselected.txt')},
      {...safe,backupDirectory:'relative'},
      {...safe,automaticPatchAllowed:true},
      Object.create(safe),
      {get sourcePath(){throw Error('private path');}},
      null
    ];
    for(const candidate of hostile){
      const result=await createVerifiedBackupOnly(candidate);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(JSON.stringify(result).includes(file),false);
    }
    assert.deepEqual(await readdir(backupDir),[]);
    assert.deepEqual(await readFile(file),script);
  });
});

test('TEST-020: changed, oversized or redirected files block with original untouched',async(t)=>{
  await fixture(async(file,backupDir,dir)=>{
    const request={sourcePath:file,backupDirectory:backupDir,
      expectedSha256:hash(script),userApproved:true};
    await writeFile(file,Buffer.concat([script,Buffer.from('// concurrent edit')]));
    assert.equal((await createVerifiedBackupOnly(request)).status,'BLOCKED');
    await truncate(file,MAX_SCRIPT_BYTES+1);
    const oversized=await createVerifiedBackupOnly(request);
    assert.equal(oversized.status,'BLOCKED');
    if(oversized.status==='BLOCKED')assert.equal(oversized.reason,'SIZE_LIMIT');
    await writeFile(file,script);
    const alias=join(dir,'alias.user.js');
    try {await symlink(file,alias,'file');}
    catch(e) {
      if((e as NodeJS.ErrnoException).code==='EPERM'){
        t.diagnostic('symlink creation unavailable on this runner');
        return;
      }
      throw e;
    }
    assert.equal((await createVerifiedBackupOnly({...request,sourcePath:alias})).status,'BLOCKED');
    const dirAlias=join(dir,'alias-backup');
    try {await symlink(backupDir,dirAlias,'dir');}
    catch(e){
      if((e as NodeJS.ErrnoException).code==='EPERM'){
        t.diagnostic('directory symlink creation unavailable');
        return;
      }
      throw e;
    }
    const result=await createVerifiedBackupOnly({...request,backupDirectory:dirAlias});
    assert.equal(result.status,'BLOCKED');
    if(result.status==='BLOCKED')assert.equal(result.reason,'BACKUP_DIRECTORY_INVALID');
    assert.deepEqual(await readdir(backupDir),[]);
    assert.deepEqual(await readFile(file),script);
  });
});


test('TEST-020: long ASCII and surrogate-pair filenames remain recoverable on Windows',async()=>{
  for(const stem of ['x'.repeat(210),'🌐'.repeat(120)]){
    const dir=await mkdtemp(join(tmpdir(),'uah-long-backup-'));
    const source=join(dir,stem+'.user.js');
    const backupDirectory=join(dir,'backups');
    try{
      await mkdir(backupDirectory);
      await writeFile(source,script);
      const result=await createVerifiedBackupOnly({
        sourcePath:source,backupDirectory,expectedSha256:hash(script),
        userApproved:true
      });
      assert.equal(result.status,'BACKUP_ONLY',JSON.stringify(result));
      if(result.status!=='BACKUP_ONLY')continue;
      // NTFS filename components are bounded by UTF-16 units, not code points.
      assert.ok(result.backupFileName.length<=255);
      assert.equal(result.backupFileName.includes('\uFFFD'),false);
      assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result.backupFileName),false);
      assert.deepEqual(await readFile(join(backupDirectory,result.backupFileName)),script);
      const receipt=await verifyBackupRecoverySource({
        sourcePath:source,backupDirectory,backupFileName:result.backupFileName,
        expectedSha256:result.sha256,expectedByteLength:result.byteLength,
        userApproved:true
      });
      assert.equal(receipt.status,'RECOVERY_SOURCE_VERIFIED_READ_ONLY',JSON.stringify(receipt));
      assert.deepEqual(await readFile(source),script);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
});

test('TEST-020: distinct long script names cannot borrow each other\'s identical-byte backups',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'uah-long-binding-'));
  const backupDirectory=join(dir,'backups');
  // Both stems share the entire old 203-unit truncated prefix.
  const shared='x'.repeat(210);
  const firstPath=join(dir,shared+'A.user.js');
  const otherPath=join(dir,shared+'B.user.js');
  try{
    await mkdir(backupDirectory);
    await writeFile(firstPath,script);
    await writeFile(otherPath,script);
    const first=await createVerifiedBackupOnly({
      sourcePath:firstPath,backupDirectory,expectedSha256:hash(script),userApproved:true
    });
    const other=await createVerifiedBackupOnly({
      sourcePath:otherPath,backupDirectory,expectedSha256:hash(script),userApproved:true
    });
    assert.equal(first.status,'BACKUP_ONLY',JSON.stringify(first));
    assert.equal(other.status,'BACKUP_ONLY',JSON.stringify(other));
    if(first.status!=='BACKUP_ONLY'||other.status!=='BACKUP_ONLY')return;

    // The full-name binding must differ even when the source bytes match.
    const firstPrefix=first.backupFileName.slice(0,-(1+36+'.backup.user.js'.length));
    const otherPrefix=other.backupFileName.slice(0,-(1+36+'.backup.user.js'.length));
    assert.notEqual(firstPrefix,otherPrefix);
    assert.ok(first.backupFileName.length<=255);
    assert.ok(other.backupFileName.length<=255);

    const own=await verifyBackupRecoverySource({
      sourcePath:firstPath,backupDirectory,backupFileName:first.backupFileName,
      expectedSha256:first.sha256,expectedByteLength:first.byteLength,
      userApproved:true
    });
    assert.equal(own.status,'RECOVERY_SOURCE_VERIFIED_READ_ONLY',JSON.stringify(own));

    // Earlier truncation-only names would have accepted this substitution.
    const wrong=await verifyBackupRecoverySource({
      sourcePath:otherPath,backupDirectory,backupFileName:first.backupFileName,
      expectedSha256:first.sha256,expectedByteLength:first.byteLength,
      userApproved:true
    });
    assert.equal(wrong.status,'BLOCKED');
    if(wrong.status==='BLOCKED')assert.equal(wrong.reason,'BACKUP_SOURCE_MISMATCH');
    assert.equal(wrong.automaticRollbackAllowed,false);
    assert.deepEqual(await readFile(firstPath),script);
    assert.deepEqual(await readFile(otherPath),script);
  }finally{await rm(dir,{recursive:true,force:true});}
});
