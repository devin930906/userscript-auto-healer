/** TASK-011 / TEST-020/021/026: fail-closed observation of crash-staging evidence.
 * A pending native restore can live in EITHER the source parent (original
 * replacement bytes) or backup store (unpublished recovery intent).
 * Never remove entries, authorize restoration or return a "clean" snapshot
 * after the directory changes during enumeration. The scan is bounded and
 * cannot substitute for an atomic filesystem lock against external writers.
 */
import {lstat,opendir} from 'node:fs/promises';
import {hasUnsafePathLink} from './path-boundary';

const RESTORE_PENDING=/^\.uah-restore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pending$/;
const MAX_ENTRIES=1024;

/** Native-only directory path from an independently consented OS selection.
 * Throws on unreadable, redirected, changing or oversized directories so the
 * calling manual-restore / read-only inventory refuses a success receipt.
 */
export async function hasInterruptedRestoreStaging(directory:string):Promise<boolean>{
 if(await hasUnsafePathLink(directory))throw new Error('unsafe restore directory');
 const before=await lstat(directory,{bigint:true});
 if(!before.isDirectory()||before.isSymbolicLink())
  throw new Error('invalid restore directory');
 let entries=0,pending=false;
 const cursor=await opendir(directory);
 for await(const entry of cursor){
  if(++entries>MAX_ENTRIES)throw new Error('restore directory scan limit');
  if(RESTORE_PENDING.test(entry.name))pending=true;
 }
 const after=await lstat(directory,{bigint:true});
 if(!after.isDirectory()||after.isSymbolicLink()||
    before.dev!==after.dev||before.ino!==after.ino||
    before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||
    await hasUnsafePathLink(directory))
  throw new Error('restore directory changed during scan');
 return pending;
}
