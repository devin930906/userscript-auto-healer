import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { importApprovedPaths, importDroppedBytes, scanApprovedDirectory, type ImportedScript, type ReadOnlyImportProgress } from '../../src/import/import-service';
import {previewImportedScriptAnalysis,type ImportAnalysisPreview} from '../../src/analyze/import-preview';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';
import {runCheckpointedNativeImportAnalysis} from '../../src/jobs/native-checkpointed-import';
import { basename, dirname, join, win32 } from 'node:path';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateBrowserConfig } from '../../src/security/browser-config';
import { DESKTOP_WEB_PREFERENCES, SHELL_STATUS, trustedMainFrame } from '../../src/security/desktop-policy';
import { launchApprovedIsolatedChrome, isLiveApprovedChromeSession, type ManagedLaunchResult } from '../../src/browser/owned-chrome';
import { prepareApprovedIsolatedProfile } from '../../src/browser/chrome-launcher';
import { inspectApprovedTampermonkeyRuntime } from '../../src/manager/tampermonkey-adapter';
import { startApprovedTampermonkeyDiagnostic, type ManualTampermonkeyDiagnosticSession } from '../../src/manager/tampermonkey-diagnostic';
import {isSupportedGmProbeRunAt} from '../../src/manager/tampermonkey-gm-probe';
import {createLimitedGmReport,saveLimitedGmReportOnly} from '../../src/manager/gm-report';
import {DesktopScenarioSession} from '../../src/scenarios/desktop-session';
import {openApprovedTarget} from '../../src/browser/cdp-target';
import {inspectApprovedScenarioDomSeries,summarizeReadOnlyScenarioDomSeries} from '../../src/diagnostics/scenario-dom-diagnostic';
import {observeApprovedDomSeries} from '../../src/observe/dom-observer';
import {exportReviewedImportedSelectorOnly} from '../../src/repair/imported-manual-export';
import {inspectApprovedPageExceptions} from '../../src/diagnostics/cdp-page-exceptions';
import {LimitedHealthRegistry} from '../../src/health/health-registry';
import {recordLimitedScenarioInspection} from '../../src/health/scenario-inspection';
import {readLimitedHealthArchive,saveLimitedHealthArchive} from '../../src/health/limited-health-archive';
import {limitedScenarioHistoryKey,readLimitedSessionHistory} from '../../src/health/session-history';
import {createExclusiveOwnedDiagnosticGate} from '../../src/browser/diagnostic-operation-gate';
import {prepareManualOriginalRestoreSelection} from '../../src/version/manual-restore-selection';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentReadOnly} from '../../src/version/restore-intent-inspection';
import {inspectNativeRestoreIntentInventoryReadOnly} from '../../src/version/restore-intent-inventory';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';

let mainWindow: BrowserWindow | null = null;
// A new window gets a fresh read-only scenario scope; no disk persistence.
let scenarioSession=new DesktopScenarioSession();
// No disk persistence, no manager or business authority, fresh per window.
let limitedScenarioHistory=new LimitedHealthRegistry();
// Native-picked paths stay strictly in the privileged process. A renderer
// may only refer to an already registered scenario ID, never a source path.
const nativeImportedPaths=new Map<string,string>();
let manualExportInProgress=false;
// New independent files can already exist after final native write consent.
// Never acknowledge cancellation that cannot unwind the write operation.
let manualExportCommitInProgress=false;
const diagnosticGate=createExclusiveOwnedDiagnosticGate();
let scenarioObserveController:AbortController|null=null;
let scenarioObserveInProgress=false;
let scenarioObserveEpoch=0;
function cancelScenarioObservation():void{
  scenarioObserveEpoch++;
  scenarioObserveController?.abort();
}
const uiFile = join(__dirname, '..', 'ui', 'index.html');
const trustedUrl = pathToFileURL(uiFile).href;

// Paths are issued ONLY by native OS file/directory selectors. Renderer input
// never supplies an executable, profile path, CDP URL or process ID.
let selectedChrome: string | null = null;
let selectedProfile: string | null = null;
let ownedBrowser: Extract<ManagedLaunchResult,{ok:true}> | null = null;
let launchInProgress = false;
let profilePreparationInProgress = false;
let launchAbort: AbortController | null = null;
let probeInProgress = false;
// Serialize native Chrome/Profile selection: IPC dialogs must not race each other
// or a consented browser launch. This flag is not proof of user authorization.
let nativeSelectionInProgress = false;
// Only one native picker/import batch can own this cancellation capability.
// It never authorizes a script change, a Chrome launch, or privileged file IPC.
let nativeImportController: AbortController | null = null;
type NativeImportCounters=Readonly<{
  phase:'PICKING'|'SCANNING'|'IMPORTING'|'ANALYZING';
  processed:number;total:number;accepted:number;duplicates:number;failed:number;
}>;
// No paths, source data, digest, browser state or authorization is exposed.
let nativeImportCounters:NativeImportCounters|null=null;
// The renderer can cancel its current read-only dropped-file AST preview.
// Never grant arbitrary-path, manager or script-write authority through this.
let droppedImportController: AbortController | null = null;
let gmProbeSession: ManualTampermonkeyDiagnosticSession | null = null;
let gmStartInProgress = false;
let gmStartAbort: AbortController | null = null;
let gmActionInProgress = false;
let gmReportInProgress = false;
let gmProbeEpoch = 0;
/** Revokes the application's short-lived HTTP fixture without touching any
 * extension or installed script. Manual removal remains the tester's duty. */
function stopOnlyGmProbe():void {
  gmProbeEpoch++;
  gmStartAbort?.abort();
  const active=gmProbeSession;
  gmProbeSession=null;
  if(active)void active.stop().catch(()=>undefined);
}
function liveGmProbe():ManualTampermonkeyDiagnosticSession|null {
  if(gmProbeSession&&Date.now()>=gmProbeSession.expiresAt)
    stopOnlyGmProbe();
  return gmProbeSession;
}
const unverified = {tampermonkeyVerified:false as const,gmApiVerified:false as const,
  businessVerified:false as const,automaticPatchAllowed:false as const};

function stopOnlyOwnedBrowser():void {
  cancelScenarioObservation();
  stopOnlyGmProbe();
  launchAbort?.abort();
  if(ownedBrowser){ownedBrowser.stop();ownedBrowser=null;}
}
function readOwnedBrowser(){
  if(ownedBrowser && !isLiveApprovedChromeSession(ownedBrowser)){
    // Defensive fallback when a child exits before its lifecycle notification.
    ownedBrowser=null;
    cancelScenarioObservation();
    stopOnlyGmProbe();
  }
  return ownedBrowser;
}


function authorizeSender(event: Electron.IpcMainInvokeEvent): void {
  const win = mainWindow;
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || !frame ||
      event.sender !== win.webContents ||
      frame !== win.webContents.mainFrame ||
      !trustedMainFrame(frame.url, trustedUrl, true)) {
    throw new Error('UNAUTHORIZED_RENDERER');
  }
}

function summarize(script: ImportedScript, analysis: ImportAnalysisPreview = previewImportedScriptAnalysis(script)) {
  return {filename:script.filename, byteLength:script.byteLength,
    sha256:script.sha256, textEncoding:script.textEncoding,
    analysis};
}
async function summarizeResult(result: Awaited<ReturnType<typeof importApprovedPaths>>,
  signal?:AbortSignal,onProgress?:(processed:number,total:number)=>void,
  nativeJournalRoot?:string) {
  // Only the native OS picker may opt into persistence. Dropped bytes still
  // use the existing ephemeral, read-only worker; no renderer path is trusted.
  const checkpoint=nativeJournalRoot&&result.scripts.length>0
    ?await runCheckpointedNativeImportAnalysis(nativeJournalRoot,
      result.scripts,signal,onProgress)
    :undefined;
  const previews=checkpoint?.previews??
    await runImportedReadOnlyAnalysisQueue(result.scripts,signal,onProgress);
  return {batchCheckpoint:checkpoint?.status,
    batchCheckpointReason:checkpoint?.status==='BLOCKED'?checkpoint.reason:undefined,
    batchResumed:checkpoint?.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'
      ?checkpoint.resumed:false,
    canceled:result.canceled===true||signal?.aborted===true,
    unprocessed:result.unprocessed??0,
    scripts:result.scripts.map((script,i)=>summarize(script,previews[i])),
    errors:result.errors, duplicates:result.duplicates};
}
function registerSafeIpc(): void {
  // No general invoke/channel/payload gateway; no file reading, shell access or script execution.
  ipcMain.handle('app:status', (event) => {
    authorizeSender(event);
    return SHELL_STATUS;
  });
  ipcMain.handle('config:validate', (event, input: unknown) => {
    authorizeSender(event);
    return validateBrowserConfig(input);
  });
  // Chromium selection and lifecycle remain native-only. The renderer can
  // request an action, but cannot pass paths, PIDs, Chromium switches or CDP.
  ipcMain.handle('browser:choose-chrome',async event=>{
    authorizeSender(event);
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
        manualExportInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY'};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    nativeSelectionInProgress=true;
    try{
    const choice=await dialog.showOpenDialog(win,{
      title:'选择独立 Chrome 或便携版 chrome.exe',
      properties:['openFile'],filters:[{name:'Google Chrome',extensions:['exe']}]
    });
    if(choice.canceled||choice.filePaths.length!==1)return {ok:false,code:'CANCELLED'};
    const path=choice.filePaths[0];
    if(win!==mainWindow||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    if(win32.basename(path).toLowerCase()!=='chrome.exe')
      return {ok:false,code:'INVALID_EXECUTABLE'};
    selectedChrome=path;
    return {ok:true,status:'NATIVE_PATH_SELECTED_ONLY',filename:'chrome.exe',
      verifiedOnDisk:false};
    }finally{nativeSelectionInProgress=false;}
  });
  ipcMain.handle('browser:choose-profile',async event=>{
    authorizeSender(event);
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
        manualExportInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY'};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    nativeSelectionInProgress=true;
    try{
    const choice=await dialog.showOpenDialog(win,{
      title:'选择已有的独立调试 Profile 文件夹（不要选日常 Chrome 用户目录）',
      properties:['openDirectory']
    });
    if(choice.canceled||choice.filePaths.length!==1)return {ok:false,code:'CANCELLED'};
    if(win!==mainWindow||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    selectedProfile=choice.filePaths[0];
    return {ok:true,status:'NATIVE_PATH_SELECTED_ONLY',
      directoryName:win32.basename(selectedProfile),verifiedOnDisk:false};
    }finally{nativeSelectionInProgress=false;}
  });
  ipcMain.handle('browser:create-profile',async event=>{
    authorizeSender(event);
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
        manualExportInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())
      return {ok:false,code:'BROWSER_BUSY'};
    if(!selectedChrome)return {ok:false,code:'CONFIG_NOT_SELECTED'};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    profilePreparationInProgress=true;
    try{
      // Only a user-selected existing parent is accepted; the child is a
      // new unpredictable application-specific name, never renderer input.
      const picked=await dialog.showOpenDialog(win,{
        title:'选择用于创建全新独立 Chrome Profile 的父文件夹',
        properties:['openDirectory']
      });
      if(picked.canceled||picked.filePaths.length!==1)
        return {ok:false,code:'CANCELLED'};
      if(win!==mainWindow||win.isDestroyed())
        return {ok:false,code:'NO_WINDOW'};
      const candidate=win32.join(picked.filePaths[0],'uah-profile-'+randomUUID());
      const config=validateBrowserConfig({
        executablePath:selectedChrome,userDataDir:candidate,
        remoteDebuggingPort:9223,bindAddress:'127.0.0.1'
      });
      if(!config.ok)return {ok:false,code:config.code};
      const consent=await dialog.showMessageBox(win,{
        type:'question',buttons:['创建全新空目录','取消'],defaultId:1,cancelId:1,
        noLink:true,message:'创建新的独立 Chrome 调试 Profile？',
        detail:'只在所选父目录中新建一个随机命名的空目录。'+
          '\\n不会复制、迁移、覆盖或删除任何现有 Chrome Profile。'+
          '\\n目标目录: '+candidate
      });
      if(consent.response!==0||win!==mainWindow||win.isDestroyed())
        return {ok:false,code:'NOT_AUTHORIZED'};
      const prepared=await prepareApprovedIsolatedProfile(config.config,true);
      if(!prepared.ok)return {ok:false,code:prepared.code};
      if(win!==mainWindow||win.isDestroyed())
        return {ok:false,code:'WINDOW_CLOSED_PROFILE_PRESERVED'};
      selectedProfile=prepared.userDataDir;
      return {ok:true,status:'EMPTY_PROFILE_CREATED',directoryName:win32.basename(selectedProfile),
        verifiedOnDisk:true};
    }catch{
      return {ok:false,code:'PROFILE_CREATE_FAILED'};
    }finally{profilePreparationInProgress=false;}
  });
  ipcMain.handle('browser:start',async (event,port:unknown)=>{
    authorizeSender(event);
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
        manualExportInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY',...unverified};
    if(!selectedChrome||!selectedProfile)
      return {ok:false,code:'CONFIG_NOT_SELECTED',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    // Validate before asking for permission; never launch on an invalid port
    // or a structurally unsafe Chrome/Profile combination.
    const config=validateBrowserConfig({
      executablePath:selectedChrome,userDataDir:selectedProfile,
      remoteDebuggingPort:port,bindAddress:'127.0.0.1'
    });
    if(!config.ok)return {ok:false,code:config.code,...unverified};
    launchInProgress=true;
    const controller=new AbortController();
    launchAbort=controller;
    try{
      // A renderer-originated IPC invoke is NOT authenticated user consent.
      // Require an explicit, independent native dialog for each launch.
      const decision=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许启动独立 Chrome','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'确认启动隔离的 Chrome 调试实例？',
        detail:'仅使用所选 chrome.exe 与独立 Profile，CDP 绑定 127.0.0.1。'+
          '\\n不会接管日常浏览器、安装脚本或启用自动修复。'+
          '\\nChrome: '+selectedChrome+'\\nProfile: '+selectedProfile+
          '\\nPort: '+port
      });
      if(decision.response!==0||controller.signal.aborted||win.isDestroyed()||
         win!==mainWindow)
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      let launched:Extract<ManagedLaunchResult,{ok:true}>|null=null;
      const result=await launchApprovedIsolatedChrome(config.config,{
        userApproved:true,signal:controller.signal,
        onUnexpectedExit:()=>{
          // Never revoke a later replacement session on an older child exit.
          if(ownedBrowser===launched){ownedBrowser=null;cancelScenarioObservation();stopOnlyGmProbe();}
        }
      });
      if(!result.ok)return {ok:false,code:result.code,...unverified};
      launched=result;
      if(controller.signal.aborted||win.isDestroyed()||win!==mainWindow){
        result.stop();
        return {ok:false,code:'ABORTED',...unverified};
      }
      ownedBrowser=result;
      return {ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',
        chromeVersion:result.chromeVersion,
        targetVerified:false,...unverified};
    }catch{
      return {ok:false,code:'LAUNCH_FAILED',...unverified};
    }finally{
      launchInProgress=false;
      if(launchAbort===controller)launchAbort=null;
    }
  });
  ipcMain.handle('browser:tampermonkey-hint',async event=>{
    authorizeSender(event);
    if(probeInProgress)return {ok:false,code:'PROBE_BUSY',...unverified};
    const owned=readOwnedBrowser();
    if(!owned)return {ok:false,code:'BROWSER_NOT_RUNNING',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    probeInProgress=true;
    try{
      const decision=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许只读探测','取消'],defaultId:1,cancelId:1,
        noLink:true,message:'检查独立 Chrome 中的 Tampermonkey 运行目标？',
        detail:'只读取当前由本程序启动的浏览器 CDP 目标信息。'+
          '\\n不会读取或修改任何已安装脚本，也不证明 GM API 或业务恢复。'
      });
      if(decision.response!==0||!isLiveApprovedChromeSession(owned)||
         win.isDestroyed()||win!==mainWindow)
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const status=await inspectApprovedTampermonkeyRuntime(owned,true);
      if(!status.ok)return {...status,...unverified};
      return {ok:true,status:status.status,manager:status.manager,
        matchedRuntimeTargets:status.matchedRuntimeTargets,
        extensionAuthenticityVerified:false,scriptInstallationVerified:false,
        ...unverified};
    }catch{
      return {ok:false,code:'PROBE_FAILED',...unverified};
    }finally{probeInProgress=false;}
  });
  ipcMain.handle('browser:stop',event=>{
    authorizeSender(event);
    if(!readOwnedBrowser()&&!launchInProgress)
      return {ok:false,code:'BROWSER_NOT_RUNNING'};
    stopOnlyOwnedBrowser();
    return {ok:true,status:'OWNED_BROWSER_STOP_REQUESTED'};
  });

  // The only fixture is a bounded, local, independently consented manual
  // test. No caller-provided URL, extension path, source, token or GM code.
  ipcMain.handle('gm-probe:start',async (event,runAt:unknown)=>{
    authorizeSender(event);
    if(runAt!==undefined&&!isSupportedGmProbeRunAt(runAt))
      return {ok:false,code:'INVALID_OPTIONS',...unverified};
    const selectedRunAt=runAt??'document-idle';
    if(gmStartInProgress||liveGmProbe())return {ok:false,code:'PROBE_BUSY',...unverified};
    const owned=readOwnedBrowser();
    if(!owned)return {ok:false,code:'BROWSER_NOT_RUNNING',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    const lease=diagnosticGate.reserve();
    if(lease===null)return {ok:false,code:'PROBE_BUSY',...unverified};
    gmStartInProgress=true;
    const epoch=gmProbeEpoch;
    const controller=new AbortController();
    gmStartAbort=controller;
    try{
      const decision=await dialog.showMessageBox(win,{
        type:'warning',buttons:['允许临时本机测试','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'允许启动独立 Tampermonkey 手动 GM 测试夹具？',
        detail:'仅开放一个最长五分钟的 127.0.0.1 测试网页和临时脚本地址。'+
          '\\n本次脚本注入时机：'+selectedRunAt+'（仍需实际 Tampermonkey 验证）。'+
          '\\n您需要自行在本程序拥有的独立 Chrome Profile 中安装脚本、访问 broken/fixed 测试页。'+
          '\\n测试结束后必须手动卸载临时脚本；本程序不会读取或修改已有脚本。'+
          '\\n页面回执可能被伪造，不能据此确认真实 Tampermonkey、GM API 或业务恢复。'
      });
      if(decision.response!==0||win!==mainWindow||win.isDestroyed()||
         epoch!==gmProbeEpoch||!isLiveApprovedChromeSession(owned))
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      // Verify a runtime target hint inside this exact owned browser BEFORE
      // exposing the disposable fixture. The hint is never manager attestation.
      const created=await startApprovedTampermonkeyDiagnostic(owned,true,{
        ttlMs:300000,signal:controller.signal,
        runAt:selectedRunAt as 'document-start'|'document-body'|'document-end'|'document-idle'
      });
      if(!created.ok)return {ok:false,code:created.code,...unverified};
      if(epoch!==gmProbeEpoch||win!==mainWindow||win.isDestroyed()||
         !isLiveApprovedChromeSession(owned)){
        await created.session.stop();
        return {ok:false,code:'SESSION_REVOKED',...unverified};
      }
      gmProbeSession=created.session;
      // The only capability URL exposed is this one-time local address,
      // after native consent. Never send script source or receipt tokens.
      return {ok:true,status:'MANUAL_FIXTURE_READY_ONLY',
        runAt:created.session.runAt,
        installUrl:created.session.installUrl,
        brokenUrl:created.session.origin+'/?mode=broken',
        fixedUrl:created.session.origin+'/?mode=fixed',
        expiresAt:created.session.expiresAt,...unverified};
    }catch{
      return {ok:false,code:'PROBE_FAILED',...unverified};
    }finally{
      gmStartInProgress=false;
      if(gmStartAbort===controller)gmStartAbort=null;
      diagnosticGate.release(lease);
    }
  });
  ipcMain.handle('gm-probe:status',event=>{
    authorizeSender(event);
    const active=liveGmProbe();
    if(!active||!readOwnedBrowser())
      return {ok:false,code:'NO_ACTIVE_FIXTURE',...unverified};
    // Correlate independent, read-only CDP DOM observations with the
    // self-reported HTTP receipts. Never elevate the result to VERIFIED.
    const summary=active.snapshot();
    const consistency=active.consistencySnapshot();
    const dom=active.domSnapshot();
    return {ok:true,status:'UNVERIFIED_FIXTURE_CORRELATION_ONLY',
      expiresAt:active.expiresAt,
      observedModes:summary.observedModes,
      reportedGmDefaultMatched:summary.reportedGmDefaultMatched,
      reportedGmStorageRoundtripMatched:summary.reportedGmStorageRoundtripMatched,
      reportedBrokenFailed:summary.reportedBrokenFailed,
      reportedFixedRecovered:summary.reportedFixedRecovered,
      consistencyStatus:consistency.status,comparedModes:consistency.comparedModes,
      brokenDomAction:dom.broken?.actionCount??null,
      fixedDomAction:dom.fixed?.actionCount??null,...unverified};
  });
  // Native-only bounded manual QA handoff. No report body, userscript source,
  // token, selected path or arbitrary file-write IPC ever reaches the renderer.
  ipcMain.handle('gm-probe:save-report',async event=>{
    authorizeSender(event);
    if(gmReportInProgress||gmStartInProgress||gmActionInProgress)
      return {ok:false,code:'PROBE_BUSY',...unverified};
    const active=liveGmProbe();
    if(!active||!readOwnedBrowser())
      return {ok:false,code:'NO_ACTIVE_FIXTURE',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())
      return {ok:false,code:'NO_WINDOW',...unverified};
    const epoch=gmProbeEpoch;
    gmReportInProgress=true;
    try{
      const selected=await dialog.showSaveDialog(win,{
        title:'将未经认证的 GM 测试摘要另存为 JSON（不覆盖已有文件）',
        defaultPath:'UAH-GM-Fixture-Unverified.json',
        filters:[{name:'JSON 报告',extensions:['json']}]
      });
      if(selected.canceled||!selected.filePath)
        return {ok:false,code:'CANCELLED',...unverified};
      if(epoch!==gmProbeEpoch||active!==liveGmProbe()||
         win!==mainWindow||win.isDestroyed()||!readOwnedBrowser())
        return {ok:false,code:'SESSION_REVOKED',...unverified};
      const approved=await dialog.showMessageBox(win,{
        type:'question',buttons:['保存未认证报告','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'确认保存此本机测试报告？',
        detail:'只包含预设 broken/fixed 自报状态、有限 DOM 对照、测试时间及本程序已核验 Chrome 版本。'+
          '\\n不会包含脚本源码、测试 URL 令牌、Chrome/Profile 路径或网站私密资料。'+
          '\\n不会覆盖任何现有文件。报告不证明 Tampermonkey、GM API 或业务恢复。'
      });
      if(approved.response!==0||epoch!==gmProbeEpoch||
         active!==liveGmProbe()||win!==mainWindow||win.isDestroyed()||
         !readOwnedBrowser())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const report=createLimitedGmReport(active);
      if(report.status!=='UNVERIFIED_REPORT_READY')
        return {ok:false,code:'INVALID_EVIDENCE',...unverified};
      const saved=await saveLimitedGmReportOnly(report.report,selected.filePath,true);
      if(saved.status!=='REPORT_SAVED_UNVERIFIED_ONLY')
        return {ok:false,code:saved.code,...unverified};
      return {ok:true,status:'UNVERIFIED_REPORT_SAVED_ONLY',
        fileName:saved.fileName,sha256:saved.sha256,
        byteLength:saved.byteLength,...unverified};
    }catch{
      return {ok:false,code:'REPORT_SAVE_FAILED',...unverified};
    }finally{gmReportInProgress=false;}
  });
  // Renderer can request only an exact fixture mode, never an arbitrary URL,
  // target, selector, browser, script source or path. Native consent is separate.
  ipcMain.handle('gm-probe:visit',async(event,mode:unknown)=>{
    authorizeSender(event);
    if(mode!=='broken'&&mode!=='fixed')
      return {ok:false,code:'INVALID_MODE',...unverified};
    if(gmActionInProgress)return {ok:false,code:'PROBE_BUSY',...unverified};
    const active=liveGmProbe();
    if(!active||!readOwnedBrowser())
      return {ok:false,code:'NO_ACTIVE_FIXTURE',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    const lease=diagnosticGate.reserve();
    if(lease===null)return {ok:false,code:'PROBE_BUSY',...unverified};
    const epoch=gmProbeEpoch;
    gmActionInProgress=true;
    try{
      const decision=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许打开测试页','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'允许在独立 Chrome 打开 '+mode+' 测试页？',
        detail:'只会在本程序已验证归属的 Chrome 中打开本机一次性测试页。'+
          '\\n不会安装脚本或证明 Tampermonkey/GM API 功能。'
      });
      if(decision.response!==0||epoch!==gmProbeEpoch||
         win!==mainWindow||win.isDestroyed()||active!==liveGmProbe())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const result=await active.visit(mode,true);
      if(epoch!==gmProbeEpoch||active!==liveGmProbe())
        return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(!result.ok)return {ok:false,code:result.code,...unverified};
      return {ok:true,status:result.status,mode:result.mode,...unverified};
    }catch{
      return {ok:false,code:'VISIT_FAILED',...unverified};
    }finally{
      gmActionInProgress=false;
      diagnosticGate.release(lease);
    }
  });
  ipcMain.handle('gm-probe:observe',async(event,mode:unknown)=>{
    authorizeSender(event);
    if(mode!=='broken'&&mode!=='fixed')
      return {ok:false,code:'INVALID_MODE',...unverified};
    if(gmActionInProgress)return {ok:false,code:'PROBE_BUSY',...unverified};
    const active=liveGmProbe();
    if(!active||!readOwnedBrowser())
      return {ok:false,code:'NO_ACTIVE_FIXTURE',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    const lease=diagnosticGate.reserve();
    if(lease===null)return {ok:false,code:'PROBE_BUSY',...unverified};
    const epoch=gmProbeEpoch;
    gmActionInProgress=true;
    try{
      const decision=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许只读对照','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'允许只读检查 '+mode+' 专用测试页的 DOM？',
        detail:'仅检查本次测试页的四个固定选择器与动作标记。'+
          '\\n结果只能证明 DOM 对照状态，不能证明 GM API 或脚本来源。'
      });
      if(decision.response!==0||epoch!==gmProbeEpoch||
         win!==mainWindow||win.isDestroyed()||active!==liveGmProbe())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const result=await active.observe(mode,true);
      if(epoch!==gmProbeEpoch||active!==liveGmProbe())
        return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(!result.ok)return {ok:false,code:result.code,...unverified};
      return {ok:true,status:'LIMITED_FIXTURE_DOM_ONLY',
        mode:result.evidence.mode,actionCount:result.evidence.actionCount,
        fixtureDomMatchesExpected:result.evidence.fixtureDomMatchesExpected,
        ...unverified};
    }catch{
      return {ok:false,code:'OBSERVATION_FAILED',...unverified};
    }finally{
      gmActionInProgress=false;
      diagnosticGate.release(lease);
    }
  });
  ipcMain.handle('gm-probe:stop',event=>{
    authorizeSender(event);
    const existed=gmStartInProgress||Boolean(gmProbeSession);
    stopOnlyGmProbe();
    return {ok:existed,status:existed?'FIXTURE_STOP_REQUESTED':'NO_ACTIVE_FIXTURE',
      ...unverified};
  });

  // TASK-011: read-only scan of native-selected recovery intent directory.
  // No user path, hash, script bytes, journal filename or write authority IPC.
  ipcMain.handle('restore:inspect-inventory',async(event,...args:unknown[])=>{
    authorizeSender(event);
    if(args.length)return {ok:false,code:'INVALID_REQUEST',...unverified};
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
       manualExportInProgress||scenarioObserveInProgress||launchInProgress||
       profilePreparationInProgress||gmActionInProgress||gmStartInProgress||
       readOwnedBrowser())
      return {ok:false,code:'RESTORE_BUSY',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    nativeSelectionInProgress=true;
    const revoked=()=>win!==mainWindow||win.isDestroyed();
    try{
      const consent=await dialog.showMessageBox(win,{
        type:'info',buttons:['只读扫描恢复目录','取消'],defaultId:1,cancelId:1,
        noLink:true,message:'只读核对该脚本对应的恢复意图目录？',
        detail:'请独立选择本地 .user.js 原文件及此前保存恢复意图的文件夹。'
          +'\n最多检查 32 份意图、1024 个目录条目；无法验证的记录只统计为拒绝。'
          +'\n不移动、删除、修改文件，不执行脚本，也不自动回滚。'
      });
      if(consent.response!==0||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const source=await dialog.showOpenDialog(win,{
        title:'只读批量核对：选择本地 .user.js 原文件',
        properties:['openFile'],filters:[{name:'Userscript',extensions:['js']}]
      });
      if(source.canceled||source.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const backupDirectory=await dialog.showOpenDialog(win,{
        title:'只读批量核对：选择已有的恢复意图和独立备份文件夹',
        properties:['openDirectory']
      });
      if(backupDirectory.canceled||backupDirectory.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const report=await inspectNativeRestoreIntentInventoryReadOnly({
        sourcePath:source.filePaths[0],
        backupDirectory:backupDirectory.filePaths[0],userApproved:true
      });
      if(revoked())return {ok:false,code:'WINDOW_CLOSED',...unverified};
      if(report.status!=='RESTORE_INTENT_INVENTORY_READ_ONLY')
        return {ok:false,code:report.reason,...unverified};
      return {ok:true,status:report.status,
        inspected:report.inspected,originalPresent:report.originalPresent,
        displacedPresent:report.displacedPresent,rejected:report.rejected,
        ...unverified};
    }catch{return {ok:false,code:'INSPECTION_FAILED',...unverified};}
    finally{nativeSelectionInProgress=false;}
  });

  // TASK-011/TEST-020/026: explicit read-only recovery reconciliation.
  // No renderer-supplied paths/bytes, user approval booleans or write operations.
  // Two independent native file selections are bound by the existing journal
  // verifier to the precise source and to BOTH independently verified backups.
  ipcMain.handle('restore:inspect-intent',async(event,...args:unknown[])=>{
    authorizeSender(event);
    if(args.length)return {ok:false,code:'INVALID_REQUEST',...unverified};
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
       manualExportInProgress||scenarioObserveInProgress||launchInProgress||
       profilePreparationInProgress||gmActionInProgress||gmStartInProgress||
       readOwnedBrowser())
      return {ok:false,code:'RESTORE_BUSY',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    nativeSelectionInProgress=true;
    const revoked=()=>win!==mainWindow||win.isDestroyed();
    try{
      const consent=await dialog.showMessageBox(win,{
        type:'info',buttons:['只读核对','取消'],defaultId:1,cancelId:1,noLink:true,
        message:'只读核对已有的恢复意图（不会写入）',
        detail:'请依次选择当前的 .user.js 脚本，以及本工具先前保存的'
          +' .uah-restore-*.journal.json 恢复意图文件。'
          +'\\n系统会独立验证原版与被替换版本的备份。'
          +'\\n不会复制、覆盖、修改文件、安装脚本或授权自动重试。'
      });
      if(consent.response!==0||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const selectedSource=await dialog.showOpenDialog(win,{
        title:'只读核对：选择目前的 .user.js 原文件',
        properties:['openFile'],filters:[{name:'Userscript',extensions:['js']}]
      });
      if(selectedSource.canceled||selectedSource.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const journalSelection=await dialog.showOpenDialog(win,{
        title:'只读核对：选择先前生成的 .uah-restore-*.journal.json 意图文件',
        properties:['openFile'],filters:[{name:'Restore intent',extensions:['json']}]
      });
      if(journalSelection.canceled||journalSelection.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const observed=await inspectNativeRestoreIntentReadOnly({
        sourcePath:selectedSource.filePaths[0],
        backupDirectory:dirname(journalSelection.filePaths[0]),
        journalFileName:basename(journalSelection.filePaths[0]),
        userApproved:true
      });
      if(revoked())return {ok:false,code:'WINDOW_CLOSED',...unverified};
      if(observed.status!=='RESTORE_INTENT_OBSERVED_READ_ONLY')
        return {ok:false,code:observed.reason,...unverified};
      // Return a fixed classification only, never source paths, journals,
      // recovery digests, contents or the ability to change the source.
      return {ok:true,status:'RESTORE_INTENT_OBSERVED_READ_ONLY',
        sourceState:observed.sourceState,...unverified};
    }catch{return {ok:false,code:'INSPECTION_FAILED',...unverified};}
    finally{nativeSelectionInProgress=false;}
  });

  // TASK-011: explicit manual *original* restore only. The renderer sends no
  // paths, hashes, bytes, backup selection, or approval flags. Every file is
  // independently native-picked; this action never applies repair candidates
  // or changes a Tampermonkey installed extension/script automatically.
  ipcMain.handle('restore:manual-original',async(event,...args:unknown[])=>{
    authorizeSender(event);
    if(args.length)return {ok:false,code:'INVALID_REQUEST',...unverified};
    if(nativeSelectionInProgress||nativeImportController||droppedImportController||
       manualExportInProgress||scenarioObserveInProgress||launchInProgress||
       profilePreparationInProgress||gmActionInProgress||gmStartInProgress||
       readOwnedBrowser())
      return {ok:false,code:'RESTORE_BUSY',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    // Serialized through the existing cross-module native-picking gate, so
    // other privileged pickers and imports cannot overlap this restore.
    nativeSelectionInProgress=true;
    const revoked=()=>win!==mainWindow||win.isDestroyed();
    try{
      const initial=await dialog.showMessageBox(win,{
        type:'warning',buttons:['选择原文件和独立备份','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'手动恢复原始脚本（会覆盖您选定的文件）',
        detail:'仅在已保存可信独立原版备份、且您明确要求手动恢复时使用。'
          +'\n此功能不会更新 Tampermonkey 内已安装的脚本。'
          +'\n必须先在文件系统中独立保存当前版本；随后仍需再次确认实际覆盖。'
          +'\n请先关闭可能编辑该脚本的外部程序。'
      });
      if(initial.response!==0||revoked())return {ok:false,code:'CANCELLED',...unverified};
      const source=await dialog.showOpenDialog(win,{
        title:'手动恢复：选择要被替换的当前 .user.js 脚本',
        properties:['openFile'],filters:[{name:'Userscript',extensions:['js']}]
      });
      if(source.canceled||source.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const backup=await dialog.showOpenDialog(win,{
        title:'手动恢复：选择本应用生成的原版 .backup.user.js 文件',
        properties:['openFile'],filters:[{name:'Userscript backup',extensions:['js']}]
      });
      if(backup.canceled||backup.filePaths.length!==1||revoked())
        return {ok:false,code:'CANCELLED',...unverified};
      const prepared=await prepareManualOriginalRestoreSelection(
        source.filePaths[0],backup.filePaths[0]);
      if(revoked())return {ok:false,code:'WINDOW_CLOSED',...unverified};
      if(prepared.status!=='AWAITING_NATIVE_RESTORE_CONSENT')
        return {ok:false,code:prepared.reason,...unverified};
      // Final OS dialog is the source of consent. No serialized renderer
      // bool can authorize a write; hashes are rechecked inside transaction.
      const approved=await dialog.showMessageBox(win,{
        type:'warning',buttons:['恢复原始文件并备份当前版本','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'最终确认：这将覆盖选中的原始脚本文件',
        detail:'被替换文件：'+prepared.sourcePath+
          '\n确认原版备份：'+backup.filePaths[0]+
          '\n当前 SHA-256：'+prepared.expectedCurrentSha256+
          '\n待恢复 SHA-256：'+prepared.expectedOriginalSha256+
          '\n程序会先在备份目录独立保存当前字节并写入恢复意图，再尝试原子替换。'
          +'\n这是本机手动恢复，不是自动修复、Tampermonkey GM 或业务验收。'
      });
      if(approved.response!==0||revoked())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      // No extra await between final consent and the transaction. The lock,
      // source/backup content, pathname identity and consent are revalidated
      // again by the native-only implementation immediately before rename.
      const {status:_status,...selection}=prepared;
      const result=await restoreVerifiedOriginalNativeOnly({
        ...selection,userApproved:true,manualRestoreApproved:true
      });
      if(result.status!=='RESTORED_NATIVE_ONLY')
        return {ok:false,code:result.reason,...unverified};
      return {ok:true,status:'RESTORED_NATIVE_ONLY',
        journalFileName:result.journalFileName,
        displacedBackupFileName:result.displacedBackupFileName,
        ...unverified};
    }catch{
      return {ok:false,code:'RESTORE_FAILED',...unverified};
    }finally{nativeSelectionInProgress=false;}
  });

  // Every path MUST come from the native OS picker, not renderer-provided input.
  // The renderer may request a picker, but cannot supply filesystem paths.
  // Keep the native-selected batch cancellable between bounded file reads.
  const runNativeImport = async (event: Electron.IpcMainInvokeEvent, kind: 'files'|'folder') => {
    authorizeSender(event);
    if(nativeImportController||droppedImportController||manualExportInProgress||
        nativeSelectionInProgress||profilePreparationInProgress||launchInProgress)
      return {canceled:false,scripts:[],errors:[{filename:'(selection)',code:'IMPORT_BUSY'}],
        duplicates:0,unprocessed:0};
    const win=mainWindow;
    if(!win||win.isDestroyed()) throw new Error('NO_WINDOW');
    const controller=new AbortController();
    nativeImportController=controller;
    nativeImportCounters={phase:'PICKING',processed:0,total:0,accepted:0,duplicates:0,failed:0};
    try {
      const choice=await dialog.showOpenDialog(win,kind==='files'
        ? {title:'选择 .user.js 文件',properties:['openFile','multiSelections'],
          filters:[{name:'Userscript',extensions:['js']}]}
        : {title:'选择脚本文件夹',properties:['openDirectory']});
      if(choice.canceled||win!==mainWindow||win.isDestroyed()||
        controller.signal.aborted || (kind==='folder'&&choice.filePaths.length!==1))
        return {canceled:true,scripts:[],errors:[],duplicates:0,
          unprocessed:controller.signal.aborted?choice.filePaths.length:0};
      nativeImportCounters={phase:kind==='folder'?'SCANNING':'IMPORTING',
        processed:0,total:kind==='files'?choice.filePaths.length:0,
        accepted:0,duplicates:0,failed:0};
      const progress=(snapshot:ReadOnlyImportProgress)=>{
        if(nativeImportController!==controller||controller.signal.aborted)return;
        nativeImportCounters={phase:'IMPORTING',processed:snapshot.processed,
          total:snapshot.total,accepted:snapshot.accepted,
          duplicates:snapshot.duplicates,failed:snapshot.failed};
      };
      const result=kind==='files'
        ? await importApprovedPaths(choice.filePaths,controller.signal,progress)
        : await scanApprovedDirectory(choice.filePaths[0],controller.signal,progress);
      // Only validated content hashes, never source paths or bytes, bind
      // subsequently staged scenarios to this window's import session.
      if(win===mainWindow&&!win.isDestroyed())
        for(const script of result.scripts){
          scenarioSession.recordImported(script.sha256);
          if(script.sourcePath&&!nativeImportedPaths.has(script.sha256))
            nativeImportedPaths.set(script.sha256,script.sourcePath);
        }
      // Cancellation during processing retains successful earlier imports.
      if(nativeImportController===controller){
        nativeImportCounters={phase:'ANALYZING',processed:0,total:result.scripts.length,
          accepted:result.scripts.length,duplicates:result.duplicates,failed:result.errors.length};
      }
      return await summarizeResult(result,controller.signal,(processed,total)=>{
        if(nativeImportController!==controller||controller.signal.aborted)return;
        nativeImportCounters={phase:'ANALYZING',processed,total,
          accepted:result.scripts.length,duplicates:result.duplicates,
          failed:result.errors.length};
      },join(app.getPath('userData'),'readonly-import-journals'));
    } finally {
      if(nativeImportController===controller){
        nativeImportController=null;
        nativeImportCounters=null;
      }
    }
  };
  ipcMain.handle('import:get-progress',event=>{
    authorizeSender(event);
    // No user data: only counters associated with the current native picker.
    return nativeImportController&&nativeImportCounters
      ?Object.freeze({active:true as const,...nativeImportCounters})
      :Object.freeze({active:false as const});
  });
  ipcMain.handle('import:files', event=>runNativeImport(event,'files'));
  ipcMain.handle('import:folder', event=>runNativeImport(event,'folder'));
  ipcMain.handle('import:cancel-native', event=>{
    authorizeSender(event);
    if(!nativeImportController)return {ok:false,code:'NO_ACTIVE_IMPORT'};
    nativeImportController.abort();
    return {ok:true,status:'CANCELLATION_REQUESTED'};
  });
  ipcMain.handle('import:dropped', async (event, name:unknown, data:unknown) => {
    authorizeSender(event);
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW'};
    if(nativeImportController||droppedImportController||manualExportInProgress||
        nativeSelectionInProgress||profilePreparationInProgress||launchInProgress)
      return {ok:false,code:'IMPORT_BUSY'};
    const result=importDroppedBytes(name,data);
    if('code' in result)return {ok:false,code:result.code};
    const controller=new AbortController();
    droppedImportController=controller;
    try{
      // A dragged .user.js is untrusted even after successful byte import.
      // AST parsing must not block the privileged Electron event loop.
      // No script is executed, applied or sent to the browser/manager.
      const [analysis]=await runImportedReadOnlyAnalysisQueue([result],controller.signal);
      if(win!==mainWindow||win.isDestroyed())
        return {ok:false,code:'WINDOW_CLOSED'};
      // Cancellation only stops optional AST work. Validated imported bytes
      // were already read, so retain the SHA for this window's staged history.
      scenarioSession.recordImported(result.sha256);
      return {ok:true,script:summarize(result,analysis)};
    }catch{
      return {ok:false,code:'DROPPED_IMPORT_FAILED'};
    }finally{
      if(droppedImportController===controller)droppedImportController=null;
    }
  });
  ipcMain.handle('import:cancel-dropped',event=>{
    authorizeSender(event);
    if(!droppedImportController)
      return {ok:false,code:'NO_ACTIVE_DROPPED_IMPORT'};
    droppedImportController.abort();
    return {ok:true,status:'CANCELLATION_REQUESTED'};
  });
  // Stage one bounded, read-only scenario only for a script imported by this
  // window. No arbitrary source/path IPC or browser navigation is exposed.
  ipcMain.handle('scenario:register',(event,input:unknown)=>{
    authorizeSender(event);
    return scenarioSession.register(input);
  });

  // Read-only history of a staged/imported scenario. This never visits a site,
  // accepts a file path/hash from renderer, or returns raw evidence/hash data.
  ipcMain.handle('scenario:history',async(event,id:unknown)=>{
    authorizeSender(event);
    const current=readLimitedSessionHistory(scenarioSession,limitedScenarioHistory,id);
    if(!current.ok)return current;
    const selected=scenarioSession.resolveReadOnlyDom(id);
    if(!selected.ok)return current;
    try{
      const key=limitedScenarioHistoryKey(
        selected.scenario.scriptSha256,selected.scenario.id);
      const stored=await readLimitedHealthArchive(app.getPath('userData'),key);
      if(stored.status==='BLOCKED')return current.events.length?current:
        {ok:false as const,code:'HISTORY_UNAVAILABLE' as const,...unverified};
      if(stored.status!=='ARCHIVE_READ_UNVERIFIED')return current;
      const oldLast=stored.events[stored.events.length-1].observedAtMs;
      const recent=current.events.filter(event=>event.observedAtMs>oldLast);
      const events=Object.freeze([...stored.events,...recent].slice(-32).map(
        event=>Object.freeze({observedAtMs:event.observedAtMs,status:event.status})));
      const currentLast=current.events[current.events.length-1]?.observedAtMs;
      const currentStatus=currentLast!==undefined&&currentLast>=oldLast?
        current.currentStatus:'INDETERMINATE' as const;
      return Object.freeze({...current,currentStatus,events});
    }catch{return current.events.length?current:
      {ok:false as const,code:'HISTORY_UNAVAILABLE' as const,...unverified};}
  });

  // Fresh native consent, verified owned Chrome process and a scenario ID from
  // this window are all required. The renderer cannot supply navigation URL,
  // CSS selector, browser endpoint, script source or approval for this action.
  ipcMain.handle('scenario:inspect',async(event,id:unknown)=>{
    authorizeSender(event);
    if(scenarioObserveInProgress||gmActionInProgress||gmStartInProgress)
      return {ok:false,code:'OBSERVATION_BUSY',...unverified};
    const selected=scenarioSession.resolveReadOnlyDom(id);
    if(!selected.ok)return {ok:false,code:selected.code,...unverified};
    const owned=readOwnedBrowser();
    if(!owned)return {ok:false,code:'BROWSER_NOT_RUNNING',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    const lease=diagnosticGate.reserve();
    if(lease===null)return {ok:false,code:'OBSERVATION_BUSY',...unverified};
    const controller=new AbortController();
    const epoch=scenarioObserveEpoch;
    scenarioObserveController=controller;
    scenarioObserveInProgress=true;
    try{
      const consent=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许只读打开并检查','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'允许访问已登记测试场景的网页并读取限定 DOM？',
        detail:'只在本程序启动的独立 Chrome 打开一个标签页：\\n'+
          selected.targetUrl+
          '\\n最多采集 3 次只读选择器计数（可选旧选择器与替代选择器同时观察），并在同一已核验标签页观察 1.2 秒页面 JavaScript 异常次数；不读取异常文本、堆栈、源码或页面内容，不执行用户脚本或修改文件。'+
          '\\n经授权完成的有限结果将仅在本机程序数据目录保存最多 32 条脱敏时间线（时间和有限状态）；不保存页面、脚本、路径或异常正文。重新启动后历史不会成为当前健康认证。'+
          '\\nCDP 结果不验证 Tampermonkey、GM API 或真实业务。'
      });
      if(consent.response!==0||controller.signal.aborted||
         epoch!==scenarioObserveEpoch||win!==mainWindow||win.isDestroyed()||
         readOwnedBrowser()!==owned)
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const opened=await openApprovedTarget(owned,selected.targetUrl,true,controller.signal);
      if(controller.signal.aborted||epoch!==scenarioObserveEpoch||
         win!==mainWindow||readOwnedBrowser()!==owned)
        return {ok:false,code:'CANCELLED',...unverified};
      if(!opened.ok)return {ok:false,code:opened.code,...unverified};
      const result=await inspectApprovedScenarioDomSeries(
        owned,opened,selected.scenario,true,3,250,controller.signal);
      if(controller.signal.aborted||epoch!==scenarioObserveEpoch||
         win!==mainWindow||readOwnedBrowser()!==owned)
        return {ok:false,code:'CANCELLED',...unverified};
      if(result.status!=='LIMITED_DOM_SIGNAL_ONLY'||result.code!=='NONE')
        return {ok:false,code:result.code,...unverified};
      // A passive PAGE exception sample is not userscript or GM evidence.
      // Reuse the owned tab and native consent, never collect exception text.
      const page=await inspectApprovedPageExceptions(
        owned,opened,selected.targetUrl,true,1200,controller.signal);
      if(controller.signal.aborted||epoch!==scenarioObserveEpoch||
         win!==mainWindow||win.isDestroyed()||readOwnedBrowser()!==owned)
        return {ok:false,code:'CANCELLED',...unverified};
      // Invalid identity, navigation or failed sampling invalidates the whole
      // combined result; earlier DOM counts must not imply a successful visit.
      if(page.status==='BLOCKED')
        return {ok:false,code:page.code,...unverified};
      // Record ONLY sanitized read-only observations. This cannot attest
      // Tampermonkey, user-script execution, business health, or repair.
      // History errors must not turn an otherwise valid DOM receipt into a
      // claim that the inspected web page or script failed.
      let sessionHealthStatus:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'|'UNAVAILABLE'='UNAVAILABLE';
      let sessionHealthEventCount=0;
      let localArchiveStatus:'SAVED_UNVERIFIED'|'UNAVAILABLE'='UNAVAILABLE';
      try {
        const snapshot=recordLimitedScenarioInspection(limitedScenarioHistory,{
          scriptHash:limitedScenarioHistoryKey(
            selected.scenario.scriptSha256,selected.scenario.id),
          checkedAssertions:result.checkedAssertions,
          triageStatus:result.triage.status,
          pageRuntimeStatus:page.status,
          pageExceptionCount:page.observedCount
        });
        sessionHealthStatus=snapshot.status==='ELEMENT_FOUND_ONLY'?
          'ELEMENT_FOUND_ONLY':'INDETERMINATE';
        sessionHealthEventCount=snapshot.history.length;
        const saved=await saveLimitedHealthArchive(app.getPath('userData'),snapshot);
        if(saved.status==='ARCHIVE_SAVED_UNVERIFIED')
          localArchiveStatus='SAVED_UNVERIFIED';
      } catch { /* capacity/disk failure: history not certified as saved */ }
      if(controller.signal.aborted||epoch!==scenarioObserveEpoch||
         win!==mainWindow||win.isDestroyed()||readOwnedBrowser()!==owned)
        return {ok:false,code:'CANCELLED',...unverified};
      return {ok:true,status:'LIMITED_DOM_SIGNAL_ONLY',
        sessionHealthStatus,sessionHealthEventCount,localArchiveStatus,
        checkedAssertions:result.checkedAssertions,
        triageStatus:result.triage.status,
        faultCategory:result.triage.category,
        evidenceCount:result.triage.evidenceIds.length,
        // These two observations remain review hints, not Tampermonkey/GM
        // attestation or permission to apply a patch.
        selectorComparisonStatus:selected.scenario.assertions.length!==2?
          'NOT_REQUESTED' as const:
          result.triage.status==='SINGLE_CAUSE_SIGNAL_ONLY'&&
          result.triage.category==='SELECTOR_ASSERTION'&&
          result.triage.evidenceIds.length===1&&
          result.triage.evidenceIds[0]==='scenario_assertion_1'?
            'OLD_SELECTOR_MISSING_ALTERNATIVE_PRESENT' as const:
          result.triage.status==='NO_FAULT_SIGNAL'?
            'NO_SELECTOR_MISSING_IN_WINDOW' as const:
            'INCONCLUSIVE_OR_OTHER_SIGNAL' as const,
        pageRuntimeStatus:page.status,
        pageExceptionCount:page.observedCount,
        ...unverified};
    }catch{
      return {ok:false,code:'OBSERVATION_FAILED',...unverified};
    }finally{
      if(scenarioObserveController===controller)scenarioObserveController=null;
      scenarioObserveInProgress=false;
      diagnosticGate.release(lease);
    }
  });
  // TASK-009/012/017: independently consented manual candidate export.
  // Renderer supplies ONLY a staged scenario ID. A privileged native import
  // remembers the on-disk file path; re-import verifies that same source just
  // before any stage/export write. Never use drag-and-drop bytes for this.
  ipcMain.handle('scenario:export-manual',async(event,id:unknown)=>{
    authorizeSender(event);
    if(manualExportInProgress||scenarioObserveInProgress||
       nativeImportController||droppedImportController||
       nativeSelectionInProgress||gmActionInProgress||gmStartInProgress)
      return {ok:false,code:'EXPORT_BUSY',...unverified};
    const selected=scenarioSession.resolveReadOnlyDom(id);
    if(!selected.ok)return {ok:false,code:selected.code,...unverified};
    if(selected.scenario.assertions.length!==2)
      return {ok:false,code:'TWO_SELECTORS_REQUIRED',...unverified};
    const sourcePath=nativeImportedPaths.get(selected.scenario.scriptSha256);
    if(!sourcePath)return {ok:false,code:'NO_NATIVE_SOURCE',...unverified};
    const owned=readOwnedBrowser();
    if(!owned)return {ok:false,code:'BROWSER_NOT_RUNNING',...unverified};
    const win=mainWindow;
    if(!win||win.isDestroyed())return {ok:false,code:'NO_WINDOW',...unverified};
    const lease=diagnosticGate.reserve();
    if(lease===null)return {ok:false,code:'EXPORT_BUSY',...unverified};
    const controller=new AbortController();
    const epoch=scenarioObserveEpoch;
    scenarioObserveController=controller;
    scenarioObserveInProgress=true;
    manualExportInProgress=true;
    nativeSelectionInProgress=true;
    const revoked=()=>controller.signal.aborted||epoch!==scenarioObserveEpoch||
      win!==mainWindow||win.isDestroyed()||readOwnedBrowser()!==owned;
    try{
      const consent=await dialog.showMessageBox(win,{
        type:'question',buttons:['允许只读检查后准备人工导出','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'确认对已登记场景执行只读双选择器复核？',
        detail:'访问独立 Chrome 内的 '+selected.targetUrl+
          '\n采集三次只读 DOM 计数，旧选择器必须持续缺失、替代选择器持续存在。'+
          '\n只用此前原生选择的本地脚本；稍后另行选择备份及导出文件夹并确认保存。'+
          '\n不会安装/更新 Tampermonkey、改写原始脚本或证明业务修复。'
      });
      if(consent.response!==0||revoked())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      const opened=await openApprovedTarget(owned,selected.targetUrl,true,controller.signal);
      if(revoked())return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(!opened.ok)return {ok:false,code:opened.code,...unverified};
      const selectors=selected.scenario.assertions.map(a=>a.selector);
      const evidence=await observeApprovedDomSeries(owned,opened,
        selected.targetUrl,true,selectors,3,250,controller.signal);
      if(revoked())return {ok:false,code:'SESSION_REVOKED',...unverified};
      const triage=summarizeReadOnlyScenarioDomSeries(selected.scenario,evidence,true);
      if(triage.status!=='LIMITED_DOM_SIGNAL_ONLY'||triage.code!=='NONE'||
         triage.triage.status!=='SINGLE_CAUSE_SIGNAL_ONLY'||
         triage.triage.category!=='SELECTOR_ASSERTION'||
         triage.triage.evidenceIds.length!==1||
         triage.triage.evidenceIds[0]!=='scenario_assertion_1')
        return {ok:false,code:'DOM_EVIDENCE_NOT_SUFFICIENT',...unverified};
      const backup=await dialog.showOpenDialog(win,{
        title:'选择备份文件夹（只存新备份，不覆盖任何已有文件）',
        properties:['openDirectory']
      });
      if(revoked())return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(backup.canceled||backup.filePaths.length!==1)
        return {ok:false,code:'CANCELLED',...unverified};
      const destination=await dialog.showOpenDialog(win,{
        title:'选择独立的人工候选及原始恢复版本导出文件夹（不得与备份相同）',
        properties:['openDirectory']
      });
      if(revoked())return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(destination.canceled||destination.filePaths.length!==1)
        return {ok:false,code:'CANCELLED',...unverified};
      // The source file may have changed while the user was inspecting the
      // page or choosing directories. Re-read it from the originally approved
      // native source path and compare to the staged scenario's exact digest.
      const current=await importApprovedPaths([sourcePath],controller.signal);
      if(revoked())return {ok:false,code:'SESSION_REVOKED',...unverified};
      if(current.errors.length!==0||current.scripts.length!==1||
         current.scripts[0].sha256!==selected.scenario.scriptSha256)
        return {ok:false,code:'SOURCE_CHANGED_OR_UNREADABLE',...unverified};
      const approved=await dialog.showMessageBox(win,{
        type:'question',buttons:['创建备份、候选及原始恢复版本','取消'],
        defaultId:1,cancelId:1,noLink:true,
        message:'确认写入备份、人工候选及独立的原始恢复文件？',
        detail:'脚本：'+current.scripts[0].filename+
          '\n备份文件夹：'+backup.filePaths[0]+
          '\n候选文件夹：'+destination.filePaths[0]+
          '\n导出目录将生成修复候选和保留原字节的人工恢复脚本，均不会自动安装。' +
           '\n不会覆盖原始脚本或安装/更新浏览器扩展。'+
          '\n新文件一旦开始创建，不能用取消观察来撤销；请自行检查导出版本。'+
          '\n只读 DOM 信号不是 Tampermonkey/GM/业务验证。'
      });
      if(approved.response!==0||revoked())
        return {ok:false,code:'NOT_AUTHORIZED',...unverified};
      // No await between final consent and marking the non-cancellable write.
      manualExportCommitInProgress=true;
      const result=await exportReviewedImportedSelectorOnly(
        current.scripts[0],selected.scenario,evidence,{
          backupDirectory:backup.filePaths[0],
          exportDirectory:destination.filePaths[0],
          userApproved:true
        });
      if(result.status!=='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED')
        return {ok:false,code:result.reason,...unverified};
      // This is a limited local file receipt, not script or manager authority.
      return {ok:true,status:result.status,
        backupFileName:result.backupFileName,
        candidateFileName:result.candidateFileName,
        exportFileName:result.exportFileName,
        recoveryExportFileName:result.recoveryExportFileName,
        candidateSha256:result.candidateSha256,
        candidateByteLength:result.candidateByteLength,
        ...unverified};
    }catch{
      return {ok:false,code:'EXPORT_FAILED',...unverified};
    }finally{
      if(scenarioObserveController===controller)scenarioObserveController=null;
      scenarioObserveInProgress=false;
      manualExportCommitInProgress=false;
      manualExportInProgress=false;
      nativeSelectionInProgress=false;
      diagnosticGate.release(lease);
    }
  });
  ipcMain.handle('scenario:cancel',event=>{
    authorizeSender(event);
    if(!scenarioObserveInProgress)
      return {ok:false,code:'NO_ACTIVE_OBSERVATION',...unverified};
    if(manualExportCommitInProgress)
      return {ok:false,code:'EXPORT_WRITE_ALREADY_STARTED',...unverified};
    cancelScenarioObservation();
    return {ok:true,status:'OBSERVATION_CANCEL_REQUESTED',...unverified};
  });
}

async function createMainWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 650,
    minHeight: 420,
    show: false,
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: join(__dirname, '..', 'preload', 'index.js')
    }
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('closed', () => {
    if (mainWindow === win) {
      nativeImportController?.abort();
      droppedImportController?.abort();
      stopOnlyOwnedBrowser();
      selectedChrome=null;selectedProfile=null;
      mainWindow=null;
      scenarioSession=new DesktopScenarioSession();
      limitedScenarioHistory=new LimitedHealthRegistry();
      nativeImportedPaths.clear();
    }
  });
  await win.loadFile(uiFile);
  if (process.argv.includes('--uahtest-shell-only')) {
    // Fixture files live solely inside the disposable Windows Actions runner.
    const fixtureDir = mkdtempSync(join(tmpdir(), 'uah-task002-e2e-'));
    const disposableProfile=join(fixtureDir,'isolated-profile');
    mkdirSync(disposableProfile);
    writeFileSync(join(fixtureDir,'chrome.exe'),'NOT_A_CHROME_BINARY');
    writeFileSync(join(fixtureDir, 'approved.user.js'), '// ==UserScript==\\n// smoke\\n');
    const nativeDialog = dialog.showOpenDialog;
    const nativeConsent = dialog.showMessageBox;
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, writable: true,
      value: async (_window: unknown, options: {properties?: string[];title?:string}) => {
        // Keep the first native picker pending while a second IPC tries to open.
        // This is a real Electron IPC concurrency regression, not static text matching.
        if(options.title?.startsWith('选择独立 Chrome') ||
           options.title?.startsWith('选择已有的独立调试') ||
           options.title?.startsWith('选择 .user.js 文件') ||
           options.title?.startsWith('选择脚本文件夹'))
          await new Promise(resolve=>setTimeout(resolve,60));
        return ({
        canceled: false,
        filePaths: options.title?.startsWith('选择独立 Chrome')
          ? [join(fixtureDir,'chrome.exe')]
          : options.title?.startsWith('选择已有的独立调试')
            ? [disposableProfile]
            : options.properties?.includes('openDirectory')
              ? [fixtureDir] : [join(fixtureDir, 'approved.user.js')]
        });
      }
    });
    // Deny browser startup at a trusted OS dialog: Electron smoke must never
    // launch a real browser or re-use an existing Chrome/Profile.
    Object.defineProperty(dialog,'showMessageBox',{
      configurable:true,writable:true,
      value:async()=>({response:1,checkboxChecked:false})
    });
    // The test is run inside a real Electron renderer. A static source assertion
    // cannot prove that the sandbox preload or frame-checked IPC actually work.
    const probe = await win.webContents.executeJavaScript(
      "(async () => { const a = window.healer; " +
      "if (!a || typeof window.require !== 'undefined') return {ok:false}; " +
      "const s = await a.getStatus(); const noManualRestore=await a.restoreManualOriginal(); const noInventory=await a.inspectRestoreInventory(); const bad = await a.validateConfig({}); " +
       "const noDroppedCancel=typeof a.cancelDroppedImport==='function' ? await a.cancelDroppedImport() : {code:'NOT_IMPLEMENTED'}; " +
       "const dropFuture=a.importDropped('cancel-preview.user.js',new Uint8Array([47,47,32,99,97,110,99,101,108])); " +
       "const activeDroppedCancel=await a.cancelDroppedImport(); const abortedDrop=await dropFuture; " +
      "const d = await a.importDropped('smoke.user.js', new Uint8Array([47,47,32,111,107])); " +
      "const scenarioInput={id:'smoke_scenario',scriptSha256:d.script.sha256,targetUrl:'https://example.test/app',selector:'#submit',userApproved:true,requiresLogin:false,loginReady:false}; " +
      "const foreignScenario=await a.registerScenario({...scenarioInput,id:'foreign',scriptSha256:'b'.repeat(64)}); " +
      "const stagedScenario=await a.registerScenario(scenarioInput); " +
      "const dualScenario=await a.registerScenario({...scenarioInput,id:'smoke_dual',selector:'#obsolete',replacementSelector:'#current'}); " +
      "const badDualScenario=await a.registerScenario({...scenarioInput,id:'smoke_bad_dual',replacementSelector:'#submit'}); " +
      "const noScenarioInspect=await a.inspectScenario('smoke_scenario'); " +
      "const noHistory=await a.readScenarioHistory('smoke_scenario'); " +
      "const invalidHistory=await a.readScenarioHistory('foreign'); " +
      "const noNativeExport=await a.exportManualScenario('smoke_dual'); " +
      "const singleSelectorExport=await a.exportManualScenario('smoke_scenario'); " +
      "const noScenarioCancel=await a.cancelScenarioInspection(); " +
      "const invalidScenarioInspect=await a.inspectScenario('unauthorized'); " +
      "const noConfig=await a.startBrowser(9223); const noBrowser=await a.inspectTampermonkey(); " +
      "const noStop=await a.stopBrowser(); " +
      "const noGmStart=await a.startGmProbe(); const invalidRunAt=await a.startGmProbe('document-end;unsafe'); " +
      "const noGmStatus=await a.gmProbeStatus(); const noGmReport=await a.saveGmReport(); " +
      "const noGmVisit=await a.visitGmFixture('broken'); const noGmObserve=await a.observeGmFixture('fixed'); " +
       "const badMode=await a.visitGmFixture('invalid'); const noGmStop=await a.stopGmProbe(); " +
      "const newProfileWithoutChrome=await a.createProfile(); " +
      "const selectedExe=await a.chooseChrome(); const selectedProfile=await a.chooseProfile(); " +
      "const race=await Promise.all([a.chooseChrome(),a.chooseProfile()]); " +
      "const raceSerialized=race.filter(x=>x.ok===true).length===1 && " +
      "race.filter(x=>x.code==='BROWSER_BUSY').length===1; " +
      "const declinedProfile=await a.createProfile(); const blockedLaunch=await a.startBrowser(9223); " +
      "const pendingBrowserPicker=a.chooseProfile(); " +
       "await new Promise(resolve=>setTimeout(resolve,10)); " +
       "const blockedImportDuringBrowserPicker=await a.chooseFiles(); " +
       "const blockedDropDuringBrowserPicker=await a.importDropped('no-peek.user.js',new Uint8Array([47,47])); " +
       "const browserPickerFinished=await pendingBrowserPicker; " +
       "const noNativeCancel=await a.cancelNativeImport(); " +
      "const idleNativeProgress=await a.getNativeImportProgress(); " +
      "const pendingNativeFiles=a.chooseFiles(); " +
      "await new Promise(resolve=>setTimeout(resolve,10)); " +
      "const pickingProgress=await a.getNativeImportProgress(); " +
      "const rejectedOverlap=await a.chooseFolder(); " +
       "const blockedBrowserDuringNativePicker=await a.chooseProfile(); " +
       "const blockedLaunchDuringNativePicker=await a.startBrowser(9223); " +
       "const blockedDroppedOverlap=await a.importDropped('parallel.user.js',new Uint8Array([47,47,32,105,112,99])); " +
      "const requestedNativeCancel=await a.cancelNativeImport(); " +
      "const cancelledNativeFiles=await pendingNativeFiles; " +
      "const settledProgress=await a.getNativeImportProgress(); " +
      "const pendingNativeFolder=a.chooseFolder(); " +
      "await new Promise(resolve=>setTimeout(resolve,10)); " +
      "const requestedFolderCancel=await a.cancelNativeImport(); " +
      "const cancelledNativeFolder=await pendingNativeFolder; " +
      "const nativeFiles=await a.chooseFiles(); const folderFiles=await a.chooseFolder(); " +
      "const area=document.getElementById('drop-area'); const transfer=new DataTransfer(); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// test'], 'drop-renamed.user.js')); " +
      "transfer.items.add(new File(['// edited'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// other'], 'drop-other.user.js')); " +
      "area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer})); " +
      "const rendered=await new Promise(resolve=>{ const start=Date.now(); const tick=()=>{ " +
      "const list=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "const yes=list.filter(x=>x.startsWith('drop-smoke.user.js:')).length===2 && " +
      "list.filter(x=>x.startsWith('drop-other.user.js:')).length===1 && " +
      "list.filter(x=>x.startsWith('drop-renamed.user.js:')).length===0 && " +
      "list.some(x=>x.includes('忽略重复脚本')); " +
      "if(yes)resolve(true); else if(Date.now()-start>3000)resolve(false); else setTimeout(tick,40); }; tick(); }); " +
      "const badDrop=new DataTransfer();badDrop.items.add(new File(['ignored'],'bad-drop.txt')); " +
      "area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:badDrop})); " +
      "const badDropReported=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "if(lines.some(x=>x.startsWith('bad-drop.txt: NOT_USER_SCRIPT')))resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "const oldEntry=Object.getOwnPropertyDescriptor(DataTransferItem.prototype,'webkitGetAsEntry'); " +
      "let releaseScan=null;Object.defineProperty(DataTransferItem.prototype,'webkitGetAsEntry',{ " +
      "configurable:true,writable:true,value:function(){const file=this.getAsFile(); " +
      "if(file&&file.name==='scan-fixture.user.js')return {isFile:false,isDirectory:true,name:'scan-root', " +
      "createReader:()=>({readEntries:cb=>{releaseScan=()=>cb([]);}})}; " +
      "return oldEntry.value.call(this);}}); " +
      "const slowDrop=new DataTransfer();slowDrop.items.add(new File(['// fixture'],'scan-fixture.user.js')); " +
      "area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:slowDrop})); " +
      "const scanCancelReady=!!releaseScan&&!document.getElementById('cancel-import').disabled; " +
      "if(scanCancelReady)document.getElementById('cancel-import').click(); " +
      "const pendingCallbackBeforeCancel=!!releaseScan; " +
      "const scanCancelled=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "if(lines.some(x=>x.includes('已取消拖放目录扫描')) && document.getElementById('cancel-import').disabled)resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "if(releaseScan)releaseScan(); " +
      "await new Promise(resolve=>setTimeout(resolve,20)); " +
      "Object.defineProperty(DataTransferItem.prototype,'webkitGetAsEntry',oldEntry); " +
      "const input=document.getElementById('select-files'); " +
      "const sample=new DataTransfer(); sample.items.add(new File(['bad'],'invalid.txt')); " +
      "sample.items.add(new File(['// accepted'],'accepted-batch.user.js')); " +
      "Object.defineProperty(input,'files',{configurable:true,value:sample.files}); " +
      "input.dispatchEvent(new Event('change',{bubbles:true})); " +
      "const isolated=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "if(lines.some(x=>x.startsWith('invalid.txt:')) && " +
      "lines.some(x=>x.startsWith('accepted-batch.user.js:')))resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "const next=new DataTransfer(); next.items.add(new File(['// first'],'cancel-first.user.js')); " +
      "next.items.add(new File(['// second'],'cancel-second.user.js')); " +
      "Object.defineProperty(input,'files',{configurable:true,value:next.files}); " +
      "input.dispatchEvent(new Event('change',{bubbles:true})); " +
      "const canCancel=!document.getElementById('cancel-import').disabled; " +
      "document.getElementById('cancel-import').click(); " +
      "const cancelled=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "if(lines.some(x=>x.includes('用户取消导入：其余 1 份文件未读取。')) && " +
      "document.getElementById('cancel-import').disabled)resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "const uiScenarioSelect=document.getElementById('scenario-script'); " +
      "const uiScenarioImported=uiScenarioSelect.options.length>=2 && !uiScenarioSelect.disabled; " +
      "document.getElementById('scenario-id').value='smoke_ui_scenario'; " +
      "document.getElementById('scenario-url').value='https://example.test/smoke'; " +
      "document.getElementById('scenario-selector').value='#submit'; " +
      "document.getElementById('scenario-replacement').value='#candidate'; " +
      "document.getElementById('scenario-approve').checked=true; " +
      "const uiScenarioButton=document.getElementById('scenario-register'); " +
      "const uiScenarioButtonEnabled=!uiScenarioButton.disabled; uiScenarioButton.click(); " +
      "const uiScenarioStaged=await new Promise(resolve=>{const start=Date.now(); const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#scenario-list li')).map(x=>x.textContent); " +
      "if(lines.some(x=>x.includes('smoke_ui_scenario') && x.includes('READY_TO_TEST') && x.includes('未执行')))resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false); else setTimeout(tick,40); }; tick(); }); " +
      "const uiUnknownButtonReady=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "if(!uiScenarioButton.disabled)resolve(true);else if(Date.now()-start>3000)resolve(false); " +
      "else setTimeout(tick,40);};tick();}); " +
      "document.getElementById('scenario-id').value='smoke_login_unknown'; " +
      "document.getElementById('scenario-needs-login').checked=true; " +
      "if(uiUnknownButtonReady)uiScenarioButton.click(); " +
      "const uiUnknownNotOffered=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const lines=Array.from(document.querySelectorAll('#scenario-list li')).map(x=>x.textContent); " +
      "const listed=lines.some(x=>x.includes('smoke_login_unknown') && x.includes('UNKNOWN')); " +
      "const options=Array.from(document.getElementById('scenario-inspect-id').options); " +
      "if(listed)resolve(!options.some(x=>x.value==='smoke_login_unknown')); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "const historyButton=document.getElementById('scenario-history'); " +
      "const uiHistoryAvailable=!historyButton.disabled; historyButton.click(); " +
      "const uiHistoryShown=await new Promise(resolve=>{const start=Date.now();const tick=()=>{ " +
      "const summary=document.getElementById('scenario-history-summary').textContent; " +
      "if(summary.includes('尚未观察') && summary.includes('不证明脚本'))resolve(true); " +
      "else if(Date.now()-start>3000)resolve(false);else setTimeout(tick,40);};tick();}); " +
      "return {ok:s.shell === 'development-skeleton' && s.automaticRepairAvailable === false && " +
      "s.aiEnabled === false && s.automaticApplyEnabled === false && bad.ok === false && " +
      "bad.code === 'INVALID_SHAPE' && noConfig.code === 'CONFIG_NOT_SELECTED' && " +
      "noBrowser.code === 'BROWSER_NOT_RUNNING' && noStop.code === 'BROWSER_NOT_RUNNING' && " +
      "noGmStart.code === 'BROWSER_NOT_RUNNING' && invalidRunAt.code === 'INVALID_OPTIONS' && " +
      "noGmStatus.code === 'NO_ACTIVE_FIXTURE' && noGmReport.code === 'NO_ACTIVE_FIXTURE' && noGmVisit.code === 'NO_ACTIVE_FIXTURE' && " +
       "noGmObserve.code === 'NO_ACTIVE_FIXTURE' && badMode.code === 'INVALID_MODE' && " +
       "noGmStop.ok === false && " +
      "newProfileWithoutChrome.code === 'CONFIG_NOT_SELECTED' && " +
      "selectedExe.ok === true && selectedProfile.ok === true && raceSerialized && " +
      "declinedProfile.code === 'NOT_AUTHORIZED' && " +
      "blockedLaunch.code === 'NOT_AUTHORIZED' && blockedLaunch.tampermonkeyVerified === false && " +
      "d.ok === true && d.script.analysis.automaticPatchAllowed === false && " +
       "noDroppedCancel.code === 'NO_ACTIVE_DROPPED_IMPORT' && activeDroppedCancel.ok === true && " +
       "abortedDrop.ok === true && abortedDrop.script.analysis.status === 'SKIPPED_CANCELLED' && " +
       "abortedDrop.script.analysis.automaticPatchAllowed === false && foreignScenario.code === 'SCRIPT_NOT_IMPORTED' && " +
      "stagedScenario.status === 'STAGED_RUNTIME_UNVERIFIED' && stagedScenario.automaticPatchAllowed === false && " +
      "stagedScenario.tampermonkeyVerified === false && dualScenario.readOnlyDomEligible === true && " +
      "dualScenario.automaticPatchAllowed === false && badDualScenario.code === 'INVALID_REQUEST' && " +
      "noScenarioInspect.code === 'BROWSER_NOT_RUNNING' && " +
      "noHistory.ok === true && noHistory.currentStatus === 'UNTESTED' && noHistory.events.length === 0 && " +
      "noHistory.automaticPatchAllowed === false && invalidHistory.code === 'SCENARIO_NOT_FOUND' && " +
      "noNativeExport.code === 'NO_NATIVE_SOURCE' && singleSelectorExport.code === 'TWO_SELECTORS_REQUIRED' && " +
      "noScenarioCancel.code === 'NO_ACTIVE_OBSERVATION' && invalidScenarioInspect.code === 'SCENARIO_NOT_FOUND' && " +
      "uiScenarioImported && uiScenarioButtonEnabled && uiScenarioStaged && uiHistoryAvailable && uiHistoryShown && " +
      "uiUnknownButtonReady && uiUnknownNotOffered && " +
      "document.getElementById('scenario-inspect-id').value === 'smoke_ui_scenario' && " +
      "document.getElementById('scenario-inspect').disabled && document.getElementById('scenario-cancel').disabled && " +
      "document.getElementById('scenario-export-manual').disabled && " +
      "noManualRestore.ok === false && noManualRestore.code === 'CANCELLED' && noInventory.ok === false && noInventory.code === 'CANCELLED' && " +
      "rendered === true && badDropReported && scanCancelReady && pendingCallbackBeforeCancel && scanCancelled && isolated && canCancel && cancelled && " +
      "document.getElementById('import-summary').textContent.includes('成功 5') && " +
      "document.getElementById('import-summary').textContent.includes('失败 2') && " +
      "document.getElementById('import-summary').textContent.includes('未处理 1') && " +
      "document.getElementById('import-summary').textContent.includes('重复 2') && " +
      "document.getElementById('cancel-import').disabled === true && " +
      "noNativeCancel.code === 'NO_ACTIVE_IMPORT' && idleNativeProgress.active === false && " +
      "pickingProgress.active === true && pickingProgress.phase === 'PICKING' && " +
      "pickingProgress.processed === 0 && pickingProgress.total === 0 && " +
      "Object.keys(pickingProgress).every(k=>['active','phase','processed','total','accepted','duplicates','failed'].includes(k)) && " +
      "settledProgress.active === false && rejectedOverlap.errors[0].code === 'IMPORT_BUSY' && " +
       "blockedImportDuringBrowserPicker.errors[0].code === 'IMPORT_BUSY' && " +
       "blockedDropDuringBrowserPicker.code === 'IMPORT_BUSY' && " +
       "browserPickerFinished.ok === true && " +
       "blockedBrowserDuringNativePicker.code === 'BROWSER_BUSY' && " +
       "blockedLaunchDuringNativePicker.code === 'BROWSER_BUSY' && " +
       "blockedDroppedOverlap.code === 'IMPORT_BUSY' && requestedNativeCancel.ok && " +
      "cancelledNativeFiles.canceled && cancelledNativeFiles.scripts.length === 0 && " +
      "requestedFolderCancel.ok && cancelledNativeFolder.canceled && " +
      "cancelledNativeFolder.scripts.length === 0 && " +
      "nativeFiles.scripts.length === 1 && folderFiles.scripts.length === 1 && " +
      "nativeFiles.scripts[0].filename === 'approved.user.js' && d.script.filename === 'smoke.user.js' && " +
      "a.security.sandboxed === true && " +
      "a.security.isolated === true, keys:Object.keys(a).sort()}; })()",
      true
    ) as { ok?: boolean; keys?: string[] };
    // TASK-011 / TEST-020/021/026: true desktop renderer -> preload ->
    // native OS pickers -> TWO simulated explicit consents -> safe native
    // restore on disposable Windows fixture paths. This test must never use
    // actual user Chrome, scripts or Home folders.
    const manualSource=join(fixtureDir,'manual-smoke.user.js');
    const manualBackupDirectory=join(fixtureDir,'manual-backups');
    mkdirSync(manualBackupDirectory);
    const oldBytes=Buffer.from('// ==UserScript==\n// @name Smoke Original\n// ==/UserScript==\n');
    const editedBytes=Buffer.from('// ==UserScript==\n// @name Smoke Edited\n// ==/UserScript==\n');
    writeFileSync(manualSource,oldBytes);
    const independentBackup=await createVerifiedBackupOnly({
      sourcePath:manualSource,backupDirectory:manualBackupDirectory,
      expectedSha256:createHash('sha256').update(oldBytes).digest('hex'),
      userApproved:true
    });
    if(independentBackup.status!=='BACKUP_ONLY')
      throw new Error('MANUAL_RESTORE_FIXTURE_BACKUP_FAILED');
    const manualBackup=join(manualBackupDirectory,independentBackup.backupFileName);
    let nativePickedIntentPath:string|undefined;
    writeFileSync(manualSource,editedBytes);
    Object.defineProperty(dialog,'showOpenDialog',{
      configurable:true,writable:true,
      value:async(_window:unknown,options:{title?:string})=>{
        if(options.title?.startsWith('手动恢复：选择要被替换'))
          return {canceled:false,filePaths:[manualSource]};
        if(options.title?.startsWith('手动恢复：选择本应用生成'))
          return {canceled:false,filePaths:[manualBackup]};
        if(options.title?.startsWith('只读核对：选择目前的'))
          return {canceled:false,filePaths:[manualSource]};
        if(options.title?.startsWith('只读核对：选择先前生成的'))
          return {canceled:!nativePickedIntentPath,
            filePaths:nativePickedIntentPath?[nativePickedIntentPath]:[]};
        return {canceled:true,filePaths:[]};
      }
    });
    Object.defineProperty(dialog,'showMessageBox',{
      configurable:true,writable:true,
      value:async(_window:unknown,options:{message?:string})=>({
        response:options.message?.startsWith('手动恢复原始脚本')||
          options.message?.startsWith('最终确认：')||
          options.message?.startsWith('只读核对已有的恢复意图')?0:1,
        checkboxChecked:false
      })
    });
    const uiManualRestored=await win.webContents.executeJavaScript(
      "(async()=>{const button=document.getElementById('restore-manual-original');"+
      "const notice=document.getElementById('restore-manual-result');"+
      "if(!button||!notice||button.disabled)return false;button.click();"+
      "return await new Promise(resolve=>{const start=Date.now();"+
      "const tick=()=>{if(notice.textContent.includes('本机原字节手动恢复成功'))"+
      "return resolve(!button.disabled);"+
      "if(notice.textContent.includes('手动恢复未完成')||Date.now()-start>6000)"+
      "return resolve(false);setTimeout(tick,30);};tick();});})()",
      true
    ) as boolean;
    if(!uiManualRestored||!readFileSync(manualSource).equals(oldBytes))
      throw new Error('MANUAL_RESTORE_REAL_ELECTRON_UI_FAILED');
    const generated=await win.webContents.executeJavaScript(
      "document.getElementById('restore-manual-result').textContent",
      true
    ) as string;
    const nameMatch=/被替换版本已单独保留为：([^；]+)；恢复意图记录：([^。]+)。/.exec(generated);
    if(!nameMatch||!readFileSync(join(manualBackupDirectory,nameMatch[1])).equals(editedBytes))
      throw new Error('MANUAL_RESTORE_DISPLACED_COPY_MISSING');
    const intent=JSON.parse(readFileSync(join(manualBackupDirectory,nameMatch[2]),'utf8')) as {
      state?:string;automaticPatchAllowed?:boolean;automaticRollbackAllowed?:boolean
    };
    if(intent.state!=='RESTORE_INTENT_UNVERIFIED'||
       intent.automaticPatchAllowed!==false||intent.automaticRollbackAllowed!==false)
      throw new Error('MANUAL_RESTORE_INTENT_NOT_SAFE');
    const repeat=await win.webContents.executeJavaScript(
      'window.healer.restoreManualOriginal()',true
    ) as {ok?:boolean;code?:string};
    if(repeat.ok!==false||repeat.code!=='SOURCE_UNCHANGED'||
       !readFileSync(manualSource).equals(oldBytes))
      throw new Error('MANUAL_RESTORE_REPEAT_MUST_FAIL_CLOSED');
    nativePickedIntentPath=join(manualBackupDirectory,nameMatch[2]);
    const beforeInspectionSource=readFileSync(manualSource);
    const beforeInspectionJournal=readFileSync(nativePickedIntentPath);
    const beforeInspectionInventory=readdirSync(manualBackupDirectory).sort();
    const wrongArgs=await win.webContents.executeJavaScript(
      "window.healer.inspectRestoreIntent('not-allowed')",true
    ) as {ok?:boolean;code?:string;status?:string;sourceState?:string};
    // The no-argument preload bridge intentionally drops unexpected
    // JavaScript arguments. Verify they never become native path authority.
    if(wrongArgs.ok!==true||wrongArgs.status!=='RESTORE_INTENT_OBSERVED_READ_ONLY'||
       wrongArgs.sourceState!=='ORIGINAL_PRESENT')
      throw new Error('RESTORE_INSPECTION_BRIDGE_ARGUMENT_ISOLATION_FAILED');
    const inspectedByRenderer=await win.webContents.executeJavaScript(
      "(async()=>{const button=document.getElementById('restore-inspect-intent');"+
      "const notice=document.getElementById('restore-inspect-result');"+
      "if(!button||!notice||button.disabled)return false;button.click();"+
      "return await new Promise(resolve=>{const start=Date.now();"+
      "const tick=()=>{if(notice.textContent.includes('只读核对：当前本地文件的原版字节与恢复意图一致'))"+
      "return resolve(!button.disabled);"+
      "if(notice.textContent.includes('只读核对未完成')||Date.now()-start>6000)"+
      "return resolve(false);setTimeout(tick,30);};tick();});})()",
      true
    ) as boolean;
    const directInspection=await win.webContents.executeJavaScript(
      'window.healer.inspectRestoreIntent()',true
    ) as {ok?:boolean;status?:string;sourceState?:string;sourcePath?:string;originalSha256?:string};
    if(!inspectedByRenderer||directInspection.ok!==true||
       directInspection.status!=='RESTORE_INTENT_OBSERVED_READ_ONLY'||
       directInspection.sourceState!=='ORIGINAL_PRESENT'||
       'sourcePath' in directInspection||'originalSha256' in directInspection||
       !readFileSync(manualSource).equals(beforeInspectionSource)||
       !readFileSync(nativePickedIntentPath).equals(beforeInspectionJournal)||
       JSON.stringify(readdirSync(manualBackupDirectory).sort())!==
         JSON.stringify(beforeInspectionInventory))
      throw new Error('RESTORE_INSPECTION_READONLY_ELECTRON_UI_FAILED');

    Object.defineProperty(dialog, 'showOpenDialog', {configurable: true, writable: true, value: nativeDialog});
    Object.defineProperty(dialog, 'showMessageBox', {configurable: true, writable: true, value: nativeConsent});
    rmSync(fixtureDir, {recursive: true, force: true});
    if (!probe?.ok || probe.keys?.join(',') !==
        'cancelDroppedImport,cancelNativeImport,cancelScenarioInspection,chooseChrome,chooseFiles,chooseFolder,chooseProfile,createProfile,exportManualScenario,getNativeImportProgress,getStatus,gmProbeStatus,importDropped,inspectRestoreIntent,inspectRestoreInventory,inspectScenario,inspectTampermonkey,observeGmFixture,readScenarioHistory,registerScenario,restoreManualOriginal,saveGmReport,security,startBrowser,startGmProbe,stopBrowser,stopGmProbe,validateConfig,visitGmFixture') {
      throw new Error('SHELL_SMOKE_SECURITY_FAILED');
    }
    // TEST-022/026: real sandbox renderer-preload IPC cancellation policy.
    const uiCancelReady=await win.webContents.executeJavaScript(
      "(() => {const el=document.getElementById('scenario-cancel');"+
      "manualExportBusy=true;browserControls();const active=!el.disabled;"+
      "manualExportBusy=false;browserControls();return active&&el.disabled;})()"
    ) as boolean;
    scenarioObserveController=new AbortController();
    scenarioObserveInProgress=true;
    manualExportInProgress=true;
    const beforeCommit=await win.webContents.executeJavaScript(
      'window.healer.cancelScenarioInspection()') as {ok:boolean;status?:string};
    const preCommitAborted=scenarioObserveController.signal.aborted;
    scenarioObserveController=new AbortController();
    manualExportCommitInProgress=true;
    const duringCommit=await win.webContents.executeJavaScript(
      'window.healer.cancelScenarioInspection()') as {ok:boolean;code?:string};
    const commitUnaffected=!scenarioObserveController.signal.aborted;
    manualExportCommitInProgress=false;
    scenarioObserveInProgress=false;
    manualExportInProgress=false;
    scenarioObserveController=null;
    if(!uiCancelReady||beforeCommit.ok!==true||
       beforeCommit.status!=='OBSERVATION_CANCEL_REQUESTED'||
       !preCommitAborted||duringCommit.ok!==false||
       duringCommit.code!=='EXPORT_WRITE_ALREADY_STARTED'||!commitUnaffected)
      throw new Error('MANUAL_EXPORT_CANCEL_GATE_FAILED');
    const receipt = process.env.UAH_SMOKE_RECEIPT;
    if (!receipt) throw new Error('SHELL_SMOKE_RECEIPT_NOT_CONFIGURED');
    writeFileSync(receipt, JSON.stringify({
      shell: 'development-skeleton',
      preloadIpcVerified: true,
      rendererSandboxVerified: true,
      automaticRepairAvailable: false,
      // For isolated packaging smoke only: verify actual Electron userData
      // identity, portability and uninstall retention. Not exposed over IPC.
      userDataDirectory: app.getPath('userData')
    }), { encoding: 'utf-8', flag: 'wx' });
    app.exit(0);
    return;
  }
  if (!win.isDestroyed()) win.show();
}

app.whenReady().then(async () => {
  // Shell has no need for permissions. Explicit denial prevents accidental privilege creep.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerSafeIpc();
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}).catch(error => {
  // Only the disposable GitHub Windows smoke fixture may emit this narrow,
  // allowlisted error identifier; never print paths, URLs, script bytes or
  // arbitrary exception text to CI logs. Production behavior is unchanged.
  if(process.argv.includes('--uahtest-shell-only')&&
     process.env.GITHUB_ACTIONS==='true'){
    const message=error instanceof Error?error.message:'';
    const code=/^[A-Z][A-Z0-9_]{4,90}$/.test(message)?message:'UNKNOWN';
    const receipt=process.env.UAH_SMOKE_RECEIPT;
    try{if(receipt)writeFileSync(receipt+'.failure',code,{encoding:'utf8',flag:'wx'});}
    catch{/* Diagnostics must not mask the actual smoke failure. */}
    app.exit(1);
    return;
  }
  process.exitCode = 1;
  app.quit();
});

app.on('before-quit',()=>{
  nativeImportController?.abort();
  droppedImportController?.abort();
  stopOnlyOwnedBrowser();
});
app.on('window-all-closed', () => {
  stopOnlyOwnedBrowser();
  if (process.platform !== 'darwin') app.quit();
});
