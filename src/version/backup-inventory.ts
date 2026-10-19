/**
 * TASK-011 / REQ-020 / TEST-020: bounded, read-only recovery candidate inventory.
 *
 * Existing BACKUP_ONLY files have no independently authenticated transaction
 * journal. An observed matching file is NOT a trusted recovery version, and
 * its hash is an observation, not authorization to restore or overwrite.
 * Native, explicitly selected paths only; NEVER expose this to renderer IPC.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat,open,opendir} from 'node:fs/promises';
import {basename,isAbsolute,join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {backupPrefix} from './verified-backup';
import {hasUnsafePathLink} from './path-boundary';
import {verifyBackupRecoverySource} from './recovery-source';

const MAX_DIRECTORY_ENTRIES=512;
const MAX_CANDIDATES=64;
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.backup\.user\.js$/;
type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'INVALID_PATH'|
  'SOURCE_CHANGED'|'SOURCE_SIZE_LIMIT'|'BACKUP_DIRECTORY_INVALID'|'TOO_MANY_ENTRIES'|
  'UNSAFE_BACKUP'|'IO_FAILURE';
const readonlyFlags={
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const,
  tampermonkeyVerified:false as const,businessVerified:false as const
};
export interface ObservedBackupCandidate {
  readonly backupFileName:string;
  readonly observedSha256:string;
  readonly byteLength:number;
}
export type BackupInventoryResult=
  |Readonly<{status:'BLOCKED';reason:Reason}&typeof readonlyFlags>
  |Readonly<{status:'OBSERVED_BACKUP_CANDIDATES_READ_ONLY';
    candidates:ReadonlyArray<Readonly<ObservedBackupCandidate>>}&typeof readonlyFlags>;
const blocked=(reason:Reason):BackupInventoryResult=>
  Object.freeze({status:'BLOCKED' as const,reason,...readonlyFlags});
function absolute(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=4096&&
    !value.includes('\0')&&isAbsolute(value);
}
function sameFile(a:BigIntStats,b:BigIntStats):boolean{
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
    a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function sameDirectory(a:BigIntStats,b:BigIntStats):boolean{
  return a.dev===b.dev&&a.ino===b.ino;
}
function parse(input:unknown):{sourcePath:string;backupDirectory:string}|null {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(desc);
  const allowed=['sourcePath','backupDirectory','userApproved'];
  if(keys.length!==allowed.length||keys.some(k=>typeof k!=='string')||
     allowed.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
       !Object.prototype.hasOwnProperty.call(desc[k],'value')))
    return null;
  const sourcePath:unknown=desc.sourcePath.value;
  const backupDirectory:unknown=desc.backupDirectory.value;
  if(desc.userApproved.value!==true)return {sourcePath:'',backupDirectory:''};
  if(!absolute(sourcePath)||!absolute(backupDirectory)||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(sourcePath)))
    return null;
  return {sourcePath,backupDirectory};
}

/**
 * Report only bounded, currently readable and byte-checked candidates for a
 * single native-selected source. Never delete, alter or restore either side.
 * Each candidate is independently checked using recovery-source's inode,
 * path-binding and content checks. Results are stale immediately after read:
 * a future transaction MUST revalidate under its own lock and journal.
 */
export async function inspectBackupInventoryReadOnly(
  input:unknown
):Promise<BackupInventoryResult>{
 try{
   const parsed=parse(input);
   if(parsed===null)return blocked('INVALID_REQUEST');
   if(parsed.sourcePath==='')return blocked('NOT_AUTHORIZED');
   const {sourcePath,backupDirectory}=parsed;
   // An empty directory contains no candidate to trigger recovery-source's
   // stricter path inspection. Check the full selected path hierarchy first.
   if(await hasUnsafePathLink(sourcePath))return blocked('INVALID_PATH');
   if(await hasUnsafePathLink(backupDirectory))
     return blocked('BACKUP_DIRECTORY_INVALID');
   const sourceStart=await lstat(sourcePath,{bigint:true});
   if(sourceStart.isSymbolicLink()||!sourceStart.isFile()||
      sourceStart.nlink!==1n)return blocked('INVALID_PATH');
   // Recovery inventory must not bless sources that the native fingerprint
   // and backup-only stages would refuse as empty or unbounded.
   if(sourceStart.size<=0n||sourceStart.size>BigInt(MAX_SCRIPT_BYTES))
     return blocked('SOURCE_SIZE_LIMIT');
   const directoryStart=await lstat(backupDirectory,{bigint:true});
   if(directoryStart.isSymbolicLink()||!directoryStart.isDirectory())
     return blocked('BACKUP_DIRECTORY_INVALID');
   const prefix=backupPrefix(sourcePath)+'.';
   // Read entries incrementally. Materializing the entire directory before
   // enforcing the cap would allow an untrusted large folder to exhaust memory.
   const names:string[]=[];
   let entryCount=0;
   const directory=await opendir(backupDirectory);
   for await(const entry of directory){
     if(++entryCount>MAX_DIRECTORY_ENTRIES)return blocked('TOO_MANY_ENTRIES');
     if(entry.name.startsWith(prefix)&&
        UUID_V4.test(entry.name.slice(prefix.length))){
       names.push(entry.name);
       if(names.length>MAX_CANDIDATES)return blocked('TOO_MANY_ENTRIES');
     }
   }
   names.sort();
   const observations:ObservedBackupCandidate[]=[];
   for(const name of names){
     const path=join(backupDirectory,name);
     const before=await lstat(path,{bigint:true});
     if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1n||
        before.size<=0n||before.size>BigInt(MAX_SCRIPT_BYTES))
       return blocked('UNSAFE_BACKUP');
     const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
     let bytes=0;
     let observedHash:string;
     try{
       const opened=await handle.stat({bigint:true});
       if(!opened.isFile()||opened.nlink!==1n||!sameFile(before,opened))
         return blocked('UNSAFE_BACKUP');
       const hash=createHash('sha256');
       const buffer=Buffer.allocUnsafe(64*1024);
       while(true){
         const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
         if(bytesRead===0)break;
         bytes+=bytesRead;
         if(bytes>MAX_SCRIPT_BYTES)return blocked('UNSAFE_BACKUP');
         hash.update(buffer.subarray(0,bytesRead));
       }
       const after=await handle.stat({bigint:true});
       const named=await lstat(path,{bigint:true});
       if(!sameFile(before,after)||!sameFile(after,named)||
          named.nlink!==1n||BigInt(bytes)!==after.size)
         return blocked('UNSAFE_BACKUP');
       observedHash=hash.digest('hex');
     }finally{await handle.close();}
     const inspection=await verifyBackupRecoverySource({
       sourcePath,backupDirectory,backupFileName:name,
       expectedSha256:observedHash,expectedByteLength:bytes,userApproved:true
     });
     if(inspection.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
        inspection.sha256!==observedHash||inspection.byteLength!==bytes)
       return blocked('UNSAFE_BACKUP');
     observations.push(Object.freeze({
       backupFileName:name,observedSha256:observedHash,byteLength:bytes
     }));
   }
   const sourceEnd=await lstat(sourcePath,{bigint:true});
   const directoryEnd=await lstat(backupDirectory,{bigint:true});
   // Recheck after walking potentially untrusted directory entries: a newly
   // redirected ancestor must not yield an apparently clean inventory.
   if(await hasUnsafePathLink(sourcePath))return blocked('SOURCE_CHANGED');
   if(await hasUnsafePathLink(backupDirectory))
     return blocked('BACKUP_DIRECTORY_INVALID');
   if(!sameFile(sourceStart,sourceEnd)||sourceEnd.nlink!==1n||
      sourceEnd.isSymbolicLink())return blocked('SOURCE_CHANGED');
   if(directoryEnd.isSymbolicLink()||!directoryEnd.isDirectory()||
      !sameDirectory(directoryStart,directoryEnd))
     return blocked('BACKUP_DIRECTORY_INVALID');
   return Object.freeze({
     status:'OBSERVED_BACKUP_CANDIDATES_READ_ONLY' as const,
     candidates:Object.freeze(observations),...readonlyFlags
   });
 }catch{
   // Never return paths, contents or native error messages to callers.
   return blocked('IO_FAILURE');
 }
}
