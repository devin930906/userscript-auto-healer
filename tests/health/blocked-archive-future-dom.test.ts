import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {markLimitedSessionArchiveUnavailable,mergeLimitedSessionArchive} from '../../src/health/session-history';

// TASK-015 / REQ-024 / TEST-024/026. A bounded future timestamp may be
// retained as unverified chronology, but it must never support a current
// positive DOM-health summary when persisted history cannot be read.
test('TASK-015/TEST-024/026: blocked archive refuses future positive DOM observation',()=>{
 const now=Date.now();
 const future=now+60_000; // within the existing 5-minute history skew tolerance
 const view={
  ok:true as const,status:'UNVERIFIED_SESSION_HISTORY_ONLY' as const,
  currentStatus:'ELEMENT_FOUND_ONLY' as const,
  events:[{observedAtMs:future,status:'ELEMENT_FOUND_ONLY' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const response=markLimitedSessionArchiveUnavailable(view);
 assert.deepEqual(response,{
  ok:false,code:'HISTORY_UNAVAILABLE',
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 });
 assert.equal(view.events[0].observedAtMs,future,'caller-owned evidence is unchanged');
});

test('TASK-015/TEST-024: recent native-only DOM observation survives blocked archive',()=>{
 const response=markLimitedSessionArchiveUnavailable({
  ok:true,status:'UNVERIFIED_SESSION_HISTORY_ONLY',
  currentStatus:'ELEMENT_FOUND_ONLY',
  events:[{observedAtMs:Date.now()-1000,status:'ELEMENT_FOUND_ONLY'}],
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 });
 assert.equal(response.ok,true);
 if(!response.ok)return;
 assert.equal(response.archiveUnavailable,true);
 assert.equal(response.currentStatus,'ELEMENT_FOUND_ONLY');
 assert.equal(response.tampermonkeyVerified,false);
 assert.equal(response.businessVerified,false);
 assert.equal(response.automaticPatchAllowed,false);
 assert.equal(response.automaticRollbackAllowed,false);
});

test('TASK-015/TEST-024/026: blocked archive projection does not invoke mutable Array prototype hooks',()=>{
 const observedAtMs=Date.now()-1000;
 const view={
  ok:true as const,status:'UNVERIFIED_SESSION_HISTORY_ONLY' as const,
  currentStatus:'ELEMENT_FOUND_ONLY' as const,
  events:[{observedAtMs,status:'ELEMENT_FOUND_ONLY' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const originalPush=Array.prototype.push;
 const originalIndex=Object.getOwnPropertyDescriptor(Array.prototype,'0');
 let pushCalls=0;
 let setterCalls=0;
 let response:ReturnType<typeof markLimitedSessionArchiveUnavailable>;
 try{
  Array.prototype.push=()=>{
   pushCalls++;
   throw Error('UNTRUSTED_ARRAY_PUSH_EXECUTED');
  };
  Object.defineProperty(Array.prototype,'0',{
   configurable:true,
   set(){
    setterCalls++;
    throw Error('UNTRUSTED_ARRAY_INDEX_SETTER_EXECUTED');
   }
  });
  response=markLimitedSessionArchiveUnavailable(view);
 }finally{
  if(originalIndex)Object.defineProperty(Array.prototype,'0',originalIndex);
  else Reflect.deleteProperty(Array.prototype,'0');
  Array.prototype.push=originalPush;
 }
 assert.equal(pushCalls,0);
 assert.equal(setterCalls,0);
 assert.deepEqual(response,{...view,archiveUnavailable:true});
});

test('TASK-015/TEST-024/026: blocked archive refuses expired positive DOM observation',()=>{
 const now=Date.now();
 // Live limited registry freshness is ten minutes, not the archive's
 // five-minute future chronology allowance. Expired history is visible,
 // but cannot claim a current positive DOM observation.
 const view={
  ok:true as const,status:'UNVERIFIED_SESSION_HISTORY_ONLY' as const,
  currentStatus:'ELEMENT_FOUND_ONLY' as const,
  events:[{observedAtMs:now-10*60_000-1000,status:'ELEMENT_FOUND_ONLY' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const response=markLimitedSessionArchiveUnavailable(view);
 assert.deepEqual(response,{
  ok:false,code:'HISTORY_UNAVAILABLE',
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 });
});

test('TASK-015/TEST-024: expired unverified chronology can remain INDETERMINATE with archive blocked',()=>{
 const response=markLimitedSessionArchiveUnavailable({
  ok:true,status:'UNVERIFIED_SESSION_HISTORY_ONLY',
  currentStatus:'INDETERMINATE',
  events:[{observedAtMs:Date.now()-60*60_000,status:'ELEMENT_FOUND_ONLY'}],
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 });
 assert.equal(response.ok,true);
 if(!response.ok)return;
 assert.equal(response.currentStatus,'INDETERMINATE');
 assert.equal(response.archiveUnavailable,true);
 assert.equal(response.tampermonkeyVerified,false);
 assert.equal(response.businessVerified,false);
 assert.equal(response.automaticPatchAllowed,false);
 assert.equal(response.automaticRollbackAllowed,false);
});

test('TASK-015/TEST-024/026: archive merge does not invoke inherited array index setter during merge',()=>{
 const now=Date.now();
 const current={
  ok:true,status:'UNVERIFIED_SESSION_HISTORY_ONLY',
  currentStatus:'ELEMENT_FOUND_ONLY',
  events:[{observedAtMs:now-1000,status:'ELEMENT_FOUND_ONLY'}],
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 } as Parameters<typeof mergeLimitedSessionArchive>[0];
 const stored={
  status:'ARCHIVE_READ_UNVERIFIED',
  currentStatus:'INDETERMINATE',
  events:[{observedAtMs:now-5000,status:'INDETERMINATE'}],
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false
 } as Parameters<typeof mergeLimitedSessionArchive>[1];
 const previous=Object.getOwnPropertyDescriptor(Array.prototype,'0');
 let setterCalls=0;
 let merged:ReturnType<typeof mergeLimitedSessionArchive>|undefined;
 try{
  Object.defineProperty(Array.prototype,'0',{
   configurable:true,
   set(){setterCalls++;throw Error('UNTRUSTED_MERGE_INDEX_SETTER_EXECUTED');}
  });
  merged=mergeLimitedSessionArchive(current,stored);
 }finally{
  if(previous)Object.defineProperty(Array.prototype,'0',previous);
  else Reflect.deleteProperty(Array.prototype,'0');
 }
 assert.equal(setterCalls,0);
 assert.ok(merged);
 assert.deepEqual(merged.events,[
  {observedAtMs:now-5000,status:'INDETERMINATE'},
  {observedAtMs:now-1000,status:'ELEMENT_FOUND_ONLY'}
 ]);
 assert.equal(merged.currentStatus,'ELEMENT_FOUND_ONLY');
 assert.equal(merged.tampermonkeyVerified,false);
 assert.equal(merged.businessVerified,false);
 assert.equal(merged.automaticPatchAllowed,false);
 assert.equal(merged.automaticRollbackAllowed,false);
});
