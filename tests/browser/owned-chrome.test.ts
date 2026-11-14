import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { access, lstat, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { launchApprovedIsolatedChrome, readBoundedCdpJson, isLiveApprovedChromeSession, MAX_CDP_TARGET_LIST_BYTES, DEFAULT_CDP_JSON_LIMIT_BYTES } from '../../src/browser/owned-chrome';
import { openApprovedTarget, type TargetNavigationStage } from '../../src/browser/cdp-target';
import {observeApprovedDom} from '../../src/observe/dom-observer';
import { prepareApprovedIsolatedProfile } from '../../src/browser/chrome-launcher';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWindowsLoopbackListeners, resolveWindowsNetstatExecutable } from '../../src/browser/cdp-session';
import { hasUnsafePathLink } from '../../src/version/path-boundary';
const execFileAsync=promisify(execFile);

/** The dedicated Chrome test has repeatedly passed while the same Chrome
 * case intermittently fails late in the 800+-case application suite.
 * Manual CI must measure isolated-before, full-suite and isolated-after
 * on the SAME Windows runner / SHA, even when one phase fails. Never weaken
 * the original 20-second native Chrome safety deadline or emit raw logs.
 */
test('TASK-005/TEST-006/008/009: manual same-runner full-suite differential retains every exit code',()=>{
  const workflow=readFileSync(join(process.cwd(),
    '.github/workflows/task005-portable-product-check.yml'),'utf8');
  assert.match(workflow,/chrome_full_suite_compare:\s*\n\s*description:/);
  assert.match(workflow,/UAH_TEST_CHROME_FULL_SUITE_COMPARE:/);
  assert.match(workflow,/if \(\$env:UAH_TEST_CHROME_FULL_SUITE_COMPARE -eq 'true' -and/);
  assert.match(workflow,/TASK005_FULLSUITE_ISOLATED_BEFORE_BEGIN/);
  assert.match(workflow,/TASK005_FULLSUITE_REGISTERED_BEGIN/);
  assert.match(workflow,/TASK005_FULLSUITE_ISOLATED_AFTER_BEGIN/);
  assert.match(workflow,/TASK005_FULLSUITE_ISOLATED_BEFORE_EXIT=\$beforeExit/);
  assert.match(workflow,/TASK005_FULLSUITE_REGISTERED_EXIT=\$suiteExit/);
  assert.match(workflow,/TASK005_FULLSUITE_ISOLATED_AFTER_EXIT=\$afterExit/);
  assert.match(workflow,/node --test --test-concurrency=1 dist\/tests\/browser\/owned-chrome\.test\.js/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/if \(\$beforeExit -ne 0 -or \$suiteExit -ne 0 -or \$afterExit -ne 0\)/);
  // A diagnostic result can never change the native user's launch contract.
  assert.doesNotMatch(workflow,/UAH_.*TIMEOUT_OVERRIDE|SKIP_CHROME_OWNERSHIP/);
});

function config(executablePath:string,userDataDir:string,port=9223) {
  return {executablePath,userDataDir,remoteDebuggingPort:port,bindAddress:'127.0.0.1'};
}
/** Reserve an OS-assigned loopback port briefly so Windows parallel test files
 * do not compete for the shared default 9223 listener.
 */
async function unusedLoopbackPort():Promise<number>{
  const probe=createServer();
  await new Promise<void>((resolve,reject)=>{
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',resolve);
  });
  const address=probe.address();
  await new Promise<void>((resolve,reject)=>
    probe.close(err=>err?reject(err):resolve()));
  if(!address||typeof address==='string')throw Error('PORT_PROBE_FAILED');
  return address.port;
}
/** Opt-in, manual-workflow-only bounded CPU contention to investigate the
 * historical Windows Chrome child-running/no-CDP startup under resource load.
 * Two test-owned Node children, each at most eight seconds; no user Chrome,
 * profile, script, executable, port, endpoint or system settings are touched.
 * Default pull_request and normal candidate tests never start these children.
 */
function shouldUseCiChromeCpuPressure(platform:string,actions:string|undefined,
  eventName:string|undefined,requested:string|undefined):boolean {
  return platform==='win32'&&actions==='true'&&
    eventName==='workflow_dispatch'&&requested==='true';
}
function beginBoundedCiChromeCpuPressure():{workers:number;stop:()=>void} {
  if(!shouldUseCiChromeCpuPressure(process.platform,process.env.GITHUB_ACTIONS,
    process.env.GITHUB_EVENT_NAME,process.env.UAH_TEST_CHROME_CPU_PRESSURE))
    return {workers:0,stop:()=>{}};
  const children:ReturnType<typeof spawn>[]=[];
  const stop=()=>{
    for(const child of children)
      if(child.pid&&child.exitCode===null&&!child.killed)child.kill();
  };
  try{
    for(let i=0;i<2;i++){
      const child=spawn(process.execPath,
        ['-e','const end=Date.now()+8000;while(Date.now()<end){Math.imul(37,41)}'],
        {shell:false,windowsHide:true,stdio:'ignore'});
      child.on('error',()=>{/* A diagnostic child must not crash the runner. */});
      if(!child.pid)throw Error('CI_CPU_PRESSURE_SPAWN_FAILED');
      children.push(child);
    }
  }catch(error){stop();throw error;}
  return {workers:children.length,stop};
}
test('TASK-005/TEST-006/008/009: CPU pressure is manual Windows CI opt-in only',()=>{
  const active=(platform:string,actions:string|undefined,event:string|undefined,
    requested:string|undefined)=>shouldUseCiChromeCpuPressure(
      platform,actions,event,requested);
  assert.equal(active('win32','true','workflow_dispatch','true'),true);
  for(const entry of [
    ['linux','true','workflow_dispatch','true'],
    ['win32','false','workflow_dispatch','true'],
    ['win32','true','pull_request','true'],
    ['win32','true','push','true'],
    ['win32','true','workflow_dispatch','false'],
    ['win32','true','workflow_dispatch',undefined]
  ] as const)assert.equal(active(entry[0],entry[1],entry[2],entry[3]),false);
});

/** Read only existence of Chrome's bootstrap markers inside this test-owned
 * disposable profile. Never read their contents or report paths, ports/PIDs,
 * command lines, Chrome logs or user data. These hints are not CDP proof.
 */
async function redactedChromeBootstrapMarkers(profile:string):Promise<string>{
  const exists=async(name:string):Promise<'0'|'1'|'?'>=>{
    try{
      // lstat observes a marker itself, including a dangling link. access()
      // follows links and can mistake unreadable/touched state for absence.
      await lstat(join(profile,name));
      return '1';
    }catch(error){
      // Only genuine ENOENT means absent. All other Windows I/O failures
      // are unknown, never authorization for a second Chrome bootstrap.
      try{
        if(error&&typeof error==='object'&&
           Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT')
          return '0';
      }catch{/* Hostile error shape cannot prove absence. */}
      return '?';
    }
  };
  const [state,endpoint]=await Promise.all([
    exists('Local State'),exists('DevToolsActivePort')
  ]);
  return 'state='+state+' endpointMarker='+endpoint;
}

/** TASK-005 / TEST-006/008/009/026: diagnostic-only marker transitions.
 * Never retain profile paths, marker contents, ports, process IDs, errors or
 * untrusted strings. The caller observes only its own disposable CI profile.
 * Recording is monotonic, rounded down to whole seconds and capped to 12
 * transitions; no record is permission to relaunch Chrome or accept a CDP.
 */
function createBoundedChromeBootstrapTimeline(){
  const transitions:string[]=[];
  let last='';
  let lastElapsedMs=-1;
  return {
    observe(elapsedMs:number,marker:unknown):void{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||typeof marker!=='string')
        return;
      const match=/^state=([01]) endpointMarker=([01])$/.exec(marker);
      if(!match||elapsedMs<lastElapsedMs)return;
      // An out-of-order sample cannot rewrite the sequence of readiness states.
      lastElapsedMs=elapsedMs;
      const next=match[1]+match[2];
      if(next===last)return;
      last=next;
      if(transitions.length>=12)return;
      const second=Math.min(31,Math.floor(elapsedMs/1000));
      transitions.push('t'+second+':'+next);
    },
    summary():string{
      return transitions.length>0?transitions.join(','):'NONE';
    }
  };
}
test('TASK-005/TEST-006/008/009/026: profile readiness evidence is bounded, monotonic and content-blind',()=>{
  const timeline=createBoundedChromeBootstrapTimeline();
  timeline.observe(0,'state=0 endpointMarker=0');
  timeline.observe(250,'state=0 endpointMarker=0');
  timeline.observe(1750,'state=1 endpointMarker=0');
  timeline.observe(20750,'state=1 endpointMarker=1');
  timeline.observe(25000,'state=0 endpointMarker=1');
  assert.equal(timeline.summary(),'t0:00,t1:10,t20:11,t25:01');
  const before=timeline.summary();
  // Older asynchronous samples must not invent a backwards boot transition.
  timeline.observe(15000,'state=0 endpointMarker=0');
  assert.equal(timeline.summary(),before);
  for(const [time,marker] of [
    [Infinity,'state=1 endpointMarker=0'],
    [-1,'state=1 endpointMarker=0'],
    [500,'state=1 endpointMarker=1 private-profile-path'],
    [500,'PRIVATE_CHROME_CONTENT'],
    [2000,'state=99 endpointMarker=0']
  ] as const)timeline.observe(time,marker);
  assert.equal(timeline.summary(),before);
  const hostile=createBoundedChromeBootstrapTimeline();
  for(let i=0;i<100;i++)
    hostile.observe(i*1000,
      i%2===0?'state=0 endpointMarker=0':'state=1 endpointMarker=0');
  assert.equal(hostile.summary().split(',').length,12);
  assert.ok(hostile.summary().length<=100);
  assert.ok(!hostile.summary().includes('PRIVATE'));
});


/** TEST-006/008/009: external OS listener *presence*, never identity/authority.
 * Windows CI only. netstat output is immediately reduced to 0/1/? and is
 * NEVER stored or printed: no PID, port, address, profile or command line.
 * An uncertain probe is ?, not proof that no listener exists.
 */
function redactedLocalListenerFromNetstat(output:unknown,port:number):'0'|'1'|'?'{
  if(typeof output!=='string'||!Number.isInteger(port)||port<1024||port>65535)
    return '?';
  // An empty/truncated/unrecognizable netstat receipt cannot prove that
  // the loopback listener is absent. This is CI diagnosis, not CDP authority.
  if(!output.split(/\r?\n/).some(line=>
    /^\s*TCP\s+\S+\s+\S+\s+\S+\s+\d+\s*$/i.test(line)))return '?';
  const pids=parseWindowsLoopbackListeners(output,port);
  // Invalid listener PID fields cannot become a confident presence signal.
  if(pids.some(pid=>!Number.isSafeInteger(pid)||pid<1))return '?';
  return pids.length?'1':'0';
}
async function readTestOnlyLocalListenerPresence(port:number):Promise<'0'|'1'|'?'>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')return '?';
  try{
    const native=resolveWindowsNetstatExecutable(process.env.SystemRoot);
    if(!native||await hasUnsafePathLink(native)||!(await lstat(native)).isFile())
      return '?';
    const {stdout}=await execFileAsync(native,['-ano','-p','TCP'],
      {windowsHide:true,timeout:1200,maxBuffer:8*1024*1024});
    return redactedLocalListenerFromNetstat(stdout,port);
  }catch{return '?';}
}
/** Only changes in the read-only CI listener probe are reported, rounded to
 * seconds and capped. It is intentionally not a browser ownership receipt.
 */
function createBoundedListenerPresenceTimeline(){
  const transitions:string[]=[];
  let last:'0'|'1'|'?'|undefined;
  return {
    observe(elapsedMs:number,presence:unknown):void{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||
         (presence!=='0'&&presence!=='1'&&presence!=='?'))return;
      if(last===presence||transitions.length>=12)return;
      last=presence;
      transitions.push('t'+Math.min(31,Math.floor(elapsedMs/1000))+':'+presence);
    },
    summary():string{return transitions.length?transitions.join(','):'NONE';}
  };
}
test('TASK-005/TEST-006/008/009: CI listener evidence reveals only bounded 0/1/? changes',()=>{
  const port=54321;
  const matched='  TCP    127.0.0.1:54321   0.0.0.0:0   LISTENING  987654';
  assert.equal(redactedLocalListenerFromNetstat(matched,port),'1');
  assert.equal(redactedLocalListenerFromNetstat(
    '  TCP 0.0.0.0:54321 0.0.0.0:0 LISTENING 987654',port),'0');
  assert.equal(redactedLocalListenerFromNetstat(matched,0),'?');
  assert.equal(redactedLocalListenerFromNetstat({},port),'?');
  assert.equal(redactedLocalListenerFromNetstat('',port),'?',
    'empty netstat output is an inconclusive diagnostic, not no listener');
  assert.equal(redactedLocalListenerFromNetstat('unexpected tool output',port),'?',
    'unrecognizable output must not be interpreted as a negative listener probe');
  assert.equal(redactedLocalListenerFromNetstat(
    '  TCP    127.0.0.1:54321   0.0.0.0:0   LISTENING  invalid-pid',port),'?',
    'malformed listener identity must remain unknown');
  const timeline=createBoundedListenerPresenceTimeline();
  timeline.observe(0,'0');
  timeline.observe(300,'0');
  timeline.observe(2100,'1');
  timeline.observe(3100,'?');
  timeline.observe(4700,'0');
  timeline.observe(4800,'PID=987654');
  assert.equal(timeline.summary(),'t0:0,t2:1,t3:?,t4:0');
  for(let i=0;i<100;i++)timeline.observe(5000+i*100,i%2?'0':'1');
  assert.equal(timeline.summary().split(',').length,12);
  assert.ok(timeline.summary().length<=100);
  assert.ok(!timeline.summary().includes('987654'));
  assert.ok(!timeline.summary().includes('54321'));
});

/** Fixed-label CDP probe stage timing for a single disposable Windows CI launch.
 * Capture only the first/last second of each known stage, never raw errors,
 * URLs, PIDs, ports, Chrome Profile paths or fetched browser responses.
 * Stage windows are diagnostics, not authorization or reasons to retry.
 */
function createBoundedCdpStageWindows() {
  const permitted=new Set([
    'CHROME_SPAWN_RETURNED','FETCH_FAILED','FETCH_REFUSED','FETCH_TIMEOUT','FETCH_RESET',
    'CHILD_RUNNING_NO_CDP','HTTP_REJECTED','BODY_REJECTED',
    'CDP_VERSION_REJECTED','CDP_VERSION_PARSED','PROBE_ERROR',
    'CDP_TIMEOUT_LISTENER_PID_MATCH','CDP_TIMEOUT_LISTENER_UNAVAILABLE',
    'CDP_TIMEOUT_LISTENER_PID_MISMATCH','CDP_TIMEOUT_LISTENER_AMBIGUOUS',
    'CDP_TIMEOUT_PROBE_INCONCLUSIVE'
  ]);
  const windows=new Map<string,{first:number;last:number}>();
  return {
    observe(elapsedMs:number,stage:unknown):void {
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||typeof stage!=='string'||
         !permitted.has(stage))return;
      const second=Math.min(31,Math.floor(elapsedMs/1000));
      const previous=windows.get(stage);
      if(previous){previous.last=Math.max(previous.last,second);return;}
      if(windows.size<16)windows.set(stage,{first:second,last:second});
    },
    summary():string {
      return windows.size?
        Array.from(windows,([stage,period])=>
          stage+'=t'+period.first+'..t'+period.last).join(','):'NONE';
    }
  };
}
test('TASK-005/TEST-006/008/009: startup stage windows expose only bounded fixed-label timings',()=>{
  const windows=createBoundedCdpStageWindows();
  windows.observe(1400,'CHROME_SPAWN_RETURNED');
  windows.observe(0,'FETCH_REFUSED');
  windows.observe(19999,'FETCH_REFUSED');
  windows.observe(20001,'CHILD_RUNNING_NO_CDP');
  windows.observe(20002,'CDP_TIMEOUT_LISTENER_UNAVAILABLE');
  const before=windows.summary();
  assert.equal(before,
    'CHROME_SPAWN_RETURNED=t1..t1,FETCH_REFUSED=t0..t19,'+
    'CHILD_RUNNING_NO_CDP=t20..t20,'+
    'CDP_TIMEOUT_LISTENER_UNAVAILABLE=t20..t20');
  for(const [elapsed,stage] of [
    [-1,'FETCH_FAILED'],[Infinity,'FETCH_FAILED'],[1000,'PRIVATE_PORT=12345'],
    [1000,'PROFILE=SECRET'],[NaN,'FETCH_RESET'],[1000,{code:'FETCH_FAILED'}]
  ] as const)windows.observe(elapsed,stage);
  assert.equal(windows.summary(),before);
  assert.ok(!windows.summary().includes('12345'));
  assert.ok(!windows.summary().includes('SECRET'));
  const many=createBoundedCdpStageWindows();
  for(let i=0;i<1000;i++)many.observe(i*10,i%2?'FETCH_REFUSED':'FETCH_RESET');
  assert.equal(many.summary(),'FETCH_RESET=t0..t9,FETCH_REFUSED=t0..t9');
  assert.ok(many.summary().length<200);
});

/** A bounded CI-only recovery for Chrome that has not even touched its
 * disposable test profile. Never retry PID, version, WebSocket or permission
 * failures, or a partially bootstrapped browser; each fresh attempt must still
 * pass the complete real-browser ownership and CDP assertions.
 */
function mayRetryUntouchedChromeBootstrap(
 result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>,
 markers:string,attempt:number,ci:boolean
):boolean {
 return ci&&attempt===0&&!result.ok&&result.code==='CDP_TIMEOUT'&&
   markers==='state=0 endpointMarker=0';
}
test('TEST-006/008/009: only an untouched Chrome bootstrap can receive one fresh CI attempt',()=>{
 const timeout={ok:false as const,code:'CDP_TIMEOUT' as const};
 assert.equal(mayRetryUntouchedChromeBootstrap(timeout,'state=0 endpointMarker=0',0,true),true);
 for(const [result,markers,attempt,ci] of [
  [timeout,'state=1 endpointMarker=0',0,true],
  [timeout,'state=0 endpointMarker=1',0,true],
  [timeout,'state=0 endpointMarker=0',1,true],
  [timeout,'state=0 endpointMarker=0',0,false],
  [{ok:false,code:'OWNER_MISMATCH'},'state=0 endpointMarker=0',0,true],
  [{ok:false,code:'WEBSOCKET_VERIFICATION_FAILED'},'state=0 endpointMarker=0',0,true]
 ] as const){
   assert.equal(mayRetryUntouchedChromeBootstrap(result,markers,attempt,ci),false);
 }
});

test('TEST-006: Chrome bootstrap diagnostics are bounded and content-blind',async t=>{
  const root=await mkdtemp(join(tmpdir(),'uah-bootstrap-evidence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  assert.equal(await redactedChromeBootstrapMarkers(root),
    'state=0 endpointMarker=0');
  await writeFile(join(root,'Local State'),'PRIVATE_PROFILE_CONTENT');
  await writeFile(join(root,'DevToolsActivePort'),'PRIVATE_ENDPOINT');
  const evidence=await redactedChromeBootstrapMarkers(root);
  assert.equal(evidence,'state=1 endpointMarker=1');
  assert.equal(evidence.includes(root),false);
  assert.equal(evidence.includes('PRIVATE_'),false);
});

/** An inaccessible disposable Profile marker is UNKNOWN, never "absent".
 * A native Windows EACCES/error during a read-only file check must not create
 * a false 'untouched' receipt and authorize another Chrome startup attempt.
 */
test('TASK-005/TEST-006/008/009/026: unreadable Chrome markers cannot authorize untouched retry',async t=>{
  const fs=require('node:fs/promises') as typeof import('node:fs/promises');
  const denied=()=>Object.assign(new Error('PRIVATE_WINDOWS_IO_ERROR'),{code:'EACCES'});
  try{
    t.mock.method(fs,'access',async()=>{throw denied();});
    t.mock.method(fs,'lstat',async()=>{throw denied();});
    const marker=await redactedChromeBootstrapMarkers('C:\\synthetic\\owned-profile');
    assert.equal(marker,'state=? endpointMarker=?',
      'permission error is unknown, not proof no Profile state exists');
    assert.equal(mayRetryUntouchedChromeBootstrap(
      {ok:false,code:'CDP_TIMEOUT'},marker,0,true),false,
      'no retry on an unknown or inaccessible marker');
    assert.equal(marker.includes('PRIVATE_'),false,
      'untrusted filesystem error text cannot appear in diagnostic output');
  }finally{t.mock.reset();}
});

test('TEST-007/008: never launch without approval or with bad config',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{userApproved:false}),
    {ok:false,code:'NOT_AUTHORIZED'});
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{userApproved:true}),
    {ok:false,code:process.platform==='win32'?'PREFLIGHT_FAILED':'PREFLIGHT_FAILED'});
});
/** A native user cancellation must take priority even when an awaited
 * read-only preflight or signed-binary inspection concurrently fails. All
 * fixtures are mocked; no Chrome, Profile or listener is touched.
 */
test('TASK-005/TEST-007/009/026: revocation wins over a failing asynchronous launch preflight',async t=>{
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12059);
  for(const phase of ['initial','binary','final'] as const){
    const consent=new AbortController();
    let checks=0,spawned=0;
    try{
      t.mock.method(launcher,'preflightChrome',async()=>{
        checks++;
        if(phase==='initial'||(phase==='final'&&checks===2)){
          consent.abort();
          return {ok:false as const,code:'PORT_PROBE_FAILED' as const};
        }
        return {ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
          config:cfg,runtimeIdentityVerified:false as const};
      });
      t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>{
        if(phase==='binary'){
          consent.abort();
          return {ok:false as const,code:'UNTRUSTED_BINARY' as const};
        }
        return {ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
          version:'155.0.1.1',publisher:'Google LLC' as const,
          runtimeVerified:false as const};
      });
      t.mock.method(cp,'spawn',()=>{
        spawned++;
        throw Error('Synthetic launch must never start after revoked consent');
      });
      const result=await launchApprovedIsolatedChrome(cfg,{
        userApproved:true,signal:consent.signal
      });
      assert.deepEqual(result,{ok:false,code:'ABORTED'},phase);
      assert.equal(consent.signal.aborted,true,phase);
      assert.equal(spawned,0,phase);
      assert.equal(checks,phase==='final'?2:1,phase);
    }finally{t.mock.reset();}
  }
});

/** A revoked approval must not wait for a hanging asynchronous path/port
 * check or Windows signature subprocess to settle. These tests mock every
 * I/O boundary; a real Chrome child, Profile or listener is never launched.
 */
test('TASK-005/TEST-007/009/026: revocation interrupts pending prelaunch checks before they settle',async t=>{
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12061);
  const validPreflight={ok:true as const,
    status:'PATH_AND_PORT_CHECKED_ONLY' as const,config:cfg,
    runtimeIdentityVerified:false as const};
  const validBinary={ok:true as const,
    status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
    version:'155.0.1.1',publisher:'Google LLC' as const,
    runtimeVerified:false as const};
  for(const phase of ['initial','binary','final'] as const){
    const consent=new AbortController();
    let announceEntered!:()=>void;
    let finishBlocked!:()=>void;
    const entered=new Promise<void>(resolve=>{announceEntered=resolve;});
    const blocked=new Promise<void>(resolve=>{finishBlocked=resolve;});
    let checks=0,spawned=0;
    try{
      t.mock.method(launcher,'preflightChrome',async()=>{
        checks++;
        if(phase==='initial'||(phase==='final'&&checks===2)){
          announceEntered();
          await blocked;
        }
        return validPreflight;
      });
      t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>{
        if(phase==='binary'){
          announceEntered();
          await blocked;
        }
        return validBinary;
      });
      t.mock.method(cp,'spawn',()=>{
        spawned++;
        throw Error('No Chrome spawn after revoked native launch approval');
      });
      const pending=launchApprovedIsolatedChrome(cfg,{
        userApproved:true,signal:consent.signal
      });
      await entered; // The target async stage is truly pending, not skipped.
      consent.abort();
      const early=await Promise.race([
        pending.then(value=>({settled:true as const,value})),
        delay(125).then(()=>({settled:false as const}))
      ]);
      finishBlocked();
      const finalResult=await pending;
      assert.equal(early.settled,true,
        phase+' must abort without awaiting the blocked prelaunch check');
      if(early.settled)assert.deepEqual(early.value,{ok:false,code:'ABORTED'});
      assert.deepEqual(finalResult,{ok:false,code:'ABORTED'});
      assert.equal(spawned,0,phase);
    }finally{
      finishBlocked();
      t.mock.reset();
    }
  }
});

/** Netstat can remain in its own 12s Windows subprocess while approval or
 * the owned child disappears. Neither event may wait for the PID probe.
 * All Chrome, filesystem, fetch and OS probes are synthetic (zero user I/O).
 */
test('TASK-005/TEST-006/007/009/026: pending native listener PID proof cannot delay revocation or owned-child exit',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned',12069);
  for(const phase of ['consent','child-exit'] as const){
    const controller=new AbortController();
    let enterProbe!:()=>void,completeProbe!:()=>void;
    const entered=new Promise<void>(resolve=>{enterProbe=resolve;});
    const blocked=new Promise<void>(resolve=>{completeProbe=resolve;});
    const child=Object.assign(new EventEmitter(),{
      pid:41269,exitCode:null as number|null,killed:false,
      signalCode:null as string|null,
      kill(){this.killed=true;return true;}
    });
    let websocketProofs=0;
    try{
      t.mock.method(launcher,'preflightChrome',async()=>({
        ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
        config:cfg,runtimeIdentityVerified:false as const
      }));
      t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
        ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
        version:'155.0.1.1',publisher:'Google LLC' as const,
        runtimeVerified:false as const
      }));
      t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
      t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>{
        enterProbe();
        await blocked;
        return {ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
          pid:41269,executableVerified:false as const};
      });
      t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
        websocketProofs++;
        return true;
      });
      t.mock.method(globalThis,'fetch',async()=>
        new Response(JSON.stringify({
          Browser:'Chrome/155.0.1.1',
          webSocketDebuggerUrl:'ws://127.0.0.1:12069/devtools/browser/abcdefgh-1234'
        }))
      );
      const pending=launchApprovedIsolatedChrome(cfg,{
        userApproved:true,signal:controller.signal
      });
      await entered;
      if(phase==='consent')controller.abort();
      else{
        child.exitCode=1;
        child.emit('exit',1,null);
      }
      const early=await Promise.race([
        pending.then(value=>({settled:true as const,value})),
        delay(160).then(()=>({settled:false as const}))
      ]);
      completeProbe();
      const result=await pending;
      const expected={ok:false,code:phase==='consent'?'ABORTED':'LAUNCH_FAILED'};
      assert.equal(early.settled,true,
        phase+' must finish before the blocked native netstat proof resolves');
      if(early.settled)assert.deepEqual(early.value,expected);
      assert.deepEqual(result,expected);
      assert.equal(websocketProofs,0,'cancelled owner check must never open CDP WebSocket');
      assert.equal(isLiveApprovedChromeSession(result),false);
      if(phase==='consent')assert.equal(child.killed,true,
        'only the synthetic owned child must be retired on revoked consent');
    }finally{
      completeProbe();
      t.mock.reset();
    }
  }
});

test('TASK-005/TEST-006/007/009/026: Chrome launch consent options never evaluate accessors or Proxy traps',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  type Options=Parameters<typeof launchApprovedIsolatedChrome>[1];
  let accessors=0,proxyTraps=0;
  const consentGetter=Object.defineProperty({},'userApproved',{
    enumerable:true,get(){accessors++;return true;}
  });
  const inheritedConsent=Object.create({userApproved:true}) as unknown;
  const signalGetter=Object.defineProperty({userApproved:true},'signal',{
    enumerable:true,get(){accessors++;throw Error('PRIVATE_CALLBACK_RAN');}
  });
  const callbackGetter=Object.defineProperty({userApproved:true},'onStartupStage',{
    enumerable:true,get(){accessors++;return ()=>{};}
  });
  const proxy=new Proxy({userApproved:true},{
    get(){proxyTraps++;return true;},
    ownKeys(){proxyTraps++;return ['userApproved'];},
    getOwnPropertyDescriptor(){proxyTraps++;throw Error('PRIVATE_PROXY_RAN');}
  });
  const revoked=Proxy.revocable({userApproved:true},{});
  revoked.revoke();
  for(const candidate of [consentGetter,inheritedConsent,signalGetter,
      callbackGetter,proxy,revoked.proxy]){
    assert.deepEqual(await launchApprovedIsolatedChrome(impossible,candidate as Options),
      {ok:false,code:'NOT_AUTHORIZED'},
      'untrusted launch options must fail before Chrome preflight or any side effects');
  }
  assert.equal(accessors,0,'consent parsing must never invoke an accessor');
  assert.equal(proxyTraps,0,'consent parsing must never invoke Proxy traps');
});

test('TASK-005/TEST-007/009: malformed launch signal cannot impersonate an AbortSignal',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  type Options=Parameters<typeof launchApprovedIsolatedChrome>[1];
  let abortedReads=0;
  const signal=Object.defineProperty({},'aborted',{
    get(){abortedReads++;return false;}
  });
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{
    userApproved:true,signal
  } as unknown as Options),{ok:false,code:'NOT_AUTHORIZED'});
  assert.equal(abortedReads,0);
  const controller=new AbortController();
  controller.abort();
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{
    userApproved:true,signal:controller.signal
  }),{ok:false,code:'ABORTED'},
    'a genuinely aborted native signal must retain its cancellation semantics');
});

test('TEST-006: executable masquerading as Chrome cannot be launched',async t=>{
  if(process.platform!=='win32')return;
  const root=await mkdtemp(join(tmpdir(),'uah-fake-executable-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=join(root,'chrome.exe'),profile=join(root,'profile');
  await writeFile(executable,'not a signed browser');
  await mkdir(profile);
  const port=await unusedLoopbackPort();
  assert.deepEqual(await launchApprovedIsolatedChrome(config(executable,profile,port),
    {userApproved:true}),{ok:false,code:'BINARY_NOT_VERIFIED'});
});
/** Fixed-label, capped target lifecycle receipt for intermittent TEST-013
 * navigation failures. No URL, target ID, tab content or native error text.
 * This is CI diagnostics only: it cannot authorize or retry a target.
 */
function createBoundedTargetNavigationStageCounts(){
 const permitted=new Set<TargetNavigationStage>([
  'TAB_CREATED','TAB_CREATION_FAILED',
  'LIST_TRANSPORT_FAILED','LIST_INVALID','LIST_NOT_MATCHED',
  'TARGET_ID_MISMATCH','MAIN_FRAME_PENDING','MAIN_FRAME_CONFIRMED',
  'MAIN_FRAME_ABOUT_BLANK','MAIN_FRAME_MISSING_URL',
  'MAIN_FRAME_INVALID_URL','MAIN_FRAME_URL_MISMATCH',
  'MAIN_FRAME_CDP_REJECTED','MAIN_FRAME_RESPONSE_INVALID',
  'MAIN_FRAME_SOCKET_PENDING','MAIN_FRAME_RECEIPT_PENDING',
  'MAIN_FRAME_TRANSPORT_FAILED','UNVERIFIED_TAB_CLOSED',
  'UNVERIFIED_TAB_CLEANUP_UNCONFIRMED'
 ]);
 const counts:Partial<Record<TargetNavigationStage,number>>=Object.create(null);
 return {
  observe(stage:unknown):void{
   if(typeof stage!=='string'||!permitted.has(stage as TargetNavigationStage))return;
   const key=stage as TargetNavigationStage;
   counts[key]=Math.min(99,(counts[key]??0)+1);
  },
  summary():string{return JSON.stringify(counts);}
 };
}

test('TASK-008/TEST-013: target stage diagnostics only emit capped fixed labels',()=>{
 const stages=createBoundedTargetNavigationStageCounts();
 stages.observe('TAB_CREATED');
 for(let i=0;i<150;i++)stages.observe('MAIN_FRAME_SOCKET_PENDING');
 for(const unsafe of ['PRIVATE_URL=https://secret.invalid/','LIST_TRANSPORT_FAILED:12345',
   {toString(){throw Error('LEAK');}},null,undefined]){
  stages.observe(unsafe);
 }
 assert.equal(stages.summary(),
  '{"TAB_CREATED":1,"MAIN_FRAME_SOCKET_PENDING":99}');
 assert.equal(stages.summary().includes('secret.invalid'),false);
 assert.equal(stages.summary().includes('12345'),false);
});

/** Issue #480: a missing main-frame URL could be caused by a page that
 * never reached its disposable HTTP fixture, or by a frame receipt lagging
 * behind a served page. Report only YES/NO on target-confirmation failure.
 * This is diagnostic evidence, never proof of page, GM or script readiness.
 */
function createBoundedOwnedFixtureServeCounter(){
 let served=0;
 return {
  observe(method:unknown,route:unknown):void{
   if(method==='GET'&&route==='/')served=Math.min(128,served+1);
  },
  summary():string{return served>0?'YES':'NO';}
 };
}

test('TASK-008/TEST-013: owned Chrome target fixture diagnostics remain bounded and failure-only',()=>{
 const source=readFileSync(join(process.cwd(),'tests/browser/owned-chrome.test.ts'),'utf8');
 assert.match(source,/function createBoundedOwnedFixtureServeCounter\(\)/);
 // Search ONLY the real Windows fixture test, not this test's own quoted
 // source snippets (which appear earlier in the same test file).
 const fixtureStart=source.lastIndexOf(
  "test('TEST-006/008/009: isolated signed Chrome presents owned CDP HTTP only'"
 );
 assert.ok(fixtureStart>=0);
 const diagnostic=source.slice(
  source.indexOf("const target=await openApprovedTarget(result,site,true,undefined,",fixtureStart),
  source.indexOf("assert.equal(target.ok,true,JSON.stringify(target));",fixtureStart)
 );
 assert.match(diagnostic,/if\(!target.ok\)\s*\{/);
 assert.match(diagnostic,/CDP_TARGET_NAV_STAGE_COUNTS/);
 assert.match(diagnostic,/CDP_FIXTURE_PAGE_SERVED/);
 const tracker=createBoundedOwnedFixtureServeCounter();
 assert.equal(tracker.summary(),'NO');
 tracker.observe('GET','/robots.txt');
 tracker.observe('POST','/');
 tracker.observe('GET','/?private=should-not-log');
 assert.equal(tracker.summary(),'NO');
 for(let i=0;i<150;i++)tracker.observe('GET','/');
 assert.equal(tracker.summary(),'YES');
 assert.ok(!tracker.summary().includes('private'));
});

test('TEST-006/008/009: isolated signed Chrome presents owned CDP HTTP only',async t=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'){
    t.skip('Dedicated signed Chrome Windows Actions only');return;
  }
  let chrome:string|undefined;
  for(const base of [process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]) {
    if(!base)continue;
    const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try{await access(candidate);chrome=candidate;break;}catch{ /* other location */ }
  }
  if(!chrome){t.skip('No official Chrome binary on runner');return;}
  // The manual CI logging mode confines this test-owned Profile to RUNNER_TEMP.
  // Other Windows CI runs retain their existing temporary test path.
  const ciLogRoot=process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&
    process.env.UAH_TEST_CHROME_BOOT_LOG==='true'&&process.env.RUNNER_TEMP;
  const root=await mkdtemp(join(ciLogRoot||tmpdir(),'uah-owned-chrome-test-'));
  let profile=join(root,'profile');
  let stop:()=>void=()=>{};
  let unexpectedExits=0;
  t.after(async()=>{
    stop();
    await delay(800);
    await rm(root,{recursive:true,force:true}).catch(()=>undefined);
  });
  let port=await unusedLoopbackPort();
  let configForTest=config(chrome,profile,port);
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,false),
    {ok:false,code:'NOT_AUTHORIZED'});
  const prepared=await prepareApprovedIsolatedProfile(configForTest,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,true),
    {ok:false,code:'PROFILE_EXISTS'});
  const startupStages:string[]=[];
  let startupStageWindows=createBoundedCdpStageWindows();
  let launchBegan=0;
  // Pass through a variable so TS can compile this behavioural regression
  // against the old implementation, before the new optional hook exists.
  const launchOptions={userApproved:true,testHeadless:true,
    onUnexpectedExit:()=>{unexpectedExits++;},
    onStartupStage:(stage:string)=>{
      startupStages.push(stage);
      startupStageWindows.observe(performance.now()-launchBegan,stage);
    }};
  // This is TEST-ONLY observation of the independently owned disposable
  // directory: polling never edits Chrome, changes the launch deadline, reads
  // marker contents, queries the user profile or retries a touched browser.
  let timeline=createBoundedChromeBootstrapTimeline();
  let listenerTimeline=createBoundedListenerPresenceTimeline();
  const launchWithBoundedMarkers=async()=>{
    const pressure=beginBoundedCiChromeCpuPressure();
    if(pressure.workers)t.diagnostic('CDP_CI_CPU_PRESSURE=2_WORKERS_MAX_8S');
    const started=performance.now();
    launchBegan=started;
    let sampling=false,latestListenerSampleMs=-Infinity;
    const poll=async()=>{
      if(sampling)return;
      sampling=true;
      try{
        const elapsed=performance.now()-started;
        timeline.observe(elapsed,await redactedChromeBootstrapMarkers(profile));
        // Sampling once per ~2.5 s avoids competing with Chrome startup.
        // Only the binary 0/1/? result survives the native OS query.
        if(elapsed-latestListenerSampleMs>=2500){
          latestListenerSampleMs=elapsed;
          listenerTimeline.observe(elapsed,
            await readTestOnlyLocalListenerPresence(port));
        }
      }finally{sampling=false;}
    };
    await poll();
    const interval=setInterval(()=>{void poll();},750);
    try{return await launchApprovedIsolatedChrome(configForTest,launchOptions);}
    finally{
      pressure.stop();
      clearInterval(interval);
      if(pressure.workers)t.diagnostic('CDP_CI_CPU_PRESSURE_LISTENER_TIMELINE='+listenerTimeline.summary());
      timeline.observe(performance.now()-started,
        await redactedChromeBootstrapMarkers(profile));
    }
  };
  let result=await launchWithBoundedMarkers();
  if(!result.ok){
    const markers=await redactedChromeBootstrapMarkers(profile);
    if(mayRetryUntouchedChromeBootstrap(result,markers,0,
        process.env.GITHUB_ACTIONS==='true')){
      t.diagnostic('CDP_FIRST_BOOTSTRAP_UNTOUCHED_RETRY_ONCE');
      // Never reuse or overwrite the first test profile, even on failure.
      profile=join(root,'retry-profile');
      port=await unusedLoopbackPort();
      configForTest=config(chrome,profile,port);
      const secondPrepared=await prepareApprovedIsolatedProfile(configForTest,true);
      assert.equal(secondPrepared.ok,true,JSON.stringify(secondPrepared));
      startupStages.length=0;
      startupStageWindows=createBoundedCdpStageWindows();
      timeline=createBoundedChromeBootstrapTimeline();
      listenerTimeline=createBoundedListenerPresenceTimeline();
      result=await launchWithBoundedMarkers();
    }
  }
  // Print only fixed stage labels and their counts on failure: no Chrome PID,
  // profile path, port, endpoint URL, version or returned response body.
  if(!result.ok){
    const counts:Record<string,number>={};
    for(const stage of startupStages)counts[stage]=(counts[stage]??0)+1;
    t.diagnostic('CDP_STARTUP_STAGE_COUNTS='+JSON.stringify(counts));
    t.diagnostic('CDP_STARTUP_STAGE_WINDOWS='+startupStageWindows.summary());
    t.diagnostic('CDP_BOOTSTRAP_MARKERS='+await redactedChromeBootstrapMarkers(profile));
    t.diagnostic('CDP_BOOTSTRAP_TIMELINE='+timeline.summary());
    t.diagnostic('CDP_LISTENER_PRESENCE_TIMELINE='+listenerTimeline.summary());
    // 1 means *some* IPv4 loopback listener was seen, NOT verified ownership.
  }
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.ok(startupStages.includes('CHROME_SPAWN_RETURNED'),
    'Chrome spawn-return boundary must be emitted before CDP transport probing');
  // The prelaunch portion of the following timing starts before native binary
  // verification, whereas Chrome's 20-second CDP budget starts after spawn.
  t.diagnostic('CDP_SUCCESS_STAGE_WINDOWS='+startupStageWindows.summary());
  // Chrome uses an explicit nonzero CDP port here. Chromium writes
  // DevToolsActivePort for an OS-assigned port (0); absence with this
  // fixed-port successful control is NOT evidence of a missing listener.
  // See chromium/src/chrome/browser/devtools/remote_debugging_server.cc.
  // Record only disposable-profile marker presence, never its contents.
  t.diagnostic('CDP_FIXED_PORT_SUCCESS_MARKERS='+
    await redactedChromeBootstrapMarkers(profile));
  const allowed=new Set(['CHROME_SPAWN_RETURNED','FETCH_FAILED','FETCH_REFUSED','FETCH_TIMEOUT',
    'FETCH_RESET','HTTP_REJECTED','BODY_REJECTED',
    'CDP_VERSION_REJECTED','CDP_VERSION_PARSED','CHILD_RUNNING_NO_CDP',
    'CDP_PID_PROOF_STARTED','CDP_PID_PROOF_VERIFIED','CDP_PID_PROOF_REJECTED',
    'CDP_WS_PROOF_STARTED','CDP_WS_PROOF_VERIFIED','CDP_WS_PROOF_REJECTED',
    'CDP_POST_VERSION_DEADLINE']);
  assert.ok(startupStages.every(stage=>allowed.has(stage)),
    'diagnostic stages must only use fixed redacted labels');
  assert.ok(startupStages.length<=100,'startup diagnostics must be bounded');
  assert.ok(startupStages.includes('CDP_VERSION_PARSED'),
    'a successful Chrome launch must report the parsed CDP version stage');
  assert.ok(startupStages.includes('CDP_PID_PROOF_VERIFIED'),
    'successful Chrome launch must confirm the native listener PID proof');
  assert.ok(startupStages.includes('CDP_WS_PROOF_VERIFIED'),
    'successful Chrome launch must confirm its browser WebSocket proof');
  if(result.ok) {
    stop=result.stop;
    assert.equal(result.status,'OWNED_CDP_BROWSER_VERIFIED');
    assert.equal(result.websocketHandshakeVerified,true);
    assert.equal(result.targetVerified,false);
    assert.equal(isLiveApprovedChromeSession(result),true);
    assert.ok(Object.isFrozen(result));
    assert.ok(result.pid>0);
    assert.match(result.chromeVersion,/^\d+\.\d+\.\d+\.\d+$/);
    const fixtureServed=createBoundedOwnedFixtureServeCounter();
    const fixture=createServer((req,res)=>{
      fixtureServed.observe(req.method,req.url);
      res.writeHead(200,{'Content-Type':'text/html'});
      res.end('<!doctype html><title>Approved local test</title><main id="approved-ready">ok</main>');
    });
    await new Promise<void>((resolve,reject)=>{
      fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);
    });
    t.after(()=>new Promise<void>(resolve=>fixture.close(()=>resolve())));
    const address=fixture.address();
    if(!address||typeof address==='string')throw Error('MISSING_LOCAL_FIXTURE');
    const site='http://127.0.0.1:'+address.port+'/';
    // TASK-008 / TEST-013/026: consent can expire while the initial native
    // Windows listener/PID proof is still pending. No target creation or
    // script action may follow a revoked pre-navigation capability.
    const ownerModule=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
    const realOwnerProof=ownerModule.verifyWindowsLoopbackListenerPid;
    const revokedConsent=new AbortController();
    let ownerEntered!:()=>void;
    const ownerPending=new Promise<void>(resolve=>{ownerEntered=resolve;});
    let releaseOwner!:()=>void;
    const parkedOwner=new Promise<void>(resolve=>{releaseOwner=resolve;});
    let parkedCalls=0;
    (ownerModule as {verifyWindowsLoopbackListenerPid:typeof realOwnerProof})
      .verifyWindowsLoopbackListenerPid=async(...args)=>{
        parkedCalls++;ownerEntered();
        await parkedOwner;
        return realOwnerProof(...args);
      };
    const revokedStages:TargetNavigationStage[]=[];
    try{
      const pending= openApprovedTarget(result,site,true,revokedConsent.signal,
        stage=>revokedStages.push(stage));
      await Promise.race([ownerPending,delay(5000).then(()=>{
        throw Error('INITIAL_OWNER_PROOF_NOT_REACHED');
      })]);
      revokedConsent.abort();
      const observed=await Promise.race([pending,delay(700).then(()=>({
        ok:false as const,code:'CANCELLATION_STALLED' as const
      }))]);
      assert.deepEqual(observed,{ok:false,code:'CANCELLED'},
        'revocation must not wait for the initial read-only Windows PID query');
      assert.equal(parkedCalls,1);
      assert.deepEqual(revokedStages,[],
        'no newly created target or navigation stage is permitted after cancellation');
    }finally{
      releaseOwner();
      (ownerModule as {verifyWindowsLoopbackListenerPid:typeof realOwnerProof})
        .verifyWindowsLoopbackListenerPid=realOwnerProof;
    }
    assert.deepEqual(await openApprovedTarget(result,site,false),
      {ok:false,code:'NOT_AUTHORIZED'});
    const targetStages=createBoundedTargetNavigationStageCounts();
    const target=await openApprovedTarget(result,site,true,undefined,
      stage=>targetStages.observe(stage));
    if(!target.ok){
      t.diagnostic('CDP_TARGET_NAV_STAGE_COUNTS='+targetStages.summary());
      t.diagnostic('CDP_FIXTURE_PAGE_SERVED='+fixtureServed.summary());
    }
    assert.equal(target.ok,true,JSON.stringify(target));
    assert.ok(targetStages.summary().includes('"TAB_CREATED":1'),
      'owned target creation must have a fixed diagnostic stage');
    assert.ok(targetStages.summary().includes('"MAIN_FRAME_CONFIRMED":1'),
      'successful target must confirm the main frame without retrying navigation');
    if(target.ok){
      assert.equal(target.status,'TARGET_ID_AND_URL_MATCH_ONLY');
      assert.equal(target.businessVerified,false);
      // TEST-009/010: opening a target must wait for its own Page frame to
      // leave about:blank; DOM read must not need an app-side navigation retry.
      const observed=await observeApprovedDom(result,target,site,true,['#approved-ready']);
      assert.equal(observed.ok,true,JSON.stringify(observed));
      if(observed.ok){
        assert.equal(observed.selectorCounts['#approved-ready'],1);
        assert.equal(observed.fullPageVerified,false);
        assert.equal(observed.userscriptVerified,false);
      }
    }
    // TEST-010/017/026: consent revoked while a legitimate CDP /json/list
    // fetch is pending must terminate promptly. This intentionally injects
    // only a stalled read-only transport, not a forged Chrome endpoint.
    const realFetch=globalThis.fetch;
    const controller=new AbortController();
    let markRequest:()=>void=()=>{};
    const requestStarted=new Promise<void>(resolve=>{markRequest=resolve;});
    let observedFetch=false;
    globalThis.fetch=(input,init)=>{
      if(typeof input==='string'&&input===
          'http://127.0.0.1:'+port+'/json/list'){
        observedFetch=true;markRequest();
        return new Promise<Response>((_resolve,reject)=>{
          const onAbort=()=>reject(new DOMException('ABORTED','AbortError'));
          init?.signal?.addEventListener('abort',onAbort,{once:true});
          if(init?.signal?.aborted)onAbort();
        });
      }
      return realFetch(input,init);
    };
    try{
      const pending=observeApprovedDom(result,target,site,true,
        ['#approved-ready'],controller.signal);
      await Promise.race([requestStarted,delay(5000).then(()=>{
        throw Error('OWNED_LISTENER_NOT_READY_FOR_REVOCATION_TEST');
      })]);
      assert.equal(observedFetch,true);
      controller.abort();
      const decision=await Promise.race([
        pending,
        delay(450).then(()=>({ok:false as const,code:'CANCELLATION_STALLED' as const}))
      ]);
      assert.deepEqual(decision,{ok:false,code:'CANCELLED'},
        'revoking DOM authorization must abort in-flight /json/list immediately');
    }finally{
      globalThis.fetch=realFetch;
      controller.abort();
    }
    // TEST-009/026: the final asynchronous port/PID check may finish after
    // the application has stopped its OWN isolated Chrome. A previous PID
    // match must not turn the now-dead browser session into a verified tab.
    const listenerModule=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
    const verifyOriginal=listenerModule.verifyWindowsLoopbackListenerPid;
    let verificationCalls=0;
    (listenerModule as {verifyWindowsLoopbackListenerPid:typeof verifyOriginal})
      .verifyWindowsLoopbackListenerPid=async(...args)=>{
        const receipt=await verifyOriginal(...args);
        verificationCalls++;
        if(verificationCalls===2){
          assert.equal(receipt.ok,true,'the disposable browser owned the listener');
          result.stop();
        }
        return receipt;
      };
    try{
      const stale=await openApprovedTarget(result,site,true);
      assert.equal(verificationCalls,2,'stop must happen during final PID check');
      assert.deepEqual(stale,{ok:false,code:'UNVERIFIED_BROWSER'},
        'a stopped owned Chrome cannot return a verified new tab');
    }finally{
      (listenerModule as {verifyWindowsLoopbackListenerPid:typeof verifyOriginal})
        .verifyWindowsLoopbackListenerPid=verifyOriginal;
    }
    stop();
    assert.equal(isLiveApprovedChromeSession(result),false);
    await delay(350);
    assert.equal(unexpectedExits,0,'Intentional stop must not invoke unexpected-exit cleanup');
    assert.deepEqual(await openApprovedTarget(result,site,true),
      {ok:false,code:'UNVERIFIED_BROWSER'});
  }
});


/** The existing early port preflight can pass before the expensive trusted
 * Windows Authenticode inspection. Bind ONLY a disposable test listener after
 * that authentic inspection but before Chrome spawn, and prove the launcher
 * must reject the changed external port without touching its owned Profile.
 * This reproduces one plausible real Chrome child-running/no-CDP mechanism,
 * not the root cause of the historical intermittent #510 failure.
 */
test('TASK-005/TEST-006/009: port claimed during signed Chrome inspection fails before launch',async t=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'){
    t.skip('Dedicated signed Chrome Windows Actions only');return;
  }
  let chrome:string|undefined;
  for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA]){
    if(!base)continue;
    const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try{await access(candidate);chrome=candidate;break;}catch{}
  }
  if(!chrome){t.skip('No official Chrome binary on runner');return;}
  const root=await mkdtemp(join(tmpdir(),'uah-chrome-port-race-'));
  const profile=join(root,'profile');
  const port=await unusedLoopbackPort();
  const cfg=config(chrome,profile,port);
  const ready=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  const blocker=createServer((_req,res)=>{res.writeHead(503);res.end();});
  const launcher=require('../../src/browser/chrome-launcher') as typeof import('../../src/browser/chrome-launcher');
  const inspectOriginal=launcher.inspectWindowsChromeBinary;
  let portClaimed=false;
  (launcher as {inspectWindowsChromeBinary:typeof inspectOriginal})
    .inspectWindowsChromeBinary=async (...args)=>{
      const signed=await inspectOriginal(...args);
      if(signed.ok){
        await new Promise<void>((resolve,reject)=>{
          blocker.once('error',reject);
          blocker.listen(port,'127.0.0.1',resolve);
        });
        portClaimed=true;
      }
      return signed;
    };
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),3000);
  try{
    const outcome=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,testHeadless:true,signal:abort.signal});
    assert.equal(portClaimed,true,'the port was genuinely claimed after Authenticode');
    assert.deepEqual(outcome,{ok:false,code:'PREFLIGHT_FAILED'},
      'a port claimed after initial preflight must fail closed before spawning Chrome');
    assert.equal(await redactedChromeBootstrapMarkers(profile),
      'state=0 endpointMarker=0',
      'prelaunch port-claim rejection must not bootstrap or mutate this disposable Profile');
  }finally{
    clearTimeout(timeout);
    abort.abort();
    (launcher as {inspectWindowsChromeBinary:typeof inspectOriginal})
      .inspectWindowsChromeBinary=inspectOriginal;
    if(blocker.listening)
      await new Promise<void>(resolve=>blocker.close(()=>resolve()));
    await rm(root,{recursive:true,force:true}).catch(()=>undefined);
  }
});

test('TASK-007/TEST-017: unexpected exit of a verified owned Chrome notifies its owner exactly once',async t=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'){
    t.skip('Dedicated signed Chrome Windows Actions only');return;
  }
  let chrome:string|undefined;
  for(const base of [process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
    if(!base)continue;
    const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try{await access(candidate);chrome=candidate;break;}catch{/* unavailable */}
  }
  if(!chrome){t.skip('No official Chrome binary on runner');return;}
  const root=await mkdtemp(join(tmpdir(),'uah-chrome-exit-test-'));
  let profile=join(root,'profile');
  let port=await unusedLoopbackPort();
  let cfg=config(chrome,profile,port);
  t.after(async()=>{await delay(800);await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
  const ready=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  let notifications=0;
  const exitStartupStages:string[]=[];
  const launchOptions={
    userApproved:true,testHeadless:true,
    onUnexpectedExit:()=>{notifications++;},
    onStartupStage:(stage:string)=>{exitStartupStages.push(stage);}
  };
  let browser=await launchApprovedIsolatedChrome(cfg,launchOptions);
  if(!browser.ok){
    const markers=await redactedChromeBootstrapMarkers(profile);
    if(mayRetryUntouchedChromeBootstrap(browser,markers,0,
        process.env.GITHUB_ACTIONS==='true')){
      t.diagnostic('CDP_EXIT_FIRST_BOOTSTRAP_UNTOUCHED_RETRY_ONCE');
      profile=join(root,'retry-profile');
      port=await unusedLoopbackPort();
      cfg=config(chrome,profile,port);
      const retryReady=await prepareApprovedIsolatedProfile(cfg,true);
      assert.equal(retryReady.ok,true,JSON.stringify(retryReady));
      exitStartupStages.length=0;
      browser=await launchApprovedIsolatedChrome(cfg,launchOptions);
    }
  }
  if(!browser.ok){
    const counts:Record<string,number>={};
    for(const stage of exitStartupStages)counts[stage]=(counts[stage]??0)+1;
    t.diagnostic('CDP_EXIT_TEST_STARTUP_STAGES='+JSON.stringify(counts));
    t.diagnostic('CDP_EXIT_TEST_BOOTSTRAP_MARKERS='+await redactedChromeBootstrapMarkers(profile));
  }
  assert.equal(browser.ok,true,JSON.stringify(browser));
  if(!browser.ok)return;
  t.after(()=>browser.stop());
  assert.equal(isLiveApprovedChromeSession(browser),true);
  // This PID belongs to the new test-only Chrome child, not an existing user browser.
  process.kill(browser.pid);
  for(let i=0;i<30&&notifications===0;i++)await delay(100);
  assert.equal(notifications,1,'Unexpected browser termination must revoke dependent fixture consent');
  assert.equal(isLiveApprovedChromeSession(browser),false);
  await delay(150);
  assert.equal(notifications,1,'Exit and error events must not double-notify');
});

import { verifyCdpBrowserWebSocket } from '../../src/browser/cdp-session';
test('TEST-009: WebSocket handshake never connects to foreign origins',async()=>{
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://outside.example:9223/devtools/browser/aabbccdd',9223,'155.0.1.1'),false);
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://127.0.0.1:9223/devtools/browser/aabbccdd',9223,'not-a-version'),false);
});

test('TEST-009: CDP response enforces actual streamed byte limit without Content-Length',async()=>{
  const valid=new Response(JSON.stringify({Browser:'Chrome/155.0.1.1'}));
  assert.deepEqual(await readBoundedCdpJson(valid),{Browser:'Chrome/155.0.1.1'});
  const oversized=new Response(new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new Uint8Array(17000));controller.close();}
  }),{status:200});
  assert.equal(await readBoundedCdpJson(oversized),null);
  assert.equal(await readBoundedCdpJson(new Response('{}',{
    headers:{'content-length':'17000'}})),null);
  assert.equal(await readBoundedCdpJson(new Response('{}',{status:403})),null);
});

test('TASK-008/TEST-009/026: target list responses larger than default 16 KiB succeed with MAX_CDP_TARGET_LIST_BYTES',async()=>{
  const rows=Array.from({length:50},(_,i)=>({
    description:'',
    devtoolsFrontendUrl:`/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/target_${i}_`+'a'.repeat(32),
    id:`target_${i}_`+'a'.repeat(32),
    title:`Page ${i} with long informative title describing browser content`,
    type:'page',
    url:`http://127.0.0.1:9222/deeply/nested/path/to/page_${i}?query=parameter&token=sample_value_`+'b'.repeat(64),
    webSocketDebuggerUrl:`ws://127.0.0.1:9222/devtools/page/target_${i}_`+'a'.repeat(32)
  }));
  const payload=JSON.stringify(rows);
  const bytes=new TextEncoder().encode(payload).byteLength;
  assert.ok(bytes > DEFAULT_CDP_JSON_LIMIT_BYTES, 'test payload must exceed default 16 KiB limit: '+bytes);
  assert.equal(await readBoundedCdpJson(new Response(payload)), null,
    'default call must reject oversized payload');
  const parsed=await readBoundedCdpJson(new Response(payload), undefined, MAX_CDP_TARGET_LIST_BYTES);
  assert.equal(Array.isArray(parsed), true, 'must parse valid payload under list limit');
  assert.equal((parsed as unknown[]).length, 50);
  const hugeStream=new Response(new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new Uint8Array(MAX_CDP_TARGET_LIST_BYTES+100));controller.close();}
  }),{status:200});
  assert.equal(await readBoundedCdpJson(hugeStream, undefined, MAX_CDP_TARGET_LIST_BYTES), null,
    'payloads exceeding MAX_CDP_TARGET_LIST_BYTES must still fail closed');
});

test('TASK-005/TEST-009/026: declared CDP response length must match actual streamed bytes',async()=>{
  // Fetch normally checks the HTTP framing, but this exported response parser
  // is also a standalone security boundary. A truncated yet valid JSON body
  // must not be accepted as an owned Chrome/CDP structural receipt.
  const payload=JSON.stringify({Browser:'Chrome/155.0.1.1'});
  const byteLength=new TextEncoder().encode(payload).byteLength;
  assert.deepEqual(await readBoundedCdpJson(new Response(payload,{
    headers:{'content-length':String(byteLength)}})),
    {Browser:'Chrome/155.0.1.1'},'well-formed exact-length receipt remains valid');
  for(const declared of [byteLength+1,byteLength-1,0]){
    assert.equal(await readBoundedCdpJson(new Response(payload,{
      headers:{'content-length':String(declared)}})),null,
      'mismatched Content-Length must fail closed: '+declared);
  }
  const bytes=new TextEncoder().encode(payload);
  const split=new Response(new ReadableStream<Uint8Array>({
    start(controller){
      controller.enqueue(bytes.subarray(0,7));
      controller.enqueue(bytes.subarray(7));
      controller.close();
    }
  }),{headers:{'content-length':String(byteLength)}});
  assert.deepEqual(await readBoundedCdpJson(split),
    {Browser:'Chrome/155.0.1.1'},'split valid bytes preserve exact-length acceptance');
});

test('TEST-009/026: oversized CDP body cannot be held hostage by a pending stream cancellation',async()=>{
 let cancelCalled=false;
 // An untrusted HTTP body may never finish cancellation. Size rejection must
 // return promptly instead of awaiting an unbounded external cleanup promise.
 const stream=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(17000));},
  cancel(){cancelCalled=true;return new Promise<void>(()=>{});}
 });
 let timeout:NodeJS.Timeout|undefined;
 try{
  const outcome=await Promise.race([
   readBoundedCdpJson(new Response(stream)),
   new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(Error('CDP_STREAM_CANCEL_STALLED')),1000);
   })
  ]);
  assert.equal(outcome,null);
  assert.equal(cancelCalled,true,'oversized response still requests body cancellation');
 }finally{if(timeout)clearTimeout(timeout);}
});

test('TEST-009/026: rejected CDP HTTP/status headers close untrusted response streams without waiting',async()=>{
 for(const reason of ['http-error','oversized-header','invalid-header'] as const){
  let cancelCalls=0;
  const stream=new ReadableStream<Uint8Array>({
   start(controller){controller.enqueue(new TextEncoder().encode('{}'));},
   cancel(){cancelCalls++;return new Promise<void>(()=>{});}
  });
  const options=reason==='http-error'?{status:503}:reason==='oversized-header'
   ?{headers:{'content-length':'17000'}}:{headers:{'content-length':'invalid'}};
  const response=new Response(stream,options);
  let timer:NodeJS.Timeout|undefined;
  try{
   const outcome=await Promise.race([
    readBoundedCdpJson(response),
    new Promise<never>((_resolve,reject)=>{
     timer=setTimeout(()=>reject(Error('CDP_EARLY_REJECTION_STALLED_'+reason)),1000);
    })
   ]);
   assert.equal(outcome,null,reason);
   assert.equal(cancelCalls,1,'Rejected '+reason+' response must release its unread body');
  }finally{if(timer)clearTimeout(timer);}
 }
});

test('TASK-005/TEST-006/009/026: CDP body that stops after headers is bounded and denied',async()=>{
 // A 200 response and one partial byte chunk can arrive before an untrusted
 // stream stalls permanently. Neither a stalled read nor its unresponsive
 // cancel hook may keep the owned-Chrome startup alive without a bound.
 let cancelCalls=0;
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('{"Browser":"Chrome/'));},
  pull(){return new Promise<void>(()=>{});},
  cancel(){cancelCalls++;return new Promise<void>(()=>{});}
 });
 let timer:NodeJS.Timeout|undefined;
 try{
  const result=await Promise.race([
   readBoundedCdpJson(new Response(body,{status:200})),
   new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('CDP_PARTIAL_BODY_UNBOUNDED')),2400);
   })
  ]);
  assert.equal(result,null,'partial stalled CDP JSON must never be trusted');
  assert.equal(cancelCalls,1,'timed-out CDP stream must request nonblocking cleanup');
 }finally{if(timer)clearTimeout(timer);}
});

test('TEST-009: CDP JSON accepts split chunks but rejects malformed UTF-8',async()=>{
  const encoded=new TextEncoder().encode('{"Browser":"Chrome/155.0.1.1"}');
  const split=new Response(new ReadableStream<Uint8Array>({
    start(controller){
      controller.enqueue(encoded.subarray(0,12));
      controller.enqueue(encoded.subarray(12));
      controller.close();
    }
  }));
  assert.deepEqual(await readBoundedCdpJson(split),{Browser:'Chrome/155.0.1.1'});
  assert.equal(await readBoundedCdpJson(new Response(
    new Uint8Array([0x7b,0xff,0x7d]))),null);
});


test('TEST-009: target creation is rejected without an authenticated owned session',async()=>{
  const missing={ok:false as const,code:'PREFLIGHT_FAILED' as const};
  assert.deepEqual(await openApprovedTarget(missing,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
  assert.deepEqual(await openApprovedTarget(missing,'file:///C:/secret',false),
    {ok:false,code:'NOT_AUTHORIZED'});
});

test('TEST-009: a forged shape cannot authorize Chrome target creation',async()=>{
  const forged:Extract<Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>,{ok:true}>={
    ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',
    pid:process.pid,chromeVersion:'155.0.1.1',
    browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/12345678',
    websocketHandshakeVerified:true,targetVerified:false,stop:()=>{}
  };
  assert.equal(isLiveApprovedChromeSession(forged),false);
  assert.deepEqual(await openApprovedTarget(forged,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
});

test('TASK-005/TEST-009/026: CDP navigation rejects unregistered browser accessors and Proxies before touching them',async()=>{
 let getterCalls=0,trapCalls=0;
 const malicious={
  get ok(){getterCalls++;throw Error('PRIVATE_BROWSER_GETTER');}
 } as unknown as Parameters<typeof openApprovedTarget>[0];
 const proxied=new Proxy({},{
  get(){trapCalls++;throw Error('PRIVATE_BROWSER_PROXY_GET');},
  getPrototypeOf(){trapCalls++;throw Error('PRIVATE_BROWSER_PROXY_PROTO');}
 }) as Parameters<typeof openApprovedTarget>[0];
 const revoked=Proxy.revocable({},{});
 revoked.revoke();
 for(const browser of [malicious,proxied,
   revoked.proxy as Parameters<typeof openApprovedTarget>[0]]){
  assert.deepEqual(await openApprovedTarget(browser,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
 }
 assert.equal(getterCalls,0);
 assert.equal(trapCalls,0);
});

test('TASK-005/TEST-009/026: invalid CDP navigation AbortSignal cannot run getters or initiate work',async()=>{
 let traps=0;
 const poisoned=new Proxy(new AbortController().signal,{
  get(){traps++;throw Error('PRIVATE_ABORT_GET');},
  getPrototypeOf(){traps++;throw Error('PRIVATE_ABORT_PROTO');}
 });
 const shadow=new AbortController().signal;
 Object.defineProperty(shadow,'aborted',{
  get(){traps++;throw Error('PRIVATE_ABORT_SHADOW');}
 });
 const forged=Object.create(AbortSignal.prototype) as AbortSignal;
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const missing={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 for(const signal of [
  poisoned,shadow,forged,revoked.proxy,{aborted:false} as AbortSignal
 ]){
  assert.deepEqual(await openApprovedTarget(
   missing,'https://example.com/',true,signal),
   {ok:false,code:'INVALID_OPTIONS'});
 }
 assert.equal(traps,0,'no user getter or Proxy trap may run before CDP ownership');
 const cancelled=new AbortController();
 cancelled.abort();
 assert.deepEqual(await openApprovedTarget(
  missing,'https://example.com/',true,cancelled.signal),
  {ok:false,code:'CANCELLED'});
 assert.deepEqual(await openApprovedTarget(
  missing,'https://example.com/',true,new AbortController().signal),
  {ok:false,code:'UNVERIFIED_BROWSER'});
});

/** Dedicated cloud job supplies a signed, independently located official
 * Chrome for Testing. Standard app-check skips this optional matrix cell.
 */
test('TEST-006/007/008/009: signed Chrome from an independent application path',async t=>{
  const executable=process.env.UAH_TEST_PORTABLE_CHROME;
  if(!executable){t.skip('Dedicated portable Chrome job supplies this fixture');return;}
  assert.equal(process.platform,'win32');
  await access(executable);
  const root=await mkdtemp(join(tmpdir(),'uah-portable-product-'));
  const profile=join(root,'profile');
  let stop:()=>void=()=>{};
  t.after(async()=>{stop();await delay(900);await rm(root,{force:true,recursive:true}).catch(()=>undefined);});
  const port=await unusedLoopbackPort();
  const cfg=config(executable,profile,port);
  const prepared=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  const session=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
  assert.equal(session.ok,true,JSON.stringify(session));
  if(!session.ok)return;
  stop=session.stop;
  assert.ok(session.pid>0);
  assert.equal(session.websocketHandshakeVerified,true);
  assert.equal(isLiveApprovedChromeSession(session),true);
  const fixture=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Portable product check</title>');});
  await new Promise<void>((resolve,reject)=>{
    fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise<void>(resolve=>fixture.close(()=>resolve())));
  const address=fixture.address();
  if(!address||typeof address==='string')throw Error('MISSING_TEST_SITE');
  const site='http://127.0.0.1:'+address.port+'/';
  const page=await openApprovedTarget(session,site,true);
  assert.equal(page.ok,true,JSON.stringify(page));
  if(page.ok)assert.equal(page.businessVerified,false);
  stop();
  assert.equal(isLiveApprovedChromeSession(session),false);
});


// A failing Windows runner must identify the transport class without leaking
// OS errors, profile locations, URLs, ports, or private Chrome output.
import * as ownedChromeDiagnostics from '../../src/browser/owned-chrome';
test('TASK-005/TEST-006/008/009/026: timed-out Chrome diagnostics cannot wait forever for a native listener probe',async t=>{
  // A timed-out owned Chrome must be retired promptly even if the read-only
  // Windows netstat/PID diagnostic never settles. Only synthetic processes
  // and transports are used; never touch a real Chrome or user profile.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12064);
  const child=Object.assign(new EventEmitter(),{
    pid:41264,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  const prevActions=process.env.GITHUB_ACTIONS;
  let elapsed=0,probeCalled=0;
  const stages:string[]=[];
  try{
    process.env.GITHUB_ACTIONS='true';
    t.mock.method(performance,'now',()=>elapsed);
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',async()=>{
      elapsed=20001;
      throw Object.assign(new Error('PRIVATE_CDP_ENDPOINT'),{code:'ECONNREFUSED'});
    });
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>{
      probeCalled++;
      return await new Promise<Awaited<ReturnType<typeof cdp.verifyWindowsLoopbackListenerPid>>>(()=>{});
    });
    const outcome=await Promise.race([
      launchApprovedIsolatedChrome(cfg,{
        userApproved:true,testHeadless:true,
        onStartupStage:(stage)=>stages.push(stage)
      }),
      delay(1500).then(()=> 'UNBOUNDED_TIMEOUT_DIAGNOSTIC' as const)
    ]);
    assert.notEqual(outcome,'UNBOUNDED_TIMEOUT_DIAGNOSTIC',
      'read-only diagnostic cannot hold a timed-out owned Chrome alive');
    assert.deepEqual(outcome,{ok:false,code:'CDP_TIMEOUT'});
    assert.equal(probeCalled,1,'timeout diagnostic should be attempted once');
    assert.equal(child.killed,true,'owned child must be retired on timeout');
    assert.ok(stages.includes('CHILD_RUNNING_NO_CDP'));
    assert.ok(stages.includes('CDP_TIMEOUT_PROBE_INCONCLUSIVE'));
    assert.ok(!stages.join(',').includes('PRIVATE_CDP_ENDPOINT'));
  }finally{
    if(prevActions===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=prevActions;
    t.mock.reset();
  }
});

/** Deterministic read-only proof-stage receipt; the Windows intermittency
 * remains unproven. No real Chrome, port, filesystem or trusted user Profile.
 */
test('TASK-005/TEST-006/008/009: rejected listener PID emits a bounded stage before WebSocket I/O',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned',12073);
  const child=Object.assign(new EventEmitter(),{
    pid:41273,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let websocketCalls=0;
  const stages:string[]=[];
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12073/devtools/browser/abcdefgh-1234'
    })));
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:false as const,code:'LISTENER_PID_MISMATCH' as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      websocketCalls++;return true;
    });
    const result=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,onStartupStage:stage=>stages.push(stage)
    });
    assert.deepEqual(result,{ok:false,code:'OWNER_MISMATCH'});
    assert.deepEqual(stages,[
      'CHROME_SPAWN_RETURNED','CDP_VERSION_PARSED',
      'CDP_PID_PROOF_STARTED','CDP_PID_PROOF_REJECTED'
    ]);
    assert.equal(websocketCalls,0,'unowned PID cannot proceed to WebSocket proof');
    assert.equal(child.killed,true,'stop only the synthetic owned child');
    assert.equal(stages.join(',').includes('12073'),false);
    assert.equal(stages.join(',').includes('41273'),false);
    assert.equal(stages.join(',').includes('synthetic'),false);
  }finally{t.mock.reset();}
});

test('TASK-005/TEST-006/008/009: timeout listener status is bounded and has no PID leakage',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpTimeoutListener?: (v:unknown)=>string
  }).classifyCdpTimeoutListener;
  assert.equal(typeof classify,'function','timeout diagnosis must exist');
  if(!classify)return;
  const cases=[
    [{ok:true,status:'LISTENER_PID_MATCH_ONLY',pid:987654,executableVerified:false},
      'CDP_TIMEOUT_LISTENER_PID_MATCH'],
    [{ok:false,code:'LISTENER_UNAVAILABLE'},'CDP_TIMEOUT_LISTENER_UNAVAILABLE'],
    [{ok:false,code:'LISTENER_PID_MISMATCH'},'CDP_TIMEOUT_LISTENER_PID_MISMATCH'],
    [{ok:false,code:'LISTENER_AMBIGUOUS'},'CDP_TIMEOUT_LISTENER_AMBIGUOUS'],
    [{ok:false,code:'UNSUPPORTED_PLATFORM'},'CDP_TIMEOUT_PROBE_INCONCLUSIVE'],
    [{ok:false,code:'INVALID_ARGUMENTS'},'CDP_TIMEOUT_PROBE_INCONCLUSIVE']
  ] as const;
  for(const [probe,expected] of cases){
    const stage=classify(probe);
    assert.equal(stage,expected);
    assert.match(stage,/^CDP_TIMEOUT_[A-Z_]+$/);
    assert.equal(stage.includes('987654'),false,'never emit process identity');
  }
});

test('TASK-005/TEST-006: bounded CDP startup transport failure labels are useful and non-secret',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure?: (e:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  assert.equal(typeof classify,'function','production diagnosis must exist');
  if(!classify)return;
  const error=(code:string)=>Object.assign(new Error('fetch failed'),{
    cause:Object.assign(new Error('private URL http://127.0.0.1:9223'),{code})
  });
  assert.equal(classify(error('ECONNREFUSED')),'FETCH_REFUSED');
  assert.equal(classify(error('UND_ERR_CONNECT_TIMEOUT')),'FETCH_TIMEOUT');
  assert.equal(classify(error('ETIMEDOUT')),'FETCH_TIMEOUT');
  assert.equal(classify(error('ECONNRESET')),'FETCH_RESET');
  assert.equal(classify({name:'TimeoutError'}),'FETCH_TIMEOUT');
  assert.equal(classify(new DOMException('private loopback timeout','TimeoutError')),
    'FETCH_TIMEOUT','native DOMException.name is inherited, not an own descriptor');
  assert.equal(classify(new DOMException('cancelled','AbortError')),'FETCH_FAILED',
    'revocation must not be misreported as a transport timeout');
  for(const bad of [
    error('EPRIVATE_SCRIPT_CONTENT'),new Error('secret path C:/data/source.user.js'),
    Object.defineProperty({},'cause',{get(){throw Error('PRIVATE_DETAILS');}}),
    Object.defineProperty({},'code',{get(){throw Error('PRIVATE_DETAILS');}})
  ])assert.equal(classify(bad),'FETCH_FAILED');
});



test('TASK-005/TEST-009/026: native DOMException classification never executes overwritten name getters',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure:(error:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  let getters=0;
  const nativeTimeout=Object.defineProperty(
    new DOMException('private browser path','TimeoutError'),'name',{
      configurable:true,get(){getters++;throw Error('PRIVATE_GETTER_EXECUTED');}
    });
  assert.equal(classify(nativeTimeout),'FETCH_TIMEOUT',
    'genuine native DOMException brand retains timeout classification without user getter');
  const spoofedAbort=Object.defineProperty(
    new DOMException('user cancelled','AbortError'),'name',{
      configurable:true,get(){getters++;return 'TimeoutError';}
    });
  assert.equal(classify(spoofedAbort),'FETCH_FAILED',
    'an overwritten name must not promote a cancellation to a transport timeout');
  assert.equal(getters,0,'native transport diagnostics must not evaluate caller getters');
});

test('TASK-005/TEST-006/008/009: bundled native fetch refusals remain redacted and distinguishable',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure:(error:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  const reason=(code:string)=>Object.assign(new Error('PRIVATE_LOCAL_ENDPOINT'),{code});
  const wrapped=(codes:string[])=>({
    cause:new AggregateError(codes.map(reason),'PRIVATE_ENDPOINT_AND_PROFILE')
  });
  assert.equal(classify(wrapped(['ECONNREFUSED','ECONNREFUSED'])),'FETCH_REFUSED',
    'uniform native AggregateError refusals must not lose the diagnostic category');
  assert.equal(classify(wrapped(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'])),'FETCH_TIMEOUT');
  assert.equal(classify(wrapped(['ECONNREFUSED','ETIMEDOUT'])),'FETCH_FAILED',
    'mixed failures must not be misrepresented as one proven cause');
  assert.equal(classify(wrapped([])),'FETCH_FAILED');
  assert.equal(classify(wrapped(Array.from({length:9},()=> 'ECONNREFUSED'))),
    'FETCH_FAILED','oversized aggregate evidence remains inconclusive');
});

test('TASK-005/TEST-006/008/009/026: diagnostic classifier never executes Proxy traps',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure:(error:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  let traps=0;
  const poisoned=new Proxy({code:'ECONNREFUSED'},{
    ownKeys(){traps++;return ['code'];},
    getOwnPropertyDescriptor(){traps++;return {
      configurable:true,enumerable:true,writable:true,value:'ECONNREFUSED'
    };}
  });
  assert.equal(classify({cause:poisoned}),'FETCH_FAILED');
  assert.equal(traps,0,'classification cannot invoke proxy reflection traps');
  const revoked=Proxy.revocable({code:'ETIMEDOUT'},{});
  revoked.revoke();
  assert.equal(classify({cause:revoked.proxy}),'FETCH_FAILED');
});


test('TASK-005/TEST-006/009/026: a late handshake cannot certify Chrome after the monotonic startup deadline',async t=>{
  // Controlled synthetic Chrome: no real executable, Profile, endpoint, PID
  // lookup or user's browser is contacted. Hold all prior proofs valid, then
  // cross the existing 20-second deadline while the last proof is pending.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12041);
  const child=Object.assign(new EventEmitter(),{
    pid:41241,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let elapsedMs=0,handshakeObserved=false;
  let result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(performance,'now',()=>elapsedMs);
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>{
      elapsedMs=19999;
      return {ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
        pid:41241,executableVerified:false as const};
    });
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      handshakeObserved=true;
      elapsedMs=20001;
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>
      new Response(JSON.stringify({
        Browser:'Chrome/155.0.1.1',
        webSocketDebuggerUrl:'ws://127.0.0.1:12041/devtools/browser/abcdefgh-1234'
      }))
    );
    result=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.equal(handshakeObserved,true,'deadline must expire during a successful synthetic handshake');
    assert.deepEqual(result,{ok:false,code:'CDP_TIMEOUT'},
      'proof completed after the deadline cannot grant an owned browser session');
    assert.equal(child.killed,true,'failed launch must retire only its owned child');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    if(result?.ok)result.stop();
    t.mock.reset();
  }
});

test('TASK-005/TEST-006/008/009: a forward Windows wall-clock adjustment cannot prematurely expire an owned Chrome bootstrap',async t=>{
  // Synthetic, strictly owned launch fixture: no user Chrome, filesystem,
  // network endpoint, profile or script is touched. This isolates deadline
  // arithmetic from the independent intermittent real Chrome startup bug.
  const { EventEmitter }=require('node:events') as typeof import('node:events');
  const childProcesses=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const port=12023;
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',port);
  const child=Object.assign(new EventEmitter(),{
    pid:41234,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  const actualNow=Date.now;
  let jumped=false,requests=0;
  let session:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(childProcesses,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41234,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>true);
    t.mock.method(Date,'now',()=>actualNow()+(jumped?60000:0));
    t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
      assert.equal(input,'http://127.0.0.1:'+port+'/json/version');
      requests++;
      if(requests===1){
        jumped=true;
        throw Object.assign(new Error('synthetic refused probe'),{code:'ECONNREFUSED'});
      }
      return new Response(JSON.stringify({
        Browser:'Chrome/155.0.1.1',
        webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/abcdefgh-1234'
      }));
    });
    session=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.equal(jumped,true,'fixture must advance the wall clock after probe one');
    assert.ok(requests>=2,'the authorized bootstrap must retry after a refused probe');
    assert.equal(session.ok,true,JSON.stringify(session));
    if(session.ok)assert.equal(session.websocketHandshakeVerified,true);
  }finally{
    if(session?.ok)session.stop();
    t.mock.reset();
  }
});


/** Consent revocation during a *pending* CDP browser WebSocket proof must
 * promptly terminate the owned Chrome bootstrap, not wait for the separate
 * four-second proof timer. Entire fixture is an in-memory synthetic child
 * and proof; no Chrome, socket, user Profile, website or script is touched.
 */
test('TASK-005/TEST-006/009/026: in-flight WebSocket proof observes native consent cancellation immediately',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\pending-ws-profile',12036);
  const controller=new AbortController();
  const child=Object.assign(new EventEmitter(),{
    pid:41236,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let markHandshake:()=>void=()=>{};
  const handshakeStarted=new Promise<void>(resolve=>{markHandshake=resolve;});
  let cancellationObserved=false;
  let pending:ReturnType<typeof launchApprovedIsolatedChrome>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41236,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',
      (_url:string,_port:number,_version:string,signal?:AbortSignal)=>
        new Promise<boolean>(resolve=>{
          markHandshake();
          const fallback=setTimeout(()=>resolve(false),400);
          signal?.addEventListener('abort',()=>{
            cancellationObserved=true;
            clearTimeout(fallback);
            resolve(false);
          },{once:true});
        })
    );
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12036/devtools/browser/abcdefgh-1234'
    })));
    pending=launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal
    });
    await Promise.race([
      handshakeStarted,
      delay(1000).then(()=>{throw Error('SYNTHETIC_HANDSHAKE_NEVER_STARTED');})
    ]);
    controller.abort();
    const timely=await Promise.race([
      pending,
      delay(175).then(()=>({ok:false as const,code:'HANDSHAKE_NOT_CANCELLED' as const}))
    ]);
    assert.deepEqual(timely,{ok:false,code:'ABORTED'},
      'native cancellation must stop a pending CDP proof promptly');
    assert.equal(cancellationObserved,true,
      'the in-flight WebSocket proof must receive the native abort signal');
    assert.equal(child.killed,true,'the launcher stops only its own synthetic child');
  }finally{
    controller.abort();
    if(pending)await pending;
    t.mock.reset();
  }
});

test('TASK-005/TEST-006/009/026: owned child exit during pending WebSocket proof reports launch failure',async t=>{
  // An in-memory owned child, signed-binary preflight and CDP proof only.
  // The synthetic process exits *during* the pending identity handshake,
  // which must be reported as LAUNCH_FAILED, not a network proof failure.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\ws-child-exit',12037);
  const child=Object.assign(new EventEmitter(),{
    pid:41237,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let enteredProof:()=>void=()=>{};
  const proofStarted=new Promise<void>(resolve=>{enteredProof=resolve;});
  let proofCancelled=false;
  let pending:ReturnType<typeof launchApprovedIsolatedChrome>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41237,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',
      (_url:string,_port:number,_version:string,signal?:AbortSignal)=>
        new Promise<boolean>(resolve=>{
          enteredProof();
          const fallback=setTimeout(()=>resolve(false),400);
          signal?.addEventListener('abort',()=>{
            proofCancelled=true;
            clearTimeout(fallback);
            resolve(false);
          },{once:true});
        })
    );
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12037/devtools/browser/abcdefgh-1234'
    })));
    pending=launchApprovedIsolatedChrome(cfg,{userApproved:true});
    await Promise.race([
      proofStarted,
      delay(1000).then(()=>{throw Error('SYNTHETIC_PROOF_NOT_STARTED');})
    ]);
    child.exitCode=1;
    child.emit('exit',1);
    const result=await Promise.race([
      pending,
      delay(175).then(()=>({ok:false as const,code:'CDP_TIMEOUT' as const}))
    ]);
    assert.deepEqual(result,{ok:false,code:'LAUNCH_FAILED'},
      'an exited owned child cannot be misclassified as a mere WebSocket failure');
    assert.equal(proofCancelled,true,
      'the pending identity proof must observe the owned child termination');
    assert.equal(child.killed,false,'an already exited owned child is not killed a second time');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    child.emit('exit',1);
    if(pending)await pending;
    t.mock.reset();
  }
});

test('TASK-005/TEST-006/009/026: abort during verified WebSocket handshake cannot register an owned browser',async t=>{
  // This synthetic child never starts a real Chrome, touches a user Profile,
  // or performs network I/O. Consent is revoked *after* the earlier abort
  // check, while the asynchronous browser handshake is still in progress.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const childProcesses=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12024);
  const controller=new AbortController();
  const child=Object.assign(new EventEmitter(),{
    pid:41235,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let handshakeObserved=false;
  let result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(childProcesses,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41235,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      handshakeObserved=true;
      controller.abort();
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>
      new Response(JSON.stringify({
        Browser:'Chrome/155.0.1.1',
        webSocketDebuggerUrl:'ws://127.0.0.1:12024/devtools/browser/abcdefgh-1234'
      }))
    );
    result=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal
    });
    assert.equal(handshakeObserved,true,
      'the abort must occur in the authenticated handshake, not before launch');
    assert.deepEqual(result,{ok:false,code:'ABORTED'},
      'a completed handshake cannot reinstate revoked user consent');
    assert.equal(child.killed,true,
      'only the synthetic child owned by this launch is cleaned up');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    if(result?.ok)result.stop();
    t.mock.reset();
  }
});

test('TASK-005/TEST-006/009/026: native cancellation reaches a refused-CDP retry pause',async t=>{
  // Entirely synthetic owned child and HTTP rejection: no Chrome, user
  // Profile, network request, external process or user-script interaction.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const timers=require('node:timers/promises') as typeof import('node:timers/promises');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\cancelled-profile',12046);
  const child=Object.assign(new EventEmitter(),{
    pid:41246,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  const controller=new AbortController();
  const pauseSignals:(AbortSignal|undefined)[]=[];
  const stages:string[]=[];
  let fetches=0;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',async()=>{
      fetches++;
      throw Object.assign(new Error('synthetic refused request'),{code:'ECONNREFUSED'});
    });
    t.mock.method(timers,'setTimeout',async(
      ms?:number,_value?:unknown,options?:{signal?:AbortSignal}
    )=>{
      if(ms!==250)throw Error('UNEXPECTED_SYNTHETIC_TIMER');
      pauseSignals.push(options?.signal);
      if(options?.signal?.aborted)
        throw Object.assign(new Error('synthetic timer cancellation'),{name:'AbortError'});
    });
    const result=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal,
      onStartupStage:(stage)=>{
        stages.push(stage);
        if(stage==='FETCH_REFUSED')controller.abort();
      }
    });
    assert.deepEqual(result,{ok:false,code:'ABORTED'});
    assert.equal(fetches,1,'revoked consent must prevent a second CDP probe');
    assert.equal(pauseSignals.length,1,'exactly one cancelled retry pause');
    assert.equal(controller.signal.aborted,true,'native consent was revoked');
    assert.equal(pauseSignals[0]?.aborted,true,
      'combined child-exit and native consent signal must cancel retry immediately');
    assert.deepEqual(stages,['CHROME_SPAWN_RETURNED','FETCH_REFUSED']);
    assert.equal(child.killed,true,'cancellation must stop only the owned child');
  }finally{t.mock.reset();}
});

test('TASK-005/TEST-006/009/026: native revocation aborts an in-flight owned CDP HTTP probe',async t=>{
  // Native-only disposable synthetic process: no Chrome, Profile or web I/O.
  // Keep a refed watchdog so a pending fetch cannot make node:test silently
  // cancel the test before the expected RED/GREEN assertion executes.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\isolated-profile',12025);
  const controller=new AbortController();
  const child=Object.assign(new EventEmitter(),{
    pid:41236,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let fetchStarted=false,cancelledByUser=false;
  let result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',
      (_request:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
        fetchStarted=true;
        const signal=init?.signal;
        return new Promise<Response>((_resolve,reject)=>{
          const watchdog=setTimeout(()=>reject(Error('FIXTURE_FETCH_DEADLINE')),3500);
          const onAbort=()=>{
            clearTimeout(watchdog);
            reject(new DOMException('Cancelled','AbortError'));
          };
          signal?.addEventListener('abort',onAbort,{once:true});
          if(signal?.aborted)onAbort();
          // Abort only AFTER the production code has entered fetch.
          queueMicrotask(()=>{
            controller.abort();
            cancelledByUser=Boolean(signal?.aborted);
          });
        });
      });
    result=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal
    });
    assert.equal(fetchStarted,true,'the CDP fetch was genuinely pending');
    assert.equal(cancelledByUser,true,
      'revoking native consent must synchronously abort active CDP HTTP fetch');
    assert.deepEqual(result,{ok:false,code:'ABORTED'});
    assert.equal(child.killed,true,'only this owned child must be stopped');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    if(result?.ok)result.stop();
    controller.abort();
    t.mock.reset();
  }
});


test('TASK-005/TEST-006/009/026: native consent revocation interrupts a stalled CDP response body',async()=>{
  // Synthetic response stream only: no Chrome process, Profile or network.
  // The fetch may have completed its headers before user revocation.
  const controller=new AbortController();
  const neverYieldingBody=new ReadableStream<Uint8Array>({
    pull:()=>new Promise<void>(()=>{})
  });
  const response=new Response(neverYieldingBody,{status:200});
  // Keep the regression compilable against the old one-argument signature;
  // previously the second argument was ignored and the body waited 1500ms.
  const readWithSignal=readBoundedCdpJson as unknown as
    (response:Response,signal:AbortSignal)=>Promise<unknown|null>;
  const pending=readWithSignal(response,controller.signal);
  const deadline=Symbol('stalled-cdp-body-did-not-stop');
  let watchdog:ReturnType<typeof setTimeout>|undefined;
  try{
    controller.abort();
    const outcome=await Promise.race([
      pending,
      new Promise<typeof deadline>(resolve=>{
        watchdog=setTimeout(()=>resolve(deadline),400);
      })
    ]);
    assert.notEqual(outcome,deadline,
      'revoked consent must stop a stalled CDP body without waiting for its separate 1500ms deadline');
    assert.equal(outcome,null,'a revoked CDP body must never yield verified JSON');
  }finally{
    if(watchdog)clearTimeout(watchdog);
  }
});


test('TASK-005/TEST-006/009/026: owned Chrome exit immediately cancels an in-flight CDP HTTP probe',async t=>{
  // Controlled synthetic child only. No user Chrome, Profile, port or network.
  // When the owned process exits during fetch, a 1500ms HTTP probe must not
  // stay alive or be mistaken for an ordinary temporary refused connection.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12047);
  const child=Object.assign(new EventEmitter(),{
    pid:41247,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let observedAborted=false,requests=0;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',async(
      _request:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]
    )=>{
      requests++;
      assert.ok(init?.signal,'the owned probe must be cancellable');
      child.emit('exit',1);
      observedAborted=Boolean(init.signal.aborted);
      throw Object.assign(new Error('synthetic child closed the listener'),
        {code:'ECONNRESET'});
    });
    const result=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.equal(requests,1,'do not retry a terminal child');
    assert.equal(observedAborted,true,
      'process exit must synchronously revoke the active CDP HTTP probe');
    assert.deepEqual(result,{ok:false,code:'LAUNCH_FAILED'},
      'a dead owned Chrome is a terminal failure, not a CDP timeout');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{t.mock.reset();}
});


// TASK-005/TEST-006/009/026: an asynchronous WebSocket "open" event can
// arrive AFTER the native owner revokes consent. A CONNECTING socket may
// refuse close(); that must not permit a late Browser.getVersion command.
test('TASK-005/TEST-006/009/026: a late CDP WebSocket open cannot send after native cancellation',async()=>{
  const nativeWebSocket=globalThis.WebSocket;
  const openCallbacks:Array<()=>void>=[];
  let outboundMethods=0,closeAttempts=0;
  class ConnectingSocket {
    constructor(_url:string){}
    addEventListener(name:string,callback:()=>void):void {
      if(name==='open')openCallbacks.push(callback);
    }
    send(_data:string):void {outboundMethods++;}
    close():void {
      closeAttempts++;
      // Node/native WebSocket implementations can reject close() while
      // CONNECTING. This is a deterministic in-memory transport fixture.
      throw Error('SYNTHETIC_CONNECTING_CLOSE_REFUSED');
    }
  }
  globalThis.WebSocket=ConnectingSocket as unknown as typeof WebSocket;
  const consent=new AbortController();
  try{
    const proof=verifyCdpBrowserWebSocket(
      'ws://127.0.0.1:12048/devtools/browser/abcdefgh-1234',
      12048,'155.0.1.1',consent.signal);
    assert.equal(openCallbacks.length,1,'proof installed exactly one open hook');
    consent.abort();
    assert.equal(await proof,false,'revoked proof must fail closed immediately');
    // A delayed socket event cannot revive the finished transport or perform
    // a post-revocation command, even if close() could not stop CONNECTING.
    openCallbacks[0]();
    assert.equal(outboundMethods,0,'late open must never send a CDP command');
    assert.equal(closeAttempts,1,'best-effort close was attempted once');
  }finally{
    consent.abort();
    globalThis.WebSocket=nativeWebSocket;
  }
});


// TASK-005/TEST-009/026: an unsolicited matching-id browser response must
// not certify CDP without a client-issued Browser.getVersion request.
test('TASK-005/TEST-009/026: unsolicited CDP WebSocket identity response is denied before request',async()=>{
  const nativeSocket=globalThis.WebSocket;
  const listeners=new Map<string,Array<(event?:{data?:string})=>void>>();
  let outbound=0;
  class UnsolicitedSocket {
    constructor(_url:string){}
    addEventListener(name:string,callback:(event?:{data?:string})=>void):void{
      const callbacks=listeners.get(name)??[];
      callbacks.push(callback);
      listeners.set(name,callbacks);
    }
    send(_message:string):void{outbound++;}
    close():void{}
  }
  globalThis.WebSocket=UnsolicitedSocket as unknown as typeof WebSocket;
  try{
    const pending=verifyCdpBrowserWebSocket(
      'ws://127.0.0.1:12049/devtools/browser/abcdefgh-1234',
      12049,'155.0.1.1');
    const unsolicited=listeners.get('message')?.[0];
    assert.ok(unsolicited,'native proof installed a browser message hook');
    // An unsolicited matching id/product is NOT a response to this client.
    unsolicited({data:JSON.stringify({
      id:1,result:{product:'Chrome/155.0.1.1'}
    })});
    const outcome=await Promise.race([
      pending,
      delay(300).then(()=> 'UNRESOLVED' as const)
    ]);
    assert.equal(outcome,false,
      'unsolicited matching-id CDP message cannot establish browser identity');
    assert.equal(outbound,0,'no local CDP method was sent');
  }finally{globalThis.WebSocket=nativeSocket;}
});


/** TASK-005 / TEST-009/026: even an apparently valid CDP identity must not
 * be accepted from an oversized frame or coerced binary/object payload.
 * The trusted owner/listener checks are separate prerequisites; here the
 * WebSocket transport is entirely synthetic, with no Chrome connection.
 */
test('TASK-005/TEST-009/026: browser WebSocket identity frames are bounded and text-only',async()=>{
  const nativeSocket=globalThis.WebSocket;
  const callbacks=new Map<string,Array<(event?:{data?:unknown})=>void>>();
  let outbound=0,coercions=0;
  class SyntheticSocket {
    constructor(_url:string){}
    addEventListener(name:string,callback:(event?:{data?:unknown})=>void):void{
      const existing=callbacks.get(name)??[];
      callbacks.set(name,[...existing,callback]);
    }
    send(_message:string):void{outbound++;}
    close():void{}
  }
  globalThis.WebSocket=SyntheticSocket as unknown as typeof WebSocket;
  const version='155.0.1.1',port=12088;
  const websocket='ws://127.0.0.1:'+port+'/devtools/browser/abcdefgh-1234';
  const check=async(payload:unknown,expected:boolean)=>{
    callbacks.clear();
    const before=outbound;
    const pending=verifyCdpBrowserWebSocket(websocket,port,version);
    const opened=callbacks.get('open')?.[0];
    assert.ok(opened,'a native getVersion request must have an open handler');
    opened();
    assert.equal(outbound,before+1,'the client must issue exactly one identity request');
    const received=callbacks.get('message')?.[0];
    assert.ok(received,'a native getVersion response handler must exist');
    received({data:payload});
    const outcome=await Promise.race([
      pending,delay(300).then(()=> 'STALLED' as const)
    ]);
    assert.equal(outcome,expected,'identity is trusted only for bounded text frames');
  };
  try{
    await check(JSON.stringify({id:1,result:{product:'Chrome/'+version}}),true);
    await check(JSON.stringify({id:1,result:{product:'Chrome/'+version},
      padding:'x'.repeat(20000)}),false);
    await check({toString(){coercions++;throw Error('PRIVATE_WEBSOCKET_DATA');}},false);
    assert.equal(coercions,0,'binary/foreign frame object must not invoke coercion');
  }finally{globalThis.WebSocket=nativeSocket;}
});

/** TASK-005/TEST-006/009/026: the 20s owned-Chrome startup gate also
 * applies BETWEEN the native listener PID proof and any CDP WebSocket I/O.
 * A late positive PID receipt must not initiate a new browser connection.
 * All network, file system, Chrome, and native probes here are synthetic.
 */
test('TASK-005/TEST-006/009/026: late native PID receipt must not open a CDP WebSocket after deadline',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned',12071);
  const child=Object.assign(new EventEmitter(),{
    pid:41271,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let elapsedMs=0,websocketProofs=0;
  let outcome:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(performance,'now',()=>elapsedMs);
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>{
      elapsedMs=20001; // Native OS proof resolves after 20s, but is positive.
      return {ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
        pid:41271,executableVerified:false as const};
    });
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      websocketProofs++;
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12071/devtools/browser/abcdefgh-1234'
    })));
    outcome=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.deepEqual(outcome,{ok:false,code:'CDP_TIMEOUT'},
      'an expired startup cannot certify an owned browser');
    assert.equal(websocketProofs,0,
      'no new CDP transport request is permitted after the 20s gate');
    assert.equal(child.killed,true,'only the synthetic owned child is retired');
  }finally{
    if(outcome?.ok)outcome.stop();
    t.mock.reset();
  }
});


/** TASK-005 / TEST-006/009/026: a native Windows listener PID query can
 * suspend indefinitely despite the owned Chrome launch having a fixed 20s
 * budget. An expired ownership proof must not hold a user-consented launch
 * open. All external operations here are synthetic; no system PID is queried.
 */
test('TASK-005/TEST-006/009/026: pending native PID proof obeys remaining Chrome startup deadline',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned',12071);
  const child=Object.assign(new EventEmitter(),{
    pid:41271,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let elapsedMs=0,observedRemainingMs:number|undefined,handshakes=0;
  let outcome:unknown;
  try{
    t.mock.method(performance,'now',()=>elapsedMs);
    const realTimeout=AbortSignal.timeout;
    t.mock.method(AbortSignal,'timeout',(ms:number)=>{
      if(ms<1500){
        observedRemainingMs=ms;
        return AbortSignal.abort(); // Deterministic synthetic deadline expiry.
      }
      return realTimeout(ms);
    });
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>{
      elapsedMs=19999;
      return await new Promise<Awaited<ReturnType<typeof cdp.verifyWindowsLoopbackListenerPid>>>(()=>{});
    });
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      handshakes++;
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12071/devtools/browser/abcdefgh-1234'
    })));
    outcome=await Promise.race([
      launchApprovedIsolatedChrome(cfg,{userApproved:true}),
      delay(350).then(()=>({ok:false,code:'NATIVE_PID_WAIT_STALLED'}))
    ]);
    assert.deepEqual(outcome,{ok:false,code:'CDP_TIMEOUT'},
      'pending native verification must not outlive the fixed 20s launch gate');
    assert.equal(observedRemainingMs,1,
      'native proof must inherit exactly the one millisecond left in the launch budget');
    assert.equal(handshakes,0,'expired native proof must never authorize CDP WebSocket I/O');
    assert.equal(child.killed,true,'retire only this synthetic owned child');
  }finally{
    if(outcome&&typeof outcome==='object'&&
       'ok' in outcome&&outcome.ok===true&&'stop' in outcome&&
       typeof outcome.stop==='function')outcome.stop();
    t.mock.reset();
  }
});

/** TASK-005/TEST-006/008/009: opt-in CI Chrome bootstrap diagnostics must
 * actually enable Chromium's own log in THIS disposable headless launch.
 * This test never reads or emits the resulting browser log.
 */
test('TASK-005: manual Windows CI diagnostic enables Chrome bootstrap logging only when opted in',async t=>{
  if(process.platform!=='win32')return t.skip('Windows CI only');
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned-log',12173);
  const saved={actions:process.env.GITHUB_ACTIONS,event:process.env.GITHUB_EVENT_NAME,
    request:process.env.UAH_TEST_CHROME_BOOT_LOG,
    runnerTemp:process.env.RUNNER_TEMP};
  const child=Object.assign(new EventEmitter(),{
    pid:41273,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let observedArgs:ReadonlyArray<string>=[];
  let observedLogFile:string|undefined;
  let session:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    process.env.GITHUB_ACTIONS='true';
    process.env.GITHUB_EVENT_NAME='workflow_dispatch';
    process.env.UAH_TEST_CHROME_BOOT_LOG='true';
    process.env.RUNNER_TEMP='C:\\synthetic';
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',(_file:string,args?:ReadonlyArray<string>,
      options?:import('node:child_process').SpawnOptions)=>{
      observedArgs=Array.from(args??[]);
      observedLogFile=options?.env?.CHROME_LOG_FILE;
      return child as unknown as import('node:child_process').ChildProcess;
    });
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41273,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>true);
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12173/devtools/browser/abcdefgh-1234'
    })));
    session=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
    assert.equal(session.ok,true,JSON.stringify(session));
    assert.ok(observedArgs.includes('--enable-logging'),
      'opt-in diagnostic must direct Chrome logs to only its disposable Profile');
    assert.ok(observedArgs.includes('--v=0'),
      'avoid verbose URL/renderer instrumentation and extra resource load');
    assert.equal(observedLogFile,'C:\\synthetic\\owned-log\\chrome_debug.log',
      'Chrome log path must be confined to the disposable test profile');
    assert.ok(!observedArgs.some(x=>x.includes('--no-sandbox')),
      'diagnostics must not weaken Chrome sandbox');
    // A manual opt-in must never bleed into PR/push CI, default runs or
    // non-headless product launches even when the environment variable leaks.
    if(session.ok)session.stop();
    for(const [event,requested,headless] of [
      ['pull_request','true',true],
      ['push','true',true],
      ['workflow_dispatch','false',true],
      ['workflow_dispatch','true',false]
    ] as const){
      process.env.GITHUB_EVENT_NAME=event;
      process.env.UAH_TEST_CHROME_BOOT_LOG=requested;
      child.killed=false; // fresh synthetic spawn result, no real process
      observedArgs=[];
      observedLogFile=undefined;
      const normal=await launchApprovedIsolatedChrome(cfg,{
        userApproved:true,testHeadless:headless
      });
      assert.equal(normal.ok,true,JSON.stringify(normal));
      assert.ok(!observedArgs.includes('--enable-logging')&&
        !observedArgs.includes('--v=0'),
        'logging flags must be absent outside manual headless CI opt-in');
      assert.equal(observedLogFile,undefined,
        'normal launches must not override the Chrome log destination');
      if(normal.ok)normal.stop();
    }
  }finally{
    if(session?.ok)session.stop();
    t.mock.reset();
    for(const [key,value] of [
      ['GITHUB_ACTIONS',saved.actions],['GITHUB_EVENT_NAME',saved.event],
      ['UAH_TEST_CHROME_BOOT_LOG',saved.request],
      ['RUNNER_TEMP',saved.runnerTemp]
    ] as const){
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
  }
});


/** TASK-018 / TEST-009/026: a CDP Browser.getVersion receipt carrying an
 * explicit protocol error is never a successful identity proof, even when
 * error is falsy and a plausible product appears alongside it.
 * No browser, network socket or user profile is accessed.
 */
test('TASK-018/TEST-009/026: Browser.getVersion rejects every present error field even when falsy',async()=>{
  const nativeSocket=globalThis.WebSocket;
  const callbacks=new Map<string,Array<(event?:{data?:unknown})=>void>>();
  class SyntheticCdpSocket {
    constructor(_url:string){}
    addEventListener(name:string,callback:(event?:{data?:unknown})=>void){
      callbacks.set(name,[...(callbacks.get(name)??[]),callback]);
    }
    send(raw:string):void {
      assert.deepEqual(JSON.parse(raw),{id:1,method:'Browser.getVersion'});
    }
    close():void {}
  }
  globalThis.WebSocket=SyntheticCdpSocket as unknown as typeof WebSocket;
  const version='155.0.1.1';
  const port=12118;
  const websocket='ws://127.0.0.1:'+port+'/devtools/browser/abcdefgh-1234';
  const probe=async(frame:Record<string,unknown>,expected:boolean)=>{
    callbacks.clear();
    const pending=verifyCdpBrowserWebSocket(websocket,port,version);
    const open=callbacks.get('open')?.[0];
    const message=callbacks.get('message')?.[0];
    assert.ok(open);
    assert.ok(message);
    open();
    message({data:JSON.stringify(frame)});
    assert.equal(await pending,expected,
      'CDP success requires an error-free protocol envelope');
  };
  try{
    const valid={id:1,result:{product:'Chrome/'+version}};
    await probe(valid,true);
    for(const error of [null,false,0,'',{}]){
      await probe({...valid,error},false);
    }
    await probe({...valid,error:{code:-32601,message:'synthetic'}},false);
  }finally{
    globalThis.WebSocket=nativeSocket;
  }
});


test('TASK-005/TEST-009/026: raw CDP response reader refuses hostile cancellation signals without executing hooks',async()=>{
  let hooks=0;
  const actual=new AbortController().signal;
  const proxy=new Proxy(actual,{
    get(){hooks++;throw Error('UNTRUSTED_SIGNAL_GET');},
    getPrototypeOf(){hooks++;throw Error('UNTRUSTED_SIGNAL_PROTO');}
  });
  const revoked=Proxy.revocable(actual,{});
  revoked.revoke();
  const shadow=new AbortController().signal;
  Object.defineProperty(shadow,'aborted',{get(){hooks++;throw Error('UNTRUSTED_ABORT_GETTER');}});
  const forged=Object.create(AbortSignal.prototype) as AbortSignal;
  for(const signal of [proxy,revoked.proxy,shadow,forged,{
    get aborted(){hooks++;throw Error('UNTRUSTED_SIGNAL_OBJECT');}
  } as unknown as AbortSignal]){
    const response=new Response('{\"Browser\":\"Chrome/155.0.1.1\"}');
    assert.equal(await readBoundedCdpJson(response,signal),null,
      'invalid signal must not be allowed to validate a CDP HTTP receipt');
  }
  assert.equal(hooks,0,'neither Proxy traps nor forged AbortSignal getters may execute');
  assert.deepEqual(await readBoundedCdpJson(new Response('{\"Browser\":\"Chrome/155.0.1.1\"}'),
    new AbortController().signal),{Browser:'Chrome/155.0.1.1'},
    'a real native, unrevoked signal keeps normal CDP parsing working');
});

test('launchApprovedIsolatedChrome supports Chrome++ trampoline launcher exiting with code 0', async (t) => {
  const launcher = await import('../../src/browser/chrome-launcher');
  const cp = require('node:child_process') as typeof import('node:child_process');
  const cdp = await import('../../src/browser/cdp-session');
  const { EventEmitter } = require('node:events');

  const cfg = config('C:\\synthetic\\chrome.exe', 'C:\\synthetic\\owned', 12099);
  const child = Object.assign(new EventEmitter(), {
    pid: 41200,
    exitCode: null as number | null,
    killed: false,
    signalCode: null as string | null,
    kill() { this.killed = true; return true; }
  });

  try {
    t.mock.method(launcher, 'preflightChrome', async () => ({
      ok: true as const, status: 'PATH_AND_PORT_CHECKED_ONLY' as const,
      config: cfg, runtimeIdentityVerified: false as const
    }));
    t.mock.method(launcher, 'inspectWindowsChromeBinary', async () => ({
      ok: true as const, status: 'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version: '155.0.1.1', publisher: 'Google LLC' as const,
      runtimeVerified: false as const
    }));
    t.mock.method(cp, 'spawn', () => {
      setImmediate(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      return child as unknown as import('node:child_process').ChildProcess;
    });
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      Browser: 'Chrome/155.0.1.1',
      webSocketDebuggerUrl: 'ws://127.0.0.1:12099/devtools/browser/trampoline-uuid'
    })));
    t.mock.method(cdp, 'verifyWindowsLoopbackListenerPid', async (_port: number, expectedPid: number) => {
      if (expectedPid === 41200) {
        return { ok: false as const, code: 'LISTENER_PID_MISMATCH' as const };
      }
      return { ok: true as const, status: 'LISTENER_PID_MATCH_ONLY' as const, pid: 41201, executableVerified: true };
    });
    t.mock.method(cdp, 'findWindowsLoopbackListenerPid', async () => ({
      ok: true as const, pid: 41201
    }));
    const existing = await import('../../src/browser/existing-chrome');
    t.mock.method(existing, 'readChromeProcessInfo', async (pid: number) => {
      if (pid === 41201) {
        return {
          ProcessId: 41201,
          ParentProcessId: 41200,
          ExecutablePath: 'C:\\synthetic\\chrome.exe',
          CommandLine: '"C:\\synthetic\\chrome.exe" --remote-debugging-port=12099 --user-data-dir="C:\\synthetic\\owned"'
        };
      }
      return null;
    });
    t.mock.method(cdp, 'verifyCdpBrowserWebSocket', async () => true);

    const result = await launchApprovedIsolatedChrome(cfg, { userApproved: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.pid, 41201, 'effectivePid must be the descendant browser PID');
      assert.equal(result.status, 'OWNED_CDP_BROWSER_VERIFIED');
      result.stop();
    }
  } finally {
    t.mock.reset();
  }
});

test('launchApprovedIsolatedChrome fails with LAUNCH_FAILED when launcher exits with non-zero code', async (t) => {
  const launcher = await import('../../src/browser/chrome-launcher');
  const cp = require('node:child_process') as typeof import('node:child_process');
  const { EventEmitter } = require('node:events');

  const cfg = config('C:\\synthetic\\chrome.exe', 'C:\\synthetic\\owned', 12100);
  const child = Object.assign(new EventEmitter(), {
    pid: 41205,
    exitCode: null as number | null,
    killed: false,
    signalCode: null as string | null,
    kill() { this.killed = true; return true; }
  });

  try {
    t.mock.method(launcher, 'preflightChrome', async () => ({
      ok: true as const, status: 'PATH_AND_PORT_CHECKED_ONLY' as const,
      config: cfg, runtimeIdentityVerified: false as const
    }));
    t.mock.method(launcher, 'inspectWindowsChromeBinary', async () => ({
      ok: true as const, status: 'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version: '155.0.1.1', publisher: 'Google LLC' as const,
      runtimeVerified: false as const
    }));
    t.mock.method(cp, 'spawn', () => {
      setImmediate(() => {
        child.exitCode = 1;
        child.emit('exit', 1);
      });
      return child as unknown as import('node:child_process').ChildProcess;
    });

    const result = await launchApprovedIsolatedChrome(cfg, { userApproved: true });
    assert.deepEqual(result, { ok: false, code: 'LAUNCH_FAILED' });
  } finally {
    t.mock.reset();
  }
});



test('TASK-005/TEST-007/009/026: graceful close rechecks the original listener PID before Browser.close',async t=>{
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const cp=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\owned-close',12189);
  const child=Object.assign(new EventEmitter(),{
    pid:41889,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let ownerChecks=0,closeCalls=0;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,runtimeVerified:false as const
    }));
    t.mock.method(cp,'spawn',()=>child as unknown as import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async(port:number,pid:number)=>{
      assert.equal(port,12189);
      assert.equal(pid,41889);
      ownerChecks++;
      return {ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
        pid:41889,executableVerified:false as const};
    });
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>true);
    t.mock.method(cdp,'requestVerifiedCdpBrowserClose',async()=>{
      closeCalls++;
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({
      Browser:'Chrome/155.0.1.1',
      webSocketDebuggerUrl:'ws://127.0.0.1:12189/devtools/browser/abcdefgh-1234'
    })));

    const session=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.equal(session.ok,true,JSON.stringify(session));
    if(!session.ok)return;
    const initialChecks=ownerChecks;
    assert.equal(initialChecks,1,'launch must establish listener ownership once');
    assert.equal(typeof session.closeGracefully,'function');
    const closed=await session.closeGracefully!();
    assert.equal(closed,true);
    assert.equal(ownerChecks,initialChecks+1,
      'shutdown must re-check that the same PID still owns the CDP listener');
    assert.equal(closeCalls,1,
      'Browser.close is allowed only after the fresh listener-owner proof');
  }finally{
    t.mock.reset();
  }
});
