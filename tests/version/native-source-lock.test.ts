import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readdir,readFile,rm,rmdir,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeSourceLockError,withNativeSourceLock} from '../../src/version/native-source-lock';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';

const bytes=Buffer.from('// ==UserScript==\n// @name mutex\n// ==/UserScript==\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(run:(source:string,backups:string,root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'uah-lock-'));
  const source=join(root,'sample.user.js');
  const backups=join(root,'backups');
  try{
    await mkdir(backups);
    await writeFile(source,bytes);
    await run(source,backups,root);
  }finally{await rm(root,{recursive:true,force:true});}
}
function lockError(code:string){
  return (e:unknown)=>e instanceof NativeSourceLockError&&e.code===code;
}

test('TEST-020: same-source concurrent backups fail closed and release after owner returns',async()=>{
  await fixture(async(source,backups,root)=>{
    let signal!:()=>void;
    let release!:()=>void;
    const entered=new Promise<void>(resolve=>{signal=resolve;});
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const owned=withNativeSourceLock(source,async()=>{
      signal();
      await pending;
      return 'finished';
    });
    await entered;
    try{
      await assert.rejects(
        withNativeSourceLock(source,async()=>{throw Error('must not execute');}),
        lockError('SOURCE_LOCKED')
      );
      const denied=await createVerifiedBackupOnly({
        sourcePath:source,backupDirectory:backups,
        expectedSha256:sha(bytes),userApproved:true
      });
      assert.equal(denied.status,'BLOCKED',JSON.stringify(denied));
      if(denied.status==='BLOCKED')assert.equal(denied.reason,'SOURCE_LOCKED');
      assert.deepEqual(await readdir(backups),[]);
      assert.deepEqual(await readFile(source),bytes);
    }finally{release();}
    assert.equal(await owned,'finished');
    assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
    const after=await createVerifiedBackupOnly({
      sourcePath:source,backupDirectory:backups,
      expectedSha256:sha(bytes),userApproved:true
    });
    assert.equal(after.status,'BACKUP_ONLY',JSON.stringify(after));
    assert.deepEqual(await readFile(source),bytes);
  });
});

test('TEST-020: callback failure releases owned mutex but does not modify source',async()=>{
  await fixture(async(source,backups,root)=>{
    await assert.rejects(withNativeSourceLock(source,async()=>{
      throw Error('fixture failure');
    }),/fixture failure/);
    assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
    assert.equal(await withNativeSourceLock(source,async()=>42),42);
    assert.deepEqual(await readFile(source),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020: unexpected source mutation is rejected after action and mutex is cleared',async()=>{
  await fixture(async(source,backups,root)=>{
    await assert.rejects(withNativeSourceLock(source,async()=>{
      await writeFile(source,Buffer.concat([bytes,Buffer.from('// changed')]));
      return 'should not pass';
    }),lockError('SOURCE_CHANGED'));
    assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020: hardlinked and redirected sources are not lockable',async(t)=>{
  await fixture(async(source,backups,root)=>{
    const hardlink=join(root,'other.user.js');
    await link(source,hardlink);
    await assert.rejects(withNativeSourceLock(source,async()=>true),lockError('INVALID_SOURCE'));
    await assert.rejects(withNativeSourceLock(hardlink,async()=>true),lockError('INVALID_SOURCE'));
    const redirected=join(root,'redirect.user.js');
    try{await symlink(source,redirected,'file');}
    catch(e){
      if((e as NodeJS.ErrnoException).code==='EPERM'){
        t.diagnostic('symlink creation unavailable on this runner');
        return;
      }
      throw e;
    }
    await assert.rejects(withNativeSourceLock(redirected,async()=>true),lockError('INVALID_SOURCE'));
    assert.deepEqual(await readFile(source),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020: separate source identities do not block each other',async()=>{
  await fixture(async(source,backups,root)=>{
    const other=join(root,'second.user.js');
    await writeFile(other,bytes);
    const result=await withNativeSourceLock(source,async()=> 
      withNativeSourceLock(other,async()=> 'both-owned')
    );
    assert.equal(result,'both-owned');
    assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
    assert.deepEqual(await readFile(source),bytes);
    assert.deepEqual(await readFile(other),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020: abandoned mutex must block until explicit privileged reconciliation',async()=>{
  await fixture(async(source,backups,root)=>{
    const identity=await lstat(source,{bigint:true});
    const key=sha(Buffer.from(identity.dev.toString()+':'+identity.ino.toString()));
    const lock=join(root,'.uah-source-lock-'+key);
    await mkdir(lock);
    await assert.rejects(withNativeSourceLock(source,async()=>true),lockError('SOURCE_LOCKED'));
    assert.ok((await lstat(lock)).isDirectory());
    assert.deepEqual(await readFile(source),bytes);
    // Test fixture cleanup only. Product code never steals a previous lock.
    await rmdir(lock);
    assert.equal(await withNativeSourceLock(source,async()=>true),true);
    assert.deepEqual(await readdir(backups),[]);
  });
});
