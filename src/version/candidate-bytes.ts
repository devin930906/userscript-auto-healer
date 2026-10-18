/** TASK-011 / TEST-020: bounded, read-only byte verification for native
 * staged selector candidates. A published file is untrusted even when this
 * process created its temporary predecessor. This function does not authorize
 * installing, applying, restoring, or executing any script.
 */
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {hasUnsafePathLink} from './path-boundary';

export type CandidateBytesCheck='MATCH'|'CHANGED'|'MISMATCH';
const same=(a:BigIntStats,b:BigIntStats)=>
  a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

/** Never read the entire on-disk candidate without first checking its size.
 * Recheck the same file descriptor and pathname after reading to reject
 * in-place changes, symlink swaps and hard-link aliases. An external editor
 * can still change a file AFTER this result: no persistent authority exists.
 */
export async function verifyExactCandidateBytesReadOnly(
  path:string,expected:Buffer
):Promise<CandidateBytesCheck>{
  if(!Buffer.isBuffer(expected)||!expected.length||
     expected.length>MAX_SCRIPT_BYTES)return 'CHANGED';
  if(await hasUnsafePathLink(path))return 'CHANGED';
  const before=await lstat(path,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
     before.size!==BigInt(expected.length))return 'CHANGED';

  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const opened=await handle.stat({bigint:true});
    if(!opened.isFile()||opened.nlink!==1n||!same(before,opened))
      return 'CHANGED';
    const chunk=Buffer.allocUnsafe(64*1024);
    let count=0;
    let equal=true;
    while(true){
      // Read at most one byte beyond the expected length, never unbounded
      // bytes from an externally replaced or growing candidate.
      const limit=Math.min(chunk.length,expected.length-count+1);
      const {bytesRead}=await handle.read(chunk,0,limit,null);
      if(bytesRead===0)break;
      if(count+bytesRead>expected.length)return 'CHANGED';
      if(!chunk.subarray(0,bytesRead)
         .equals(expected.subarray(count,count+bytesRead)))equal=false;
      count+=bytesRead;
    }
    const after=await handle.stat({bigint:true});
    const byPath=await lstat(path,{bigint:true});
    if(byPath.isSymbolicLink()||!byPath.isFile()||byPath.nlink!==1n||
       !same(before,after)||!same(after,byPath)||
       count!==expected.length||await hasUnsafePathLink(path))
      return 'CHANGED';
    return equal?'MATCH':'MISMATCH';
  }finally{await handle.close();}
}
