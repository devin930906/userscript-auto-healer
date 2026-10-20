/** TASK-011 / REQ-020 / TEST-020: limited, explicit, backup-only step.
 * Creates a separate byte-for-byte recovery copy; NEVER edits the original,
 * applies a candidate, trusts caller-reported Tampermonkey evidence, or grants
 * automatic write/rollback permission. Privileged/native-callers only:
 * DO NOT expose user-supplied arbitrary paths through renderer IPC.
 */
import {createHash,randomUUID} from 'node:crypto';
import {types as utilTypes} from 'node:util';
import {constants} from 'node:fs';
import {link,lstat,open,unlink} from 'node:fs/promises';
import {basename,isAbsolute,join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {NativeSourceLockError,withNativeSourceLock} from './native-source-lock';
import {hasUnsafePathLink} from './path-boundary';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';

type Failure =
  'INVALID_REQUEST'|'NOT_AUTHORIZED'|'INVALID_PATH'|'SOURCE_CHANGED'|
  'HASH_MISMATCH'|'SIZE_LIMIT'|'BACKUP_DIRECTORY_INVALID'|'SOURCE_LOCKED'|'IO_FAILURE';
export type VerifiedBackupResult =
  | Readonly<{status:'BLOCKED';reason:Failure;automaticPatchAllowed:false}>
  | Readonly<{status:'BACKUP_ONLY';backupFileName:string;sha256:string;
      byteLength:number;automaticPatchAllowed:false}>;

type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const SHA256=/^[a-f0-9]{64}$/;
const deny=(reason:Failure):VerifiedBackupResult=>
  Object.freeze({status:'BLOCKED' as const,reason,automaticPatchAllowed:false as const});
function same(a:Identity,b:Identity):boolean {
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
// A directory's timestamps necessarily change when a staging file is created.
// Preserve directory object identity without requiring unchanged mtime/ctime.
function sameDirectory(a:Identity,b:Identity):boolean {
  return a.dev===b.dev&&a.ino===b.ino;
}
function validPath(path:unknown):path is string {
  return typeof path==='string'&&path.length>0&&path.length<=4096&&
    !path.includes('\0')&&isAbsolute(path);
}


// Windows filename components are limited to 255 UTF-16 units. A script
// basename alone cannot bind a backup to its source: another directory may
// contain the same name and identical bytes. Bind the complete native-selected
// absolute path to the name, using a bounded SHA-256 prefix; refuse alternate
// path spellings rather than inferring an unproven source identity.
// Truncate on Unicode code-point boundaries to avoid lone surrogates.
const MAX_BACKUP_PREFIX_UNITS=255-(1+36+'.backup.user.js'.length);
const SOURCE_PATH_HASH_HEX_UNITS=24;
/** Shared source identity binding for backup creation and recovery inspection.
 * Existing pre-Stable name-only backups are never deleted here, but cannot
 * be independently attested after the stronger path binding is introduced.
 * A future restore must still recheck ownership under a transaction lock.
 */
export function backupPrefix(sourcePath:string):string {
  const stem=basename(sourcePath).replace(/\.user\.js$/i,'');
  const suffix='~'+createHash('sha256').update(sourcePath,'utf8')
    .digest('hex').slice(0,SOURCE_PATH_HASH_HEX_UNITS);
  let prefix='';
  for(const character of stem){
    if(prefix.length+character.length>MAX_BACKUP_PREFIX_UNITS-suffix.length)break;
    prefix+=character;
  }
  return prefix+suffix;
}

/** A caller consent boolean is NOT independent proof of native user selection.
 * The privileged caller must confirm ownership and authorization separately.
 * A successful backup is NOT a locked version, restore capability, or TEST-020
 * completion. Future original-file writes require an independent lock,
 * revalidation, real runtime acceptance and a crash-safe recovery journal.
 */
export async function createVerifiedBackupOnly(input:unknown):Promise<VerifiedBackupResult>{
  try {
    if(!input||typeof input!=='object'||utilTypes.isProxy(input)||
       Array.isArray(input))return deny('INVALID_REQUEST');
    const proto=Object.getPrototypeOf(input);
    if(proto!==Object.prototype&&proto!==null)return deny('INVALID_REQUEST');
    const desc=Object.getOwnPropertyDescriptors(input);
    const fields=Reflect.ownKeys(desc);
    const allowed=['sourcePath','backupDirectory','expectedSha256','userApproved'];
    if(fields.length!==allowed.length||fields.some(k=>typeof k!=='string')||
       allowed.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
         !Object.prototype.hasOwnProperty.call(desc[k],'value')))
      return deny('INVALID_REQUEST');
    if(desc.userApproved.value!==true)return deny('NOT_AUTHORIZED');
    const path:unknown=desc.sourcePath.value;
    const directory:unknown=desc.backupDirectory.value;
    const expected:unknown=desc.expectedSha256.value;
    if(!validPath(path)||!/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(path))||
       !validPath(directory))return deny('INVALID_PATH');
    if(typeof expected!=='string'||!SHA256.test(expected))return deny('INVALID_REQUEST');

    return await withNativeSourceLock(path,async()=>{
    const original=await lstat(path,{bigint:true});
    if(original.isSymbolicLink()||!original.isFile())return deny('INVALID_PATH');
    if(original.size===0n||original.size>BigInt(MAX_SCRIPT_BYTES))return deny('SIZE_LIMIT');
    // lstat(directory) alone follows a junction in an ancestor directory.
    if(await hasUnsafePathLink(directory))return deny('BACKUP_DIRECTORY_INVALID');
    const backupDir=await lstat(directory,{bigint:true});
    if(backupDir.isSymbolicLink()||!backupDir.isDirectory())
      return deny('BACKUP_DIRECTORY_INVALID');

    // Open a stable descriptor and bound the actual bytes read, even if the
    // source grows while being read. O_NOFOLLOW is defense in depth where
    // supported; file identity is checked before and after the read.
    const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    let bytes:Buffer;
    try {
      const opened=await handle.stat({bigint:true});
      if(!opened.isFile()||!same(original,opened))return deny('SOURCE_CHANGED');
      const chunks:Buffer[]=[];
      let size=0;
      const buffer=Buffer.allocUnsafe(64*1024);
      while(true){
        const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
        if(bytesRead===0)break;
        size+=bytesRead;
        if(size>MAX_SCRIPT_BYTES)return deny('SIZE_LIMIT');
        chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));
      }
      const after=await handle.stat({bigint:true});
      const byPath=await lstat(path,{bigint:true});
      if(byPath.isSymbolicLink()||!byPath.isFile()||
         !same(original,after)||!same(after,byPath)||BigInt(size)!==after.size)
        return deny('SOURCE_CHANGED');
      bytes=Buffer.concat(chunks,size);
    }finally{await handle.close();}
    const digest=createHash('sha256').update(bytes).digest('hex');
    if(digest!==expected)return deny('HASH_MISMATCH');

    const name=backupPrefix(path)+'.'+randomUUID()+'.backup.user.js';
    const final=join(directory,name);
    const pending=join(directory,'.'+randomUUID()+'.pending');
    let tempCreated=false;
    try {
      const out=await open(pending,'wx',0o600);
      tempCreated=true;
      try {await out.writeFile(bytes);await out.sync();}
      finally {await out.close();}
      // Bound post-write verification and require stable inode, size and
      // timestamps. An external process can replace/grow a staging file.
      if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
        return deny('IO_FAILURE');

      // Abort if source or destination directory changed before publish.
      const latest=await lstat(path,{bigint:true});
      if(await hasUnsafePathLink(directory))return deny('BACKUP_DIRECTORY_INVALID');
      const currentDir=await lstat(directory,{bigint:true});
      if(latest.isSymbolicLink()||!latest.isFile()||!same(original,latest))
        return deny('SOURCE_CHANGED');
      if(currentDir.isSymbolicLink()||!currentDir.isDirectory()||
         !sameDirectory(backupDir,currentDir))return deny('BACKUP_DIRECTORY_INVALID');

      // Atomic, no-clobber hard link: unlike rename, it cannot replace an
      // existing backup. On unsupported filesystems, block rather than fall
      // back to a non-atomic or overwrite-prone publication path.
      await link(pending,final);
      // The published backup and staging name initially refer to the same
      // inode. Do not report a standalone recovery copy while this temporary
      // hard link still exists: recovery-source rejects multiply linked files.
      // If cleanup fails, report failure and keep the potential backup.
      await unlink(pending);
      tempCreated=false;
      const independent=await lstat(final,{bigint:true});
      if(await hasUnsafePathLink(directory))return deny('BACKUP_DIRECTORY_INVALID');
      const verifiedDir=await lstat(directory,{bigint:true});
      if(independent.isSymbolicLink()||!independent.isFile()||
         independent.nlink!==1n||verifiedDir.isSymbolicLink()||
         !verifiedDir.isDirectory()||!sameDirectory(backupDir,verifiedDir))
        return deny('IO_FAILURE');
      // Now that the temporary hard link is gone, re-open the final name
      // with bounded descriptor reads and recheck both file identities.
      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return deny('IO_FAILURE');

      return Object.freeze({status:'BACKUP_ONLY' as const,
        backupFileName:name,sha256:digest,byteLength:bytes.length,
        automaticPatchAllowed:false as const});
    }catch{
      return deny('IO_FAILURE');
    }finally{
      if(tempCreated)await unlink(pending).catch(()=>{});
      // If post-publication verification failed, leave the unique recovery
      // copy for privileged reconciliation; never claim it was verified.
    }
    });
  }catch(error){
    if(error instanceof NativeSourceLockError){
      // The shared native lock already rejects aliased, junction-backed and
      // multiply-linked sources before the backup callback executes. Preserve
      // the precise refusal so a caller cannot mistake unsafe selection for
      // a transient disk error or retry the same invalid source.
      if(error.code==='SOURCE_LOCKED')return deny('SOURCE_LOCKED');
      if(error.code==='INVALID_SOURCE')return deny('INVALID_PATH');
      if(error.code==='SOURCE_CHANGED')return deny('SOURCE_CHANGED');
    }
    return deny('IO_FAILURE');
  }
}
