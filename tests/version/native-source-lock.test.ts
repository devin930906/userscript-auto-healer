import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readdir,readFile,rename,rm,rmdir,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeSourceLockError,withNativeSourceLock} from '../../src/version/native-source-lock';
import {hasUnsafePathLink} from '../../src/version/path-boundary';
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


test('TEST-020/026: NTFS stream aliases are refused before native source locking',async()=>{
  await fixture(async(source,backups,root)=>{
    const alias=join(root,'sample.user.js:other.user.js');
    assert.equal(await hasUnsafePathLink(source),false);
    assert.equal(await hasUnsafePathLink(alias),true);
    await assert.rejects(withNativeSourceLock(alias,async()=>{
      throw Error('unsafe action executed');
    }),lockError('INVALID_SOURCE'));
    assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
    assert.deepEqual(await readFile(source),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020/026: unsafe path identity fails before mutex competition or action',async t=>{
  await fixture(async(source,backups,root)=>{
    const identity=await lstat(source,{bigint:true});
    const key=sha(Buffer.from(identity.dev.toString()+':'+identity.ino.toString()));
    const preexistingLock=join(root,'.uah-source-lock-'+key);
    await mkdir(preexistingLock);
    const boundary=require('../../src/version/path-boundary') as
      typeof import('../../src/version/path-boundary');
    const originalCheck=boundary.hasUnsafePathLink;
    let checked=0;
    let executed=false;
    // A deterministic stand-in for a Windows source alias rejected by the
    // shared validator. The old order hits SOURCE_LOCKED BEFORE this check.
    t.mock.method(boundary,'hasUnsafePathLink',async (path:string)=>{
      if(path===source){checked++;return true;}
      return originalCheck(path);
    });
    await assert.rejects(withNativeSourceLock(source,async()=>{
      executed=true;
      return true;
    }),lockError('INVALID_SOURCE'));
    assert.equal(checked,1,'invalid alias must be checked before mkdir');
    assert.equal(executed,false,'no selected source operation may run');
    assert.ok((await lstat(preexistingLock)).isDirectory(),
      'never disturb another process mutex');
    assert.deepEqual(await readFile(source),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});
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

test('TEST-020: nested symlink or junction ancestor cannot bypass a native source lock',async t=>{
  await fixture(async(_source,backups,root)=>{
    const nested=join(root,'canonical','nested');
    await mkdir(nested,{recursive:true});
    const canonical=join(nested,'nested.user.js');
    await writeFile(canonical,bytes);
    const alias=join(root,'alias');
    try{
      await symlink(join(root,'canonical'),alias,
        process.platform==='win32'?'junction':'dir');
    }catch(error){
      if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
        t.diagnostic('Directory symlink creation unavailable on this runner');
        return;
      }
      throw error;
    }
    const redirected=join(alias,'nested','nested.user.js');
    // The immediate parent is an ordinary directory reached THROUGH the
    // junction: checking only lstat(dirname(path)) would incorrectly pass.
    assert.equal((await lstat(join(alias,'nested'))).isSymbolicLink(),false);
    let executed=false;
    await assert.rejects(withNativeSourceLock(redirected,async()=>{
      executed=true;return true;
    }),lockError('INVALID_SOURCE'));
    assert.equal(executed,false);
    assert.equal(await withNativeSourceLock(canonical,async()=>true),true);
    assert.deepEqual(await readFile(canonical),bytes);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020: ancestor replaced with a junction during a native lock cannot pass as unchanged',async t=>{
  await fixture(async(_initial,backups,root)=>{
    const ancestor=join(root,'canonical');
    const moved=join(root,'canonical-moved');
    const nested=join(ancestor,'nested');
    await mkdir(nested,{recursive:true});
    const source=join(nested,'reviewed.user.js');
    await writeFile(source,bytes);
    let unavailable=false;
    let swapped=false;
    let failure:unknown;
    try{
      await withNativeSourceLock(source,async()=>{
        // The underlying file AND its immediate parent retain their dev/ino:
        // only an intermediate ancestor becomes a symlink or junction.
        try{await rename(ancestor,moved);}
        catch(error){
          if(['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??'')){
            unavailable=true;return;
          }
          throw error;
        }
        try{
          await symlink(moved,ancestor,process.platform==='win32'?'junction':'dir');
          swapped=true;
        }catch(error){
          await rename(moved,ancestor);
          if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
            unavailable=true;return;
          }
          throw error;
        }
      });
    }catch(error){failure=error;}
    if(unavailable){
      t.skip('Ancestor rename or junction privileges unavailable');
      assert.equal(failure,undefined);
      return;
    }
    assert.equal(swapped,true);
    assert.ok(lockError('SOURCE_CHANGED')(failure),
      'a redirected ancestor must invalidate the held source lock');
    assert.deepEqual(await readFile(join(moved,'nested','reviewed.user.js')),bytes);
    assert.equal((await readdir(join(moved,'nested')))
      .some(n=>n.startsWith('.uah-source-lock-')),false);
    assert.deepEqual(await readdir(backups),[]);
  });
});

test('TEST-020/026: source changed during native lock retirement is never reported as successful',async t=>{
 await fixture(async(source,backups,root)=>{
  const filesystem=require('node:fs/promises') as typeof import('node:fs/promises');
  const originalRmdir=filesystem.rmdir;
  const externallyChanged=Buffer.concat([bytes,Buffer.from('// foreign edit during unlock\n')]);
  let intercepted=false;
  t.mock.method(filesystem,'rmdir',async(...args:Parameters<typeof originalRmdir>)=>{
   const result=await originalRmdir(...args);
   if(!intercepted&&String(args[0]).includes('.uah-source-lock-')){
    intercepted=true;
    // The cooperative lock was retired after the OLD final identity
    // check. Simulate another process modifying only the selected source
    // before the privileged call can return its success receipt.
    await writeFile(source,externallyChanged);
   }
   return result;
  });
  await assert.rejects(
   withNativeSourceLock(source,async()=> 'successful-backup-observation'),
   lockError('SOURCE_CHANGED')
  );
  assert.equal(intercepted,true,'fault must execute during lock retirement');
  assert.deepEqual(await readFile(source),externallyChanged);
  assert.deepEqual(await readdir(backups),[]);
  assert.equal((await readdir(root)).some(n=>n.startsWith('.uah-source-lock-')),false);
 });
});
