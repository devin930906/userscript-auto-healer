/** TASK-011 / REQ-020 / TEST-020 (read-only preparation only).
 *
 * Re-read a specifically user-selected .user.js file from disk before any
 * future backup or restore transaction. This is NOT a write authorization,
 * backup, rollback, independent consent proof, or Tampermonkey acceptance.
 * Never expose this arbitrary-path entry point over renderer IPC.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {basename, isAbsolute} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';

type FingerprintFailure=
  'INVALID_REQUEST'|'NOT_AUTHORIZED'|'INVALID_PATH'|'SYMLINK_REJECTED'|
  'NOT_REGULAR_FILE'|'HARDLINK_REJECTED'|'SIZE_LIMIT'|'FILE_CHANGED'|'HASH_MISMATCH'|'IO_FAILURE';
export type SourceFingerprintResult=
 |Readonly<{status:'BLOCKED';reason:FingerprintFailure;automaticPatchAllowed:false}>
 |Readonly<{status:'MATCHED_READ_ONLY';sha256:string;byteLength:number;
    automaticPatchAllowed:false}>;

const SHA256=/^[a-f0-9]{64}$/;
function blocked(reason:FingerprintFailure):SourceFingerprintResult{
  return Object.freeze({status:'BLOCKED' as const,reason,automaticPatchAllowed:false as const});
}
type FileIdentity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
function sameIdentity(a:FileIdentity,b:FileIdentity):boolean{
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}

/** Input must come from an independently authorized native file selection.
 * The approval flag here is a preliminary claim, never a security token.
 * The receipt attests only that one bounded read matched at observation time;
 * a later write MUST recheck the source while holding its own transaction lock.
 */
export async function verifyApprovedSourceFingerprint(input:unknown):Promise<SourceFingerprintResult>{
  try{
    if(!input||typeof input!=='object'||Array.isArray(input))return blocked('INVALID_REQUEST');
    const proto=Object.getPrototypeOf(input);
    if(proto!==Object.prototype&&proto!==null)return blocked('INVALID_REQUEST');
    const descriptors=Object.getOwnPropertyDescriptors(input);
    const names=Reflect.ownKeys(descriptors);
    if(names.length!==3||names.some(k=>typeof k!=='string')||
       !['sourcePath','expectedSha256','userApproved'].every(k=>
         Object.prototype.hasOwnProperty.call(descriptors,k)&&
         Object.prototype.hasOwnProperty.call(descriptors[k],'value')))
      return blocked('INVALID_REQUEST');
    const userApproved:unknown=descriptors.userApproved.value;
    const sourcePath:unknown=descriptors.sourcePath.value;
    const expectedSha256:unknown=descriptors.expectedSha256.value;
    if(userApproved!==true)return blocked('NOT_AUTHORIZED');
    if(typeof sourcePath!=='string'||sourcePath.length>4096||
       sourcePath.includes('\0')||!isAbsolute(sourcePath)||
       !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(sourcePath)))
      return blocked('INVALID_PATH');
    if(typeof expectedSha256!=='string'||!SHA256.test(expectedSha256))
      return blocked('INVALID_REQUEST');

    const initial=await lstat(sourcePath,{bigint:true});
    if(initial.isSymbolicLink())return blocked('SYMLINK_REJECTED');
    if(!initial.isFile())return blocked('NOT_REGULAR_FILE');
    // A second pathname to this inode bypasses source-path consent and
    // cannot be safely coordinated by the later native source mutex.
    if(initial.nlink!==1n)return blocked('HARDLINK_REJECTED');
    if(initial.size===0n||initial.size>BigInt(MAX_SCRIPT_BYTES))
      return blocked('SIZE_LIMIT');

    // Refuse a pathname that turns into a symlink after the initial lstat,
    // when supported by the operating system. Descriptor checks still apply.
    const handle=await open(sourcePath,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{
      const opened=await handle.stat({bigint:true});
      if(!opened.isFile()||opened.nlink!==1n||!sameIdentity(initial,opened))
        return blocked('FILE_CHANGED');
      const h=createHash('sha256');
      const buffer=Buffer.allocUnsafe(64*1024);
      let count=0;
      while(true){
        const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
        if(bytesRead===0)break;
        count+=bytesRead;
        if(count>MAX_SCRIPT_BYTES)return blocked('SIZE_LIMIT');
        h.update(buffer.subarray(0,bytesRead));
      }
      const after=await handle.stat({bigint:true});
      const onPath=await lstat(sourcePath,{bigint:true});
      if(onPath.isSymbolicLink()||!onPath.isFile()||onPath.nlink!==1n||
         !sameIdentity(initial,after)||!sameIdentity(after,onPath)||
         BigInt(count)!==after.size)
        return blocked('FILE_CHANGED');
      const digest=h.digest('hex');
      if(digest!==expectedSha256)return blocked('HASH_MISMATCH');
      return Object.freeze({
        status:'MATCHED_READ_ONLY' as const,sha256:digest,
        byteLength:count,automaticPatchAllowed:false as const
      });
    }finally{
      await handle.close();
    }
  }catch{
    // No absolute path, file bytes or filesystem error messages escape.
    return blocked('IO_FAILURE');
  }
}
