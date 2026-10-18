import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,truncate,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';

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
    assert.equal(first.status,'BACKUP_ONLY');
    assert.equal(second.status,'BACKUP_ONLY');
    if(first.status!=='BACKUP_ONLY'||second.status!=='BACKUP_ONLY')return;
    assert.notEqual(first.backupFileName,second.backupFileName);
    for(const result of [first,second]){
      assert.match(result.backupFileName,/\.backup\.user\.js$/);
      assert.equal(result.sha256,hash(before));
      assert.equal(result.byteLength,before.length);
      assert.equal(result.automaticPatchAllowed,false);
      assert.deepEqual(await readFile(join(backupDir,result.backupFileName)),before);
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
