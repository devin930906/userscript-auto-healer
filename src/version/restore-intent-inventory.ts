/** TASK-011 / REQ-020/021 / TEST-020/021/026.
 * Native-only, bounded, read-only inventory of already-published restore intents.
 * A matching journal is NOT recovery authority. Reuse the independent
 * bounded verification of source, journal and BOTH preserved backups.
 * Never return user file paths, script bytes, digests or journal names.
 */
import {types as nodeTypes} from 'node:util';
import {lstat,opendir} from 'node:fs/promises';
import {basename,isAbsolute,resolve} from 'node:path';
import {hasUnsafePathLink} from './path-boundary';
import {inspectNativeRestoreIntentReadOnly} from './restore-intent-inspection';

const JOURNAL=/^\.uah-restore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.journal\.json$/;
const MAX_DIRECTORY_ENTRIES=1024;
const MAX_RESTORE_INTENTS=32;
const noAuthority={
 automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,businessVerified:false as const
};
type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'UNSAFE_PATH'|'SCAN_LIMIT'|'IO_FAILURE';
export type RestoreIntentInventory=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
 |Readonly<{status:'RESTORE_INTENT_INVENTORY_READ_ONLY';
   inspected:number;originalPresent:number;displacedPresent:number;
   rejected:number}&typeof noAuthority>;
const block=(reason:Reason):RestoreIntentInventory=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});

function parse(input:unknown):{sourcePath:string;backupDirectory:string;userApproved:boolean}|null{
 try{
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||Array.isArray(input))
   return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=['sourcePath','backupDirectory','userApproved'];
  const d=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(d);
  if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
     names.some(k=>!Object.prototype.hasOwnProperty.call(d,k)||
       !Object.prototype.hasOwnProperty.call(d[k],'value')))return null;
  const sourcePath=d.sourcePath.value,backupDirectory=d.backupDirectory.value,
   userApproved=d.userApproved.value;
  if(typeof sourcePath!=='string'||typeof backupDirectory!=='string'||
     typeof userApproved!=='boolean'||
     sourcePath.length===0||backupDirectory.length===0||
     sourcePath.length>4096||backupDirectory.length>4096||
     sourcePath.includes('\0')||backupDirectory.includes('\0')||
     !isAbsolute(sourcePath)||!isAbsolute(backupDirectory)||
     resolve(sourcePath)!==sourcePath||resolve(backupDirectory)!==backupDirectory||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(sourcePath)))
   return null;
  return {sourcePath,backupDirectory,userApproved};
 }catch{return null;}
}

/** Caller MUST use independent trusted OS pickers for both paths. This
 * observational count neither applies, deletes nor authorizes any script.
 * Directory replacement, unbounded enumeration and unexpected I/O fail
 * the whole report rather than yielding a misleading partial success.
 */
export async function inspectNativeRestoreIntentInventoryReadOnly(
 input:unknown
):Promise<RestoreIntentInventory>{
 const x=parse(input);
 if(!x)return block('INVALID_REQUEST');
 if(!x.userApproved)return block('NOT_AUTHORIZED');
 try{
  if(await hasUnsafePathLink(x.sourcePath)||
     await hasUnsafePathLink(x.backupDirectory))return block('UNSAFE_PATH');
  const src=await lstat(x.sourcePath,{bigint:true});
  const dir=await lstat(x.backupDirectory,{bigint:true});
  if(!src.isFile()||src.isSymbolicLink()||src.nlink!==1n||
     !dir.isDirectory()||dir.isSymbolicLink())
   return block('UNSAFE_PATH');
  let visited=0,inspected=0,originalPresent=0,displacedPresent=0,rejected=0;
  const handle=await opendir(x.backupDirectory);
  for await(const entry of handle){
   if(++visited>MAX_DIRECTORY_ENTRIES)return block('SCAN_LIMIT');
   if(!JOURNAL.test(entry.name))continue;
   if(++inspected>MAX_RESTORE_INTENTS)return block('SCAN_LIMIT');
   // Dirent is only a hint; inspector verifies type, source binding,
   // independent backup bytes and journal inode on every observation.
   const observation=await inspectNativeRestoreIntentReadOnly({
    sourcePath:x.sourcePath,backupDirectory:x.backupDirectory,
    journalFileName:entry.name,userApproved:true
   });
   if(observation.status!=='RESTORE_INTENT_OBSERVED_READ_ONLY')rejected++;
   else if(observation.sourceState==='ORIGINAL_PRESENT')originalPresent++;
   else displacedPresent++;
  }
  const srcAfter=await lstat(x.sourcePath,{bigint:true});
  const dirAfter=await lstat(x.backupDirectory,{bigint:true});
  if(!srcAfter.isFile()||srcAfter.isSymbolicLink()||srcAfter.nlink!==1n||
     src.dev!==srcAfter.dev||src.ino!==srcAfter.ino||
     src.size!==srcAfter.size||src.mtimeNs!==srcAfter.mtimeNs||
     src.ctimeNs!==srcAfter.ctimeNs||
     !dirAfter.isDirectory()||dirAfter.isSymbolicLink()||
     dir.dev!==dirAfter.dev||dir.ino!==dirAfter.ino||
     await hasUnsafePathLink(x.sourcePath)||
     await hasUnsafePathLink(x.backupDirectory))return block('UNSAFE_PATH');
  return Object.freeze({status:'RESTORE_INTENT_INVENTORY_READ_ONLY' as const,
   inspected,originalPresent,displacedPresent,rejected,...noAuthority});
 }catch{return block('IO_FAILURE');}
}
