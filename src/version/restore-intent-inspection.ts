/**
 * TASK-011 / REQ-020/021 / TEST-020/026.
 * Read-only reconciliation of native, previously published restore intents.
 *
 * A journal may be forged or stale. Source and BOTH independent backups are
 * checked again, but the result grants NO restore rights or manager evidence.
 * Only a trusted native caller may choose source and recovery directory.
 * Never wire this arbitrary-path API to renderer IPC or auto-run recovery.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat,open,opendir} from 'node:fs/promises';
import {basename,isAbsolute,join,resolve} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {hasUnsafePathLink} from './path-boundary';
import {backupPrefix} from './verified-backup';
import {verifyBackupRecoverySource} from './recovery-source';
import {verifyApprovedSourceFingerprint} from './source-snapshot';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'UNSAFE_PATH'|
 'UNSAFE_JOURNAL'|'BACKUP_UNVERIFIED'|'SOURCE_DIVERGED'|'IO_FAILURE';
const noAuthority={
 automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,businessVerified:false as const
};
export type RestoreIntentObservation=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
 |Readonly<{status:'RESTORE_INTENT_OBSERVED_READ_ONLY';
   sourceState:'ORIGINAL_PRESENT'|'DISPLACED_PRESENT';
   originalSha256:string;displacedSha256:string}&typeof noAuthority>;
const deny=(reason:Reason):RestoreIntentObservation=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
const SHA=/^[a-f0-9]{64}$/;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const JOURNAL_NAME=new RegExp('^\\.uah-restore-'+UUID+'\\.journal\\.json$');
const BACKUP_NAME=new RegExp('^'+UUID+'\\.backup\\.user\\.js$');
const STRUCTURAL_BACKUP_NAME=new RegExp('^(.+~[a-f0-9]{24})\\.('+UUID+')\\.backup\\.user\\.js$');
const MAX_JOURNAL_BYTES=4096;
type Input={
 sourcePath:string;backupDirectory:string;journalFileName:string;
 userApproved:boolean
};
type Journal={
 schema:number;state:string;sourcePathSha256:string;
 originalSha256:string;displacedSha256:string;
 originalBackupFileName:string;displacedBackupFileName:string;
 automaticPatchAllowed:boolean;automaticRollbackAllowed:boolean
};
function sameFile(a:BigIntStats,b:BigIntStats):boolean{
 return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function sameDir(a:BigIntStats,b:BigIntStats):boolean{
 return a.dev===b.dev&&a.ino===b.ino;
}
function plain(input:unknown,names:readonly string[]):Record<string,unknown>|null{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||
     nodeTypes.isProxy(input))return null;
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const d=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(d);
  if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
     names.some(k=>!Object.prototype.hasOwnProperty.call(d,k)||
      !Object.prototype.hasOwnProperty.call(d[k],'value')))return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const name of names)out[name]=d[name].value;
  return out;
 }catch{return null;}
}
function validPath(p:unknown):p is string{
 return typeof p==='string'&&p.length>0&&p.length<=4096&&
  !p.includes('\0')&&isAbsolute(p)&&resolve(p)===p;
}
function parse(input:unknown):Input|null{
 const x=plain(input,['sourcePath','backupDirectory','journalFileName','userApproved']);
 if(!x||!validPath(x.sourcePath)||!validPath(x.backupDirectory)||
    typeof x.journalFileName!=='string'||
    !JOURNAL_NAME.test(x.journalFileName)||
    !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(x.sourcePath))||
    typeof x.userApproved!=='boolean')return null;
 return x as Input;
}
function parseJournal(text:string,sourcePath?:string):Journal|null{
 try{
  // Accept only the exact bounded serialization produced by the existing
  // native restore writer. This also rejects duplicate or unexpected keys.
  const parsed:unknown=JSON.parse(text);
  const names=['schema','state','sourcePathSha256','originalSha256',
   'displacedSha256','originalBackupFileName','displacedBackupFileName',
   'automaticPatchAllowed','automaticRollbackAllowed'];
  const x=plain(parsed,names);
  if(!x||text!==JSON.stringify(parsed)+'\n'||x.schema!==1||
     x.state!=='RESTORE_INTENT_UNVERIFIED'||
     x.automaticPatchAllowed!==false||x.automaticRollbackAllowed!==false||
     typeof x.sourcePathSha256!=='string'||!SHA.test(x.sourcePathSha256)||
     (sourcePath!==undefined&&
      x.sourcePathSha256!==createHash('sha256').update(sourcePath).digest('hex'))||
     typeof x.originalSha256!=='string'||!SHA.test(x.originalSha256)||
     typeof x.displacedSha256!=='string'||!SHA.test(x.displacedSha256)||
     x.originalSha256===x.displacedSha256||
     typeof x.originalBackupFileName!=='string'||
     typeof x.displacedBackupFileName!=='string'||
     x.originalBackupFileName===x.displacedBackupFileName)
   return null;
  // Both names MUST be bound to the same selected native source path,
  // regardless of identical script names or bytes in another directory.
  if(sourcePath!==undefined){
   const prefix=backupPrefix(sourcePath)+'.';
   for(const n of [x.originalBackupFileName,x.displacedBackupFileName]){
    if(!n.startsWith(prefix)||!BACKUP_NAME.test(n.slice(prefix.length)))
     return null;
   }
  }else{
   // Path-free preflight checks canonical bytes and one shared naming prefix.
   // It does NOT authenticate the journal to a source or permit any write.
   const original=STRUCTURAL_BACKUP_NAME.exec(x.originalBackupFileName as string);
   const displaced=STRUCTURAL_BACKUP_NAME.exec(x.displacedBackupFileName as string);
   if(!original||!displaced||original[1]!==displaced[1]||
      // Recovery evidence names must stay single native filenames. The
      // source-independent scan must not recognize traversal-shaped backups
      // as valid published intent before an unrelated manual source restore.
      /[\\/\u0000-\u001f]/.test(x.originalBackupFileName as string)||
      /[\\/\u0000-\u001f]/.test(x.displacedBackupFileName as string))return null;
  }
  return x as Journal;
 }catch{return null;}
}
/** Bounded descriptor read with no symlink/hardlink and stable path identity. */
async function readJournal(path:string):Promise<string|null>{
 try{
  if(await hasUnsafePathLink(path))return null;
  const before=await lstat(path,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
     before.size<=0n||before.size>BigInt(MAX_JOURNAL_BYTES))return null;
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const opened=await h.stat({bigint:true});
   if(!opened.isFile()||opened.nlink!==1n||!sameFile(before,opened))
    return null;
   const buffer=Buffer.alloc(MAX_JOURNAL_BYTES+1);
   let count=0;
   while(true){
    const {bytesRead}=await h.read(buffer,count,buffer.length-count,null);
    if(!bytesRead)break;
    count+=bytesRead;
    if(count>MAX_JOURNAL_BYTES)return null;
   }
   const after=await h.stat({bigint:true});
   const byPath=await lstat(path,{bigint:true});
   if(!sameFile(before,after)||!sameFile(after,byPath)||
      byPath.nlink!==1n||await hasUnsafePathLink(path))return null;
   return buffer.subarray(0,count).toString('utf8');
  }finally{await h.close();}
 }catch{return null;}
}
/** Validate only the exact published native journal wire format using the
 * existing bounded, descriptor-verified, single-link reader and parser.
 * This cannot attest source ownership, business recovery or write authority.
 */
export async function hasStructurallyValidNativeRestoreJournalReadOnly(
 path:string
):Promise<boolean>{
 const content=await readJournal(path);
 return content!==null&&parseJournal(content)!==null;
}

/** Recheck a published journal's exact source ownership without exposing its
 * stored digest or names. A structurally valid foreign journal is not a
 * rejected restore for the selected script. This is never write authority.
 * Invalid/redirected records remain subject to the inventory's rejection.
 */
export async function classifyNativeRestoreJournalScopeReadOnly(
 journalPath:string,sourcePath:string
):Promise<'SELECTED_SOURCE'|'OTHER_SOURCE'|'INVALID'>{
 if(!validPath(sourcePath)||!validPath(journalPath)||
    !JOURNAL_NAME.test(basename(journalPath)))return 'INVALID';
 const contents=await readJournal(journalPath);
 const journal=contents===null?null:parseJournal(contents);
 if(!journal)return 'INVALID';
 const expected=createHash('sha256').update(sourcePath).digest('hex');
 if(journal.sourcePathSha256!==expected)return 'OTHER_SOURCE';
 return parseJournal(contents,sourcePath)?'SELECTED_SOURCE':'INVALID';
}

/** Recheck both independent backups with the existing bounded, no-link
 * descriptor verifier. A successful earlier read is not a durable receipt:
 * an external editor can invalidate either backup while source or journal
 * identity is being examined. This remains an observational snapshot only.
 */
async function backupsVerified(x:Input,j:Journal):Promise<boolean>{
 for(const [name,sha] of [
  [j.originalBackupFileName,j.originalSha256],
  [j.displacedBackupFileName,j.displacedSha256]
 ] as const){
  const file=join(x.backupDirectory,name);
  if(await hasUnsafePathLink(file))return false;
  const st=await lstat(file,{bigint:true});
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||
     st.size<=0n||st.size>BigInt(MAX_SCRIPT_BYTES))return false;
  const checked=await verifyBackupRecoverySource({
   sourcePath:x.sourcePath,backupDirectory:x.backupDirectory,
   backupFileName:name,expectedSha256:sha,
   expectedByteLength:Number(st.size),userApproved:true
  });
  if(checked.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')return false;
 }
 return true;
}

/** TASK-011 / TEST-020/021/026: before a NEW native source replacement,
 * conservatively detect a still-published previous recovery intent bound to
 * that exact native-selected source path. A structurally valid intent is
 * RESTORE_INTENT_UNVERIFIED, NOT proof that the user reconciled it.
 *
 * Independent sources may share the same recovery directory; only a
 * source-hash match blocks them. At the final native pre-rename check,
 * permit only the exact inode captured for THIS transaction's published
 * journal, never another same-source journal or a same-name replacement.
 * Unknown or changing recovery evidence fails closed. Read-only snapshots
 * do not constitute OS-exclusive locks.
 */
export async function hasPriorPublishedRestoreIntentForSource(
 sourcePath:string,backupDirectory:string,
 verifiedOwn?:Readonly<{fileName:string;identity:BigIntStats}>
):Promise<boolean>{
 try{
  if(await hasUnsafePathLink(sourcePath)||
     await hasUnsafePathLink(backupDirectory))return true;
  const start=await lstat(backupDirectory,{bigint:true});
  if(!start.isDirectory()||start.isSymbolicLink())return true;
  const expected=createHash('sha256').update(sourcePath).digest('hex');
  if(verifiedOwn!==undefined&&
     (!JOURNAL_NAME.test(verifiedOwn.fileName)||!verifiedOwn.identity.isFile()||
      verifiedOwn.identity.isSymbolicLink()||
      verifiedOwn.identity.nlink!==1n))return true;
  const independent:Array<{path:string;identity:BigIntStats;bytes:string}>=[];
  let entries=0,journals=0,ownSeen=false;
  const directory=await opendir(backupDirectory);
  for await(const entry of directory){
   if(++entries>1024)return true;
   if(!JOURNAL_NAME.test(entry.name))continue;
   if(++journals>32)return true;
   const path=join(backupDirectory,entry.name);
   const before=await lstat(path,{bigint:true});
   if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)
    return true;
   const bytes=await readJournal(path);
   const intent=bytes===null?null:parseJournal(bytes);
   if(!intent||bytes===null)return true;
   // The source path digest is an identity filter, never authentication.
   // Preserve this earlier journal and BOTH recovery versions for manual
   // inspection instead of publishing a new overwrite on top of them.
   const isOwn=verifiedOwn!==undefined&&
     entry.name===verifiedOwn.fileName;
   if(isOwn){
    if(intent.sourcePathSha256!==expected||
       !sameFile(before,verifiedOwn.identity)||
       before.mode!==verifiedOwn.identity.mode)return true;
    ownSeen=true;
   }else if(intent.sourcePathSha256===expected)return true;
   independent.push({path,identity:before,bytes});
  }
  if(verifiedOwn!==undefined&&!ownSeen)return true;
  const end=await lstat(backupDirectory,{bigint:true});
  if(!end.isDirectory()||end.isSymbolicLink()||
     !sameDir(start,end)||start.mtimeNs!==end.mtimeNs||
     start.ctimeNs!==end.ctimeNs||
     await hasUnsafePathLink(backupDirectory))return true;
  // A different source's journal can be replaced or edited during the
  // scan without a parent directory timestamp change. Do not accept a
  // stale "no matching journal" decision in that case.
  for(const entry of independent){
   const now=await lstat(entry.path,{bigint:true});
   if(!now.isFile()||now.isSymbolicLink()||now.nlink!==1n||
      !sameFile(entry.identity,now)||
      await readJournal(entry.path)!==entry.bytes)return true;
  }
  return false;
 }catch{return true;}
}

/** Read-only: classify observed source bytes as old or restored, or refuse.
 * No finding permits any automatic retry, rename, manager action or rollback.
 */
export async function inspectNativeRestoreIntentReadOnly(
 untrusted:unknown
):Promise<RestoreIntentObservation>{
 const x=parse(untrusted);
 if(!x)return deny('INVALID_REQUEST');
 if(!x.userApproved)return deny('NOT_AUTHORIZED');
 try{
  if(await hasUnsafePathLink(x.sourcePath)||
     await hasUnsafePathLink(x.backupDirectory))return deny('UNSAFE_PATH');
  const sourceStart=await lstat(x.sourcePath,{bigint:true});
  const dirStart=await lstat(x.backupDirectory,{bigint:true});
  if(!sourceStart.isFile()||sourceStart.isSymbolicLink()||
     sourceStart.nlink!==1n||sourceStart.size<=0n||
     sourceStart.size>BigInt(MAX_SCRIPT_BYTES)||
     !dirStart.isDirectory()||dirStart.isSymbolicLink())return deny('UNSAFE_PATH');
  const journalPath=join(x.backupDirectory,x.journalFileName);
  // The bounded reader verifies its own descriptor, but subsequent asynchronous
  // backup/source checks can observe a different journal inode with identical
  // bytes. Bind the complete observation to one published file identity.
  let journalBefore:BigIntStats;
  try{journalBefore=await lstat(journalPath,{bigint:true});}
  catch{return deny('UNSAFE_JOURNAL');}
  if(!journalBefore.isFile()||journalBefore.isSymbolicLink()||
     journalBefore.nlink!==1n)return deny('UNSAFE_JOURNAL');
  const contents=await readJournal(journalPath);
  if(contents===null)return deny('UNSAFE_JOURNAL');
  const j=parseJournal(contents,x.sourcePath);
  if(!j)return deny('UNSAFE_JOURNAL');
  if(!await backupsVerified(x,j))return deny('BACKUP_UNVERIFIED');
  const original=await verifyApprovedSourceFingerprint({
   sourcePath:x.sourcePath,expectedSha256:j.originalSha256,userApproved:true
  });
  let sourceState:'ORIGINAL_PRESENT'|'DISPLACED_PRESENT'|null=
   original.status==='MATCHED_READ_ONLY'?'ORIGINAL_PRESENT':null;
  if(!sourceState){
   const displaced=await verifyApprovedSourceFingerprint({
    sourcePath:x.sourcePath,expectedSha256:j.displacedSha256,userApproved:true
   });
   if(displaced.status==='MATCHED_READ_ONLY')sourceState='DISPLACED_PRESENT';
  }
  if(!sourceState)return deny('SOURCE_DIVERGED');
  const sourceEnd=await lstat(x.sourcePath,{bigint:true});
  const dirEnd=await lstat(x.backupDirectory,{bigint:true});
  if(!sameFile(sourceStart,sourceEnd)||sourceEnd.nlink!==1n||
     !sameDir(dirStart,dirEnd)||await hasUnsafePathLink(x.sourcePath)||
     await hasUnsafePathLink(x.backupDirectory))return deny('SOURCE_DIVERGED');
  // Recheck the exact journal after the filesystem operations. Any external
  // mutation requires a new inspection. It never yields write authority.
  if(await readJournal(journalPath)!==contents)return deny('UNSAFE_JOURNAL');
  // Verify the two backups AGAIN after the asynchronous source/journal reads.
  // Without this, an external writer can modify one after its first check
  // and the user sees a false reconciled/verified status.
  if(!await backupsVerified(x,j))return deny('BACKUP_UNVERIFIED');
  // The second backup round has asynchronous reads. A separate process may
  // replace or rewrite the previously verified intent *during* that round.
  // Re-read the exact bounded journal before returning any observation;
  // matching backup bytes cannot authenticate a stale/replaced intent.
  if(await readJournal(journalPath)!==contents)return deny('UNSAFE_JOURNAL');
  // The final independent backup reads suspend execution. An external
  // editor can replace the selected source AFTER our earlier fingerprint
  // and sourceStart/sourceEnd identity check, but BEFORE this observation
  // is returned. Recheck the exact previously observed version and source
  // inode after those awaits; never issue a stale recovery observation.
  // This is still a bounded read-only snapshot, not an exclusive file lock
  // or permission to restore automatically.
  const finalSource=await verifyApprovedSourceFingerprint({
   sourcePath:x.sourcePath,
   expectedSha256:sourceState==='ORIGINAL_PRESENT'
    ?j.originalSha256:j.displacedSha256,
   userApproved:true
  });
  if(finalSource.status!=='MATCHED_READ_ONLY')return deny('SOURCE_DIVERGED');
  const lastSource=await lstat(x.sourcePath,{bigint:true});
  const lastDir=await lstat(x.backupDirectory,{bigint:true});
  if(!sameFile(sourceStart,lastSource)||lastSource.nlink!==1n||
     !sameDir(dirStart,lastDir)||await hasUnsafePathLink(x.sourcePath)||
     await hasUnsafePathLink(x.backupDirectory))return deny('SOURCE_DIVERGED');
  // The final source fingerprint itself awaits filesystem I/O. An external
  // editor can modify the already-verified intent DURING that last read.
  // Refuse stale recovery observations by checking the exact bounded
  // journal once more after the final source verification. This remains a
  // read-only, bounded observation, not an atomic cross-process lock.
  if(await readJournal(journalPath)!==contents)return deny('UNSAFE_JOURNAL');
  // Matching content is not enough: replacement by a new same-byte inode
  // must not receive the original journal's read-only observation.
  let journalAfter:BigIntStats;
  try{journalAfter=await lstat(journalPath,{bigint:true});}
  catch{return deny('UNSAFE_JOURNAL');}
  if(!journalAfter.isFile()||journalAfter.isSymbolicLink()||
     journalAfter.nlink!==1n||!sameFile(journalBefore,journalAfter)||
     journalBefore.mode!==journalAfter.mode)return deny('UNSAFE_JOURNAL');
  return Object.freeze({status:'RESTORE_INTENT_OBSERVED_READ_ONLY' as const,
   sourceState,originalSha256:j.originalSha256,
   displacedSha256:j.displacedSha256,...noAuthority});
 }catch{return deny('IO_FAILURE');}
}
