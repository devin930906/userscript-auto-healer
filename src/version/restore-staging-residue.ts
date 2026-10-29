/** TASK-011 / TEST-020/021/026: fail-closed observation of crash-staging evidence.
 * A pending native restore can live in EITHER the source parent (original
 * replacement bytes) or backup store (unpublished recovery intent).
 * Never remove entries, authorize restoration or return a "clean" snapshot
 * after the directory changes during enumeration. The scan is bounded and
 * cannot substitute for an atomic filesystem lock against external writers.
 */
import type {BigIntStats} from 'node:fs';
import {lstat,opendir} from 'node:fs/promises';
import {join} from 'node:path';
import {hasUnsafePathLink} from './path-boundary';

const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RESTORE_PENDING=new RegExp('^\\.uah-restore-'+UUID+'\\.pending$');
const PUBLISHED_JOURNAL=new RegExp('^\\.uah-restore-'+UUID+'\\.journal\\.json$');
// Valid published restore journals and canonical source path mutexes remain
// legal. Every other name under this native namespace needs manual review.
const RESTORE_PATH_MUTEX=/^\.uah-restore-path-[0-9a-f]{64}$/;
const RESERVED_RESTORE_PREFIX=/^\.uah-restore-/i;
const MAX_ENTRIES=1024;
/** Only a separately captured native inode can exempt this transaction's
 * own staging file. The filename alone is NOT evidence of ownership.
 */
function sameOwnedPending(actual:BigIntStats,owned:BigIntStats):boolean{
 return actual.isFile()&&!actual.isSymbolicLink()&&actual.nlink===1n&&
  owned.isFile()&&!owned.isSymbolicLink()&&owned.nlink===1n&&
  actual.dev===owned.dev&&actual.ino===owned.ino&&
  actual.size===owned.size&&actual.mtimeNs===owned.mtimeNs&&
  actual.ctimeNs===owned.ctimeNs&&
  (actual.mode&0o777n)===(owned.mode&0o777n);
}

/** Native-only directory path from an independently consented OS selection.
 * Throws on unreadable, redirected, changing or oversized directories so the
 * calling manual-restore / read-only inventory refuses a success receipt.
 */
export async function hasInterruptedRestoreStaging(
 directory:string,verifiedOwnPendingName?:string,
 verifiedOwnPendingIdentity?:BigIntStats
):Promise<boolean>{
 // The exemption is only for a staging inode independently verified by
 // its native owning transaction at the last pre-rename boundary. Never
 // exempt an arbitrary filename, backup-store intent, or another restore.
 if((verifiedOwnPendingName!==undefined&&
     !RESTORE_PENDING.test(verifiedOwnPendingName))||
    (verifiedOwnPendingIdentity!==undefined&&verifiedOwnPendingName===undefined))
  throw new Error('invalid owned staging exception');
 if(await hasUnsafePathLink(directory))throw new Error('unsafe restore directory');
 const before=await lstat(directory,{bigint:true});
 if(!before.isDirectory()||before.isSymbolicLink())
  throw new Error('invalid restore directory');
 let entries=0,pending=false,ownedSeen=false;
 const cursor=await opendir(directory);
 for await(const entry of cursor){
  if(++entries>MAX_ENTRIES)throw new Error('restore directory scan limit');
  if(!RESTORE_PENDING.test(entry.name)){
   // Preserve corrupt or renamed native recovery evidence: never report
   // the directory clean merely because its staging filename is malformed.
   if(RESERVED_RESTORE_PREFIX.test(entry.name)&&
      !PUBLISHED_JOURNAL.test(entry.name)&&
      !RESTORE_PATH_MUTEX.test(entry.name))pending=true;
   continue;
  }
  if(entry.name!==verifiedOwnPendingName||!verifiedOwnPendingIdentity){
   pending=true;continue;
  }
  // The sole exemption must still identify the same pre-verified inode.
  // A same-name replacement, symlink or added hard link remains evidence
  // requiring manual reconciliation.
  ownedSeen=true;
  try{
   const current=await lstat(join(directory,entry.name),{bigint:true});
   if(!sameOwnedPending(current,verifiedOwnPendingIdentity))pending=true;
  }catch{pending=true;}
 }
 // Recheck after awaited enumeration; a name swap during this scan cannot
 // silently inherit the previously captured ownership claim.
 if(verifiedOwnPendingName!==undefined){
  if(!ownedSeen||!verifiedOwnPendingIdentity)pending=true;
  else{
   try{
    const current=await lstat(join(directory,verifiedOwnPendingName),{bigint:true});
    if(!sameOwnedPending(current,verifiedOwnPendingIdentity))pending=true;
   }catch{pending=true;}
  }
 }
 const after=await lstat(directory,{bigint:true});
 if(!after.isDirectory()||after.isSymbolicLink()||
    before.dev!==after.dev||before.ino!==after.ino||
    before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||
    await hasUnsafePathLink(directory))
  throw new Error('restore directory changed during scan');
 return pending;
}
