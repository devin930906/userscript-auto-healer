/** TASK-011 / TEST-020/026: native-only, best-effort staging cleanup.
 * A filename is not unlink authority: compare the source inode, original
 * directory and exact link count. Preserve ambiguous files for manual review.
 * This is a filesystem snapshot, NOT a handle-enforced race-free guarantee.
 */
import type {BigIntStats} from 'node:fs';
import {lstat,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {hasUnsafePathLink} from './path-boundary';

const NAME=/^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pending$/;
/** Only the two native publishers may retire a pending inode after link().
 * Same inode and link count are insufficient if its second name is outside
 * our UUID-scoped backup/candidate output namespace. */
const PUBLISHED_NAME=/^.+\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:backup|candidate)\.user\.js$/;

function same(a:BigIntStats,b:BigIntStats):boolean{
 return a.dev===b.dev&&a.ino===b.ino;
}
function sameBytes(a:BigIntStats,b:BigIntStats):boolean{
 return same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs;
}
/** An ambiguous cleanup leaves the staging evidence in place. */
export async function removeOwnedStagingPending(
 pending:string,owned:BigIntStats,parentOwned:BigIntStats,published?:string
):Promise<boolean>{
 try{
  if(!isAbsolute(pending)||pending!==resolve(pending)||
     !NAME.test(basename(pending))||!owned.isFile()||
     owned.isSymbolicLink()||owned.nlink!==1n||
     await hasUnsafePathLink(pending))return false;
  const folder=dirname(pending);
  const parent=await lstat(folder,{bigint:true});
  if(!parent.isDirectory()||parent.isSymbolicLink()||
     !same(parent,parentOwned))return false;
  const current=await lstat(pending,{bigint:true});
  if(!current.isFile()||current.isSymbolicLink()||
     !sameBytes(current,owned))return false;
  if(published!==undefined){
   if(!isAbsolute(published)||published!==resolve(published)||
      dirname(published)!==folder||published===pending||
      !PUBLISHED_NAME.test(basename(published))||
      await hasUnsafePathLink(published))return false;
   const final=await lstat(published,{bigint:true});
   if(!final.isFile()||final.isSymbolicLink()||
      current.nlink!==2n||final.nlink!==2n||
      !sameBytes(current,final)||!sameBytes(final,owned))return false;
   // Creating the hard link updates ctime, which must not equal owned.ctimeNs.
  }else if(current.nlink!==1n||current.ctimeNs!==owned.ctimeNs){
   return false;
  }
  await unlink(pending);
  if(published!==undefined){
   // A successful pending-name removal alone does not prove that the
   // published pathname still refers to the verified staged inode.
   // Fail closed on post-unlink replacement or an unexpected extra link.
   // This second snapshot narrows, but cannot eliminate, pathname races.
   const remaining=await lstat(published,{bigint:true});
   if(!remaining.isFile()||remaining.isSymbolicLink()||
      remaining.nlink!==1n||!sameBytes(remaining,owned)||
      await hasUnsafePathLink(published))return false;
  }
  return true;
 }catch{return false;}
}
