/** TASK-011 / REQ-020 / TEST-020: cooperative native-only source mutex.
 *
 * A directory created with exclusive mkdir serializes this application's
 * operations on one filesystem identity, independently of backup destination.
 * It does NOT lock third-party editors, establish user authorization, or
 * permit writes/rollback. Do not expose source paths or this entry point via
 * renderer IPC. A crash leaves the lock in place (fail closed); never
 * automatically remove another process's or an abandoned lock.
 */
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {lstat,mkdir,rmdir} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';

export type NativeSourceLockFailure=
  'INVALID_SOURCE'|'SOURCE_LOCKED'|'SOURCE_CHANGED'|'IO_FAILURE';
export class NativeSourceLockError extends Error {
  constructor(readonly code:NativeSourceLockFailure){
    super(code);
    this.name='NativeSourceLockError';
  }
}

type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const sameSource=(a:Identity,b:Identity)=>
  a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDirectory=(a:Identity,b:Identity)=>
  a.dev===b.dev&&a.ino===b.ino;
function failure(error:unknown):NativeSourceLockError{
  return error instanceof NativeSourceLockError?error:
    new NativeSourceLockError('IO_FAILURE');
}

/** Trusted native use only: the caller must already have independently
 * authorized the selected source. Hard links are rejected so alternate paths
 * cannot sidestep the same-file lock. Two paths resolving to the same inode
 * in a shared parent use the same mutex name.
 *
 * An existing mutex is never stolen or timed out: recovery from a crashed
 * process needs separate privileged, manual reconciliation.
 */
export async function withNativeSourceLock<T>(
 sourcePath:string, action:()=>Promise<T>
):Promise<T>{
  if(typeof sourcePath!=='string'||sourcePath.length>4096||
     sourcePath.includes('\0')||!isAbsolute(sourcePath)||
     typeof action!=='function')
    throw new NativeSourceLockError('INVALID_SOURCE');
  const parent=dirname(sourcePath);
  let start:BigIntStats;
  let parentStart:BigIntStats;
  try{
    start=await lstat(sourcePath,{bigint:true});
    parentStart=await lstat(parent,{bigint:true});
    if(start.isSymbolicLink()||!start.isFile()||start.nlink!==1n||
       parentStart.isSymbolicLink()||!parentStart.isDirectory())
      throw new NativeSourceLockError('INVALID_SOURCE');
  }catch(error){throw failure(error);}

  const key=createHash('sha256')
    .update(start.dev.toString()+':'+start.ino.toString())
    .digest('hex');
  const lockPath=join(parent,'.uah-source-lock-'+key);
  try{
    await mkdir(lockPath,{mode:0o700});
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')
      throw new NativeSourceLockError('SOURCE_LOCKED');
    throw failure(error);
  }

  let acquired:BigIntStats|undefined;
  try{
    acquired=await lstat(lockPath,{bigint:true});
    if(acquired.isSymbolicLink()||!acquired.isDirectory())
      throw new NativeSourceLockError('SOURCE_CHANGED');
    const afterLock=await lstat(sourcePath,{bigint:true});
    const parentAfterLock=await lstat(parent,{bigint:true});
    if(afterLock.isSymbolicLink()||!afterLock.isFile()||
       afterLock.nlink!==1n||!sameSource(start,afterLock)||
       parentAfterLock.isSymbolicLink()||!parentAfterLock.isDirectory()||
       !sameDirectory(parentStart,parentAfterLock))
      throw new NativeSourceLockError('SOURCE_CHANGED');

    const result=await action();
    const afterWork=await lstat(sourcePath,{bigint:true});
    const parentAfterWork=await lstat(parent,{bigint:true});
    if(afterWork.isSymbolicLink()||!afterWork.isFile()||
       afterWork.nlink!==1n||!sameSource(start,afterWork)||
       parentAfterWork.isSymbolicLink()||!parentAfterWork.isDirectory()||
       !sameDirectory(parentStart,parentAfterWork))
      throw new NativeSourceLockError('SOURCE_CHANGED');
    return result;
  }finally{
    // Do not delete a different object swapped in under the mutex name.
    // rmdir never removes a nonempty directory: foreign data is preserved.
    try{
      const current=await lstat(lockPath,{bigint:true});
      if(!acquired||current.isSymbolicLink()||!current.isDirectory()||
         !sameDirectory(acquired,current))
        throw new NativeSourceLockError('SOURCE_CHANGED');
      await rmdir(lockPath);
    }catch(error){throw failure(error);}
  }
}
