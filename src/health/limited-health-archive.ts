/**
 * TASK-015 / REQ-024 / TEST-024/026: bounded, native-only persistence of
 * UNVERIFIED observation timestamps and classifications.
 *
 * Caller supplies Electron's own userData directory and a SHA-256 scenario
 * scope. This module never accepts renderer paths, raw DOM, script bytes,
 * URL, evidence hashes, or a claim of manager/business verification.
 * Historic observations are NEVER fresh health; a restart always reports
 * INDETERMINATE until an independently consented new observation.
 *
 * The directory mutex and pre/post-publish inode checks are cooperative,
 * not an OS-enforced transaction against arbitrary external editors.
 */
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat,mkdir,open,link,rename,rmdir,unlink} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {hasUnsafePathLink} from '../version/path-boundary';
import type {LimitedHealthSnapshot} from './health-registry';

type State='ELEMENT_FOUND_ONLY'|'INDETERMINATE';
export type ArchiveEvent=Readonly<{observedAtMs:number;status:State}>;
const emptyAuthority=Object.freeze({
 tampermonkeyVerified:false as const,businessVerified:false as const,
 automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
});
export type ArchiveRead=
 |Readonly<{status:'ARCHIVE_READ_UNVERIFIED';currentStatus:'INDETERMINATE';
   events:readonly ArchiveEvent[]}&typeof emptyAuthority>
 |Readonly<{status:'NOT_FOUND'|'BLOCKED'}&typeof emptyAuthority>;
export type ArchiveSave=Readonly<{status:'ARCHIVE_SAVED_UNVERIFIED'|'BLOCKED'}&typeof emptyAuthority>;
const blocked=():ArchiveRead=>Object.freeze({status:'BLOCKED' as const,...emptyAuthority});
const MAX_BYTES=8192;
const SHA=/^[0-9a-f]{64}$/;
const dirName='limited-health-history-v1';
const same=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&
 a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const directorySame=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino;
function validRoot(root:unknown):root is string{
 return typeof root==='string'&&root.length>0&&root.length<=4096&&
  isAbsolute(root)&&root===resolve(root)&&!root.includes('\0');
}
async function baseDir(root:string,create:boolean):Promise<string|null>{
 try{
  if(!validRoot(root)||await hasUnsafePathLink(root))return null;
  const before=await lstat(root,{bigint:true});
  if(!before.isDirectory()||before.isSymbolicLink())return null;
  const dir=join(root,dirName);
  if(create){
   try{await mkdir(dir,{mode:0o700});}
   catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')return null;}
  }
  if(await hasUnsafePathLink(dir))return null;
  const actual=await lstat(dir,{bigint:true});
  const again=await lstat(root,{bigint:true});
  if(!actual.isDirectory()||actual.isSymbolicLink()||
     !directorySame(before,again))return null;
  return dir;
 }catch{return null;}
}
type Entry={events:ArchiveEvent[];bytes:Buffer;identity:BigIntStats};
async function inspectFile(path:string,key:string):Promise<Entry|'NOT_FOUND'|null>{
 try{
  let before:BigIntStats;
  try{before=await lstat(path,{bigint:true});}
  catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'?'NOT_FOUND':null;}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
     before.size<=0n||before.size>BigInt(MAX_BYTES)||
     await hasUnsafePathLink(path))return null;
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const opened=await h.stat({bigint:true});
   if(!opened.isFile()||opened.nlink!==1n||!same(before,opened))return null;
   const chunks:Buffer[]=[];
   const buf=Buffer.alloc(2048);
   let total=0;
   while(true){
    const read=await h.read(buf,0,Math.min(buf.length,MAX_BYTES+1-total),null);
    if(!read.bytesRead)break;
    total+=read.bytesRead;
    if(total>MAX_BYTES)return null;
    chunks.push(Buffer.from(buf.subarray(0,read.bytesRead)));
   }
   const final=await h.stat({bigint:true});
   const byPath=await lstat(path,{bigint:true});
   if(!same(before,final)||!same(final,byPath)||total!==Number(final.size)||
      await hasUnsafePathLink(path))return null;
   const bytes=Buffer.concat(chunks,total);
   const text=bytes.toString('utf8');
   const parsed:unknown=JSON.parse(text);
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
   const data=parsed as Record<string,unknown>;
   if(Object.keys(data).join(',')!=='schema,phase,key,events,automaticPatchAllowed,automaticRollbackAllowed,tampermonkeyVerified,businessVerified'||
      data.schema!=='uah-limited-health-archive-v1'||
      data.phase!=='UNVERIFIED_LOCAL_ARCHIVE_ONLY'||data.key!==key||
      data.automaticPatchAllowed!==false||data.automaticRollbackAllowed!==false||
      data.tampermonkeyVerified!==false||data.businessVerified!==false||
      !Array.isArray(data.events)||data.events.length===0||data.events.length>32||
      text!==JSON.stringify(parsed)+'\n')return null;
   const events:ArchiveEvent[]=[];
   for(const entry of data.events){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
    const e=entry as Record<string,unknown>;
    if(Object.keys(e).join(',')!=='observedAtMs,status'||
       !Number.isSafeInteger(e.observedAtMs)||(e.observedAtMs as number)<0||
       (e.status!=='ELEMENT_FOUND_ONLY'&&e.status!=='INDETERMINATE')||
       (events.length>0&&(e.observedAtMs as number)<=events[events.length-1].observedAtMs))
     return null;
    events.push(Object.freeze({observedAtMs:e.observedAtMs as number,status:e.status}));
   }
   return {events,bytes,identity:final};
  }finally{await h.close();}
 }catch{return null;}
}
function newEvents(snapshot:LimitedHealthSnapshot):ArchiveEvent[]|null{
 try{
  if(!snapshot||!SHA.test(snapshot.scriptHash)||
     snapshot.schema!=='uah-limited-health-v1'||
     snapshot.phase!=='UNVERIFIED_LOCAL_HISTORY'||
     snapshot.tampermonkeyVerified!==false||
     snapshot.businessVerified!==false||
     snapshot.automaticPatchAllowed!==false||
     snapshot.automaticRollbackAllowed!==false||
     !Array.isArray(snapshot.history)||snapshot.history.length===0||
     snapshot.history.length>32)return null;
  const result:ArchiveEvent[]=[];
  for(const event of snapshot.history){
   if(!Number.isSafeInteger(event.observedAtMs)||event.observedAtMs<0||
      (event.status!=='ELEMENT_FOUND_ONLY'&&event.status!=='INDETERMINATE')||
      result.length>0&&event.observedAtMs<=result[result.length-1].observedAtMs)
    return null;
   result.push(Object.freeze({observedAtMs:event.observedAtMs,status:event.status}));
  }
  return result;
 }catch{return null;}
}
function marshal(key:string,events:readonly ArchiveEvent[]):Buffer{
 const data={schema:'uah-limited-health-archive-v1',phase:'UNVERIFIED_LOCAL_ARCHIVE_ONLY',
  key,events,automaticPatchAllowed:false,automaticRollbackAllowed:false,
  tampermonkeyVerified:false,businessVerified:false};
 return Buffer.from(JSON.stringify(data)+'\n','utf8');
}
export async function readLimitedHealthArchive(userData:string,key:string):Promise<ArchiveRead>{
 if(!validRoot(userData)||typeof key!=='string'||!SHA.test(key))return blocked();
 const dir=await baseDir(userData,false);
 if(!dir){
  // Missing journal directory is normal on a first launch; an existing
  // reparse, invalid or inaccessible directory is NOT an empty archive.
  try{
   if(await hasUnsafePathLink(userData))return blocked();
   const root=await lstat(userData);
   if(!root.isDirectory()||root.isSymbolicLink())return blocked();
   try{await lstat(join(userData,dirName));return blocked();}
   catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'?
    Object.freeze({status:'NOT_FOUND' as const,...emptyAuthority}):blocked();}
  }catch{return blocked();}
 }
 const file=join(dir,'health-'+key+'.json');
 const result=await inspectFile(file,key);
 if(result==='NOT_FOUND')return Object.freeze({status:'NOT_FOUND' as const,...emptyAuthority});
 if(!result)return blocked();
 return Object.freeze({status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:Object.freeze(result.events),...emptyAuthority});
}
export async function saveLimitedHealthArchive(
 userData:string,snapshot:LimitedHealthSnapshot
):Promise<ArchiveSave>{
 const fresh=newEvents(snapshot);
 if(!fresh||!validRoot(userData))return Object.freeze({status:'BLOCKED',...emptyAuthority});
 const dir=await baseDir(userData,true);
 if(!dir)return Object.freeze({status:'BLOCKED',...emptyAuthority});
 const key=snapshot.scriptHash;
 const target=join(dir,'health-'+key+'.json');
 const mutex=join(dir,'.health-'+key+'.lock');
 const pending=join(dir,'.health-'+randomUUID()+'.pending');
 let owner:BigIntStats|undefined,staged:BigIntStats|undefined;
 let created=false,lockReleased=false,committed=false;
 let bytes:Buffer|undefined;
 try{
  await mkdir(mutex,{mode:0o700});
  owner=await lstat(mutex,{bigint:true});
  if(!owner.isDirectory()||owner.isSymbolicLink())return Object.freeze({status:'BLOCKED',...emptyAuthority});
  const previous=await inspectFile(target,key);
  if(previous===null)return Object.freeze({status:'BLOCKED',...emptyAuthority});
  const history=previous==='NOT_FOUND'?[]:previous.events;
  const all=[...history];
  for(const event of fresh){
   const latest=all[all.length-1];
   if(latest&&event.observedAtMs<=latest.observedAtMs){
    if(event.observedAtMs===latest.observedAtMs&&event.status!==latest.status)
     return Object.freeze({status:'BLOCKED',...emptyAuthority});
    continue;
   }
   all.push(event);
  }
  const latestHistory=all.slice(-32);
  bytes=marshal(key,latestHistory);
  if(bytes.length>MAX_BYTES)return Object.freeze({status:'BLOCKED',...emptyAuthority});
  const out=await open(pending,'wx',0o600);
  created=true;
  try{await out.writeFile(bytes);await out.sync();staged=await out.stat({bigint:true});}
  finally{await out.close();}
  if(!staged||staged.nlink!==1n)return Object.freeze({status:'BLOCKED',...emptyAuthority});
  const current=await inspectFile(target,key);
  if(!owner||!directorySame(owner,await lstat(mutex,{bigint:true}))||
     (previous==='NOT_FOUND'?current!=='NOT_FOUND':
       current==='NOT_FOUND'||!current||!same(previous.identity,current.identity)||
       !previous.bytes.equals(current.bytes))||
     await hasUnsafePathLink(dir))
   return Object.freeze({status:'BLOCKED',...emptyAuthority});
  if(previous==='NOT_FOUND'){
   // A no-clobber hard link temporarily has nlink=2. Verify both names
   // refer to OUR staged inode before retiring the staging name; only
   // then can the final archive satisfy the independent nlink=1 check.
   await link(pending,target);
   const stagedLink=await lstat(pending,{bigint:true});
   const targetLink=await lstat(target,{bigint:true});
   if(!staged||!stagedLink.isFile()||stagedLink.isSymbolicLink()||
      !targetLink.isFile()||targetLink.isSymbolicLink()||
      stagedLink.nlink!==2n||targetLink.nlink!==2n||
      !directorySame(staged,stagedLink)||
      !directorySame(stagedLink,targetLink)||
      stagedLink.size!==staged.size||targetLink.size!==staged.size)
    return Object.freeze({status:'BLOCKED',...emptyAuthority});
   await unlink(pending);
   created=false;
  }else{
   await rename(pending,target);
   created=false;
  }
  const published=await inspectFile(target,key);
  if(!published||published==='NOT_FOUND'||!published.bytes.equals(bytes))
   return Object.freeze({status:'BLOCKED',...emptyAuthority});
  committed=true;
 }catch{return Object.freeze({status:'BLOCKED',...emptyAuthority});}
 finally{
  // Cleanup only the exact inode this invocation created.
  if(created&&staged){
   try{
    const curr=await lstat(pending,{bigint:true});
    if(directorySame(curr,staged)&&curr.isFile()&&!curr.isSymbolicLink()&&
       (curr.nlink===1n||curr.nlink===2n))await unlink(pending);
   }catch{}
  }
  if(owner){
   try{
    const curr=await lstat(mutex,{bigint:true});
    if(curr.isDirectory()&&!curr.isSymbolicLink()&&directorySame(curr,owner)){
     await rmdir(mutex);lockReleased=true;
    }
   }catch{}
  }
 }
 if(!committed||!lockReleased||!bytes)return Object.freeze({status:'BLOCKED',...emptyAuthority});
 const final=await inspectFile(target,key);
 if(!final||final==='NOT_FOUND'||!final.bytes.equals(bytes))
  return Object.freeze({status:'BLOCKED',...emptyAuthority});
 return Object.freeze({status:'ARCHIVE_SAVED_UNVERIFIED',...emptyAuthority});
}
