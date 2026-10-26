/** TASK-011 / REQ-020 / TEST-020: recovery SOURCE inspection only.
 * No write, restore, rollback, arbitrary-path renderer IPC, userscript
 * execution, Tampermonkey attestation or permission to auto-apply is provided.
 *
 * A trusted native caller must independently confirm that both paths belong
 * to the consented script/version. userApproved is only an untrusted claim.
 */
import {createHash} from 'node:crypto';
import {types as utilTypes} from 'node:util';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';

type RecoveryFailure=
  'INVALID_REQUEST'|'NOT_AUTHORIZED'|'INVALID_PATH'|
  'BACKUP_DIRECTORY_INVALID'|'SYMLINK_REJECTED'|
  'BACKUP_ALIAS_REJECTED'|'BACKUP_SOURCE_MISMATCH'|
  'SIZE_LIMIT'|'HASH_MISMATCH'|
  'FILE_CHANGED'|'SOURCE_HARDLINK_REJECTED'|'IO_FAILURE';
export type RecoverySourceVerificationResult=
  |Readonly<{status:'BLOCKED';reason:RecoveryFailure;
    automaticPatchAllowed:false;automaticRollbackAllowed:false;
    tampermonkeyVerified:false;businessVerified:false}>
  |Readonly<{status:'RECOVERY_SOURCE_VERIFIED_READ_ONLY';
    sha256:string;byteLength:number;automaticPatchAllowed:false;
    automaticRollbackAllowed:false;
    tampermonkeyVerified:false;businessVerified:false}>;

type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const SHA256=/^[a-f0-9]{64}$/;
const UUID_V4='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BACKUP_NAME=new RegExp(
  '^[^\\\\/\\x00-\\x1f]{1,220}\\.'+UUID_V4+'\\.backup\\.user\\.js$'
);
const flags={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessVerified:false as const
};
function deny(reason:RecoveryFailure):RecoverySourceVerificationResult{
  return Object.freeze({status:'BLOCKED' as const,reason,...flags});
}
function validAbsolute(path:unknown):path is string{
  return typeof path==='string'&&path.length>0&&path.length<=4096&&
    !path.includes('\0')&&isAbsolute(path);
}
function same(a:Identity,b:Identity):boolean{
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function sameDirectory(a:Identity,b:Identity):boolean{
  return a.dev===b.dev&&a.ino===b.ino;
}

/** Confirms ONLY that the requested separate backup still matches its SHA-256
 * and length while the source/directory identities remain stable.
 * There is no long-lived filesystem lock: the receipt expires as soon as any
 * file can change. Actual restoration MUST revalidate under its own lock,
 * verify trusted authorizations, and maintain an atomic recovery journal.
 */
export async function verifyBackupRecoverySource(
 input:unknown
):Promise<RecoverySourceVerificationResult>{
 try{
  if(!input||typeof input!=='object'||utilTypes.isProxy(input)||
     Array.isArray(input))return deny('INVALID_REQUEST');
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return deny('INVALID_REQUEST');
  const desc=Object.getOwnPropertyDescriptors(input);
  const allowed=['sourcePath','backupDirectory','backupFileName',
    'expectedSha256','expectedByteLength','userApproved'];
  const keys=Reflect.ownKeys(desc);
  if(keys.length!==allowed.length||
     keys.some(key=>typeof key!=='string')||
     allowed.some(key=>!Object.prototype.hasOwnProperty.call(desc,key)||
       !Object.prototype.hasOwnProperty.call(desc[key],'value')))
    return deny('INVALID_REQUEST');
  if(desc.userApproved.value!==true)return deny('NOT_AUTHORIZED');
  const source:unknown=desc.sourcePath.value;
  const directory:unknown=desc.backupDirectory.value;
  const name:unknown=desc.backupFileName.value;
  const expectedHash:unknown=desc.expectedSha256.value;
  const expectedSize:unknown=desc.expectedByteLength.value;
  if(!validAbsolute(source)||!validAbsolute(directory)||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(source))||
     typeof name!=='string'||!BACKUP_NAME.test(name))
    return deny('INVALID_PATH');
  // A matching byte hash cannot bind a backup to the selected script:
  // different scripts can have identical bytes. Fail before opening files.
  const nameSuffixLength=1+36+'.backup.user.js'.length;
  if(name.slice(0,-nameSuffixLength)!==backupPrefix(source))
    return deny('BACKUP_SOURCE_MISMATCH');
  if(typeof expectedHash!=='string'||!SHA256.test(expectedHash)||
     typeof expectedSize!=='number'||!Number.isSafeInteger(expectedSize)||
     expectedSize<=0||expectedSize>MAX_SCRIPT_BYTES)
    return deny('INVALID_REQUEST');
  const path=join(directory,name);
  if(path===source)return deny('BACKUP_ALIAS_REJECTED');

  if(await hasUnsafePathLink(directory))return deny('BACKUP_DIRECTORY_INVALID');
  if(await hasUnsafePathLink(source))return deny('INVALID_PATH');
  const dirBefore=await lstat(directory,{bigint:true});
  if(dirBefore.isSymbolicLink()||!dirBefore.isDirectory())
    return deny('BACKUP_DIRECTORY_INVALID');
  const sourceBefore=await lstat(source,{bigint:true});
  // A content-matching backup moved into its own source folder is not an
  // independent recovery source. Do not let old valid backup filenames or
  // hashes bypass the native backup/restore writers' directory boundary.
  const sourceParentBefore=await lstat(dirname(source),{bigint:true});
  if(!sourceParentBefore.isDirectory()||sourceParentBefore.isSymbolicLink()||
     sameDirectory(dirBefore,sourceParentBefore))
    return deny('BACKUP_DIRECTORY_INVALID');
  if(sourceBefore.isSymbolicLink()||!sourceBefore.isFile())
    return deny('INVALID_PATH');
  // A valid old backup must not make an empty or oversized current source
  // eligible for recovery preflight. No writes or restore rights follow.
  if(sourceBefore.size<=0n||sourceBefore.size>BigInt(MAX_SCRIPT_BYTES))
    return deny('SIZE_LIMIT');
  const before=await lstat(path,{bigint:true});
  if(before.isSymbolicLink())return deny('SYMLINK_REJECTED');
  if(!before.isFile())return deny('INVALID_PATH');
  if(before.nlink!==1n||
    (before.dev===sourceBefore.dev&&before.ino===sourceBefore.ino))
    return deny('BACKUP_ALIAS_REJECTED');
  // Preserve the more specific backup-as-source alias diagnosis above.
  // An additional independent path to the source inode also defeats the
  // native-selected source's authorization and lock identity boundary.
  if(sourceBefore.nlink!==1n)return deny('SOURCE_HARDLINK_REJECTED');
  if(before.size<=0n||before.size>BigInt(MAX_SCRIPT_BYTES))return deny('SIZE_LIMIT');

  // O_NOFOLLOW is supplementary (some operating systems lack it).
  // Before/after lstat and descriptor fstat protect against simple swaps.
  // No receipt from a pathname lookup replaces a transaction-held lock.
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let count=0;
  let digest:string;
  try{
    const opened=await handle.stat({bigint:true});
    if(!opened.isFile()||opened.nlink!==1n||!same(before,opened))
      return deny('FILE_CHANGED');
    const hash=createHash('sha256');
    const buffer=Buffer.allocUnsafe(64*1024);
    while(true){
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      if(bytesRead===0)break;
      count+=bytesRead;
      if(count>MAX_SCRIPT_BYTES)return deny('SIZE_LIMIT');
      hash.update(buffer.subarray(0,bytesRead));
    }
    const after=await handle.stat({bigint:true});
    const byPath=await lstat(path,{bigint:true});
    const sourceAfter=await lstat(source,{bigint:true});
    const dirAfter=await lstat(directory,{bigint:true});
    const sourceParentAfter=await lstat(dirname(source),{bigint:true});
    if(await hasUnsafePathLink(directory)||await hasUnsafePathLink(source))
      return deny('FILE_CHANGED');
    if(byPath.isSymbolicLink()||!byPath.isFile()||byPath.nlink!==1n||
       sourceAfter.isSymbolicLink()||!sourceAfter.isFile()||
       sourceAfter.nlink!==1n||
       dirAfter.isSymbolicLink()||!dirAfter.isDirectory()||
       !sourceParentAfter.isDirectory()||sourceParentAfter.isSymbolicLink()||
       !sameDirectory(sourceParentBefore,sourceParentAfter)||
       sameDirectory(dirAfter,sourceParentAfter)||
       !same(before,after)||!same(after,byPath)||
       !same(sourceBefore,sourceAfter)||!sameDirectory(dirBefore,dirAfter)||
       BigInt(count)!==after.size)
      return deny('FILE_CHANGED');
    digest=hash.digest('hex');
  }finally{await handle.close();}
  if(count!==expectedSize||digest!==expectedHash)return deny('HASH_MISMATCH');
  return Object.freeze({
    status:'RECOVERY_SOURCE_VERIFIED_READ_ONLY' as const,
    sha256:digest,byteLength:count,...flags
  });
 }catch{
  // Never expose user paths, file contents or filesystem error messages.
  return deny('IO_FAILURE');
 }
}
