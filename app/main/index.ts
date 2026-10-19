import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { importApprovedPaths, importDroppedBytes, scanApprovedDirectory, type ImportedScript } from '../../src/import/import-service';
import { previewImportedScriptAnalysis, previewImportedBatch, type ImportAnalysisPreview } from '../../src/analyze/import-preview';
import { join, win32 } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateBrowserConfig } from '../../src/security/browser-config';
import { DESKTOP_WEB_PREFERENCES, SHELL_STATUS, trustedMainFrame } from '../../src/security/desktop-policy';
import { launchApprovedIsolatedChrome, isLiveApprovedChromeSession, type ManagedLaunchResult } from '../../src/browser/owned-chrome';
import { prepareApprovedIsolatedProfile } from '../../src/browser/chrome-launcher';
import { inspectApprovedTampermonkeyRuntime } from '../../src/manager/tampermonkey-adapter';
import { startApprovedTampermonkeyDiagnostic, type ManualTampermonkeyDiagnosticSession } from '../../src/manager/tampermonkey-diagnostic';
import {isSupportedGmProbeRunAt} from '../../src/manager/tampermonkey-gm-probe';
import {createLimitedGmReport,saveLimitedGmReportOnly} from '../../src/manager/gm-report';

let mainWindow: BrowserWindow | null = null;
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
  stopOnlyGmProbe();
  launchAbort?.abort();
  if(ownedBrowser){ownedBrowser.stop();ownedBrowser=null;}
}
function readOwnedBrowser(){
  if(ownedBrowser && !isLiveApprovedChromeSession(ownedBrowser)){
    // Defensive fallback when a child exits before its lifecycle notification.
    ownedBrowser=null;
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
function summarizeResult(result: Awaited<ReturnType<typeof importApprovedPaths>>) {
  const previews=previewImportedBatch(result.scripts);
  return {canceled:false, scripts:result.scripts.map((script,i)=>summarize(script,previews[i])),
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
    if(nativeSelectionInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY'};
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
    if(nativeSelectionInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY'};
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
    if(nativeSelectionInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())
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
    if(nativeSelectionInProgress||launchInProgress||profilePreparationInProgress||readOwnedBrowser())return {ok:false,code:'BROWSER_BUSY',...unverified};
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
          if(ownedBrowser===launched){ownedBrowser=null;stopOnlyGmProbe();}
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
        filters:[{name:'JSON 报告',extensions:['json']}],
        showOverwriteConfirmation:true
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
        detail:'只包含预设 broken/fixed 自报状态、有限 DOM 对照和时间。'+
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
    }finally{gmActionInProgress=false;}
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
    }finally{gmActionInProgress=false;}
  });
  ipcMain.handle('gm-probe:stop',event=>{
    authorizeSender(event);
    const existed=gmStartInProgress||Boolean(gmProbeSession);
    stopOnlyGmProbe();
    return {ok:existed,status:existed?'FIXTURE_STOP_REQUESTED':'NO_ACTIVE_FIXTURE',
      ...unverified};
  });

  // Every path MUST come from the native OS picker, not renderer-provided input.
  ipcMain.handle('import:files', async (event) => {
    authorizeSender(event);
    const win = mainWindow;
    if (!win || win.isDestroyed()) throw new Error('NO_WINDOW');
    const choice = await dialog.showOpenDialog(win, {
      title:'选择 .user.js 文件', properties:['openFile','multiSelections'],
      filters:[{name:'Userscript',extensions:['js']}]
    });
    if (choice.canceled) return {canceled:true,scripts:[],errors:[],duplicates:0};
    return summarizeResult(await importApprovedPaths(choice.filePaths));
  });
  ipcMain.handle('import:folder', async (event) => {
    authorizeSender(event);
    const win = mainWindow;
    if (!win || win.isDestroyed()) throw new Error('NO_WINDOW');
    const choice = await dialog.showOpenDialog(win, {title:'选择脚本文件夹',properties:['openDirectory']});
    if (choice.canceled || choice.filePaths.length !== 1)
      return {canceled:true,scripts:[],errors:[],duplicates:0};
    return summarizeResult(await scanApprovedDirectory(choice.filePaths[0]));
  });
  ipcMain.handle('import:dropped', (event, name:unknown, data:unknown) => {
    authorizeSender(event);
    const result = importDroppedBytes(name,data);
    return 'code' in result ? {ok:false,code:result.code} : {ok:true,script:summarize(result)};
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
      stopOnlyOwnedBrowser();
      selectedChrome=null;selectedProfile=null;
      mainWindow=null;
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
           options.title?.startsWith('选择已有的独立调试'))
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
      "const s = await a.getStatus(); const bad = await a.validateConfig({}); " +
      "const d = await a.importDropped('smoke.user.js', new Uint8Array([47,47,32,111,107])); " +
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
      "const nativeFiles=await a.chooseFiles(); const folderFiles=await a.chooseFolder(); " +
      "const area=document.getElementById('drop-area'); const transfer=new DataTransfer(); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// other'], 'drop-other.user.js')); " +
      "area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer})); " +
      "const rendered=await new Promise(resolve=>{ const start=Date.now(); const tick=()=>{ " +
      "const list=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "const yes=list.filter(x=>x.startsWith('drop-smoke.user.js:')).length===1 && " +
      "list.filter(x=>x.startsWith('drop-other.user.js:')).length===1 && " +
      "list.some(x=>x.includes('忽略重复脚本')); " +
      "if(yes)resolve(true); else if(Date.now()-start>3000)resolve(false); else setTimeout(tick,40); }; tick(); }); " +
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
      "d.ok === true && rendered === true && " +
      "nativeFiles.scripts.length === 1 && folderFiles.scripts.length === 1 && " +
      "nativeFiles.scripts[0].filename === 'approved.user.js' && d.script.filename === 'smoke.user.js' && " +
      "a.security.sandboxed === true && " +
      "a.security.isolated === true, keys:Object.keys(a).sort()}; })()",
      true
    ) as { ok?: boolean; keys?: string[] };
    Object.defineProperty(dialog, 'showOpenDialog', {configurable: true, writable: true, value: nativeDialog});
    Object.defineProperty(dialog, 'showMessageBox', {configurable: true, writable: true, value: nativeConsent});
    rmSync(fixtureDir, {recursive: true, force: true});
    if (!probe?.ok || probe.keys?.join(',') !==
        'chooseChrome,chooseFiles,chooseFolder,chooseProfile,createProfile,getStatus,gmProbeStatus,importDropped,inspectTampermonkey,observeGmFixture,saveGmReport,security,startBrowser,startGmProbe,stopBrowser,stopGmProbe,validateConfig,visitGmFixture') {
      throw new Error('SHELL_SMOKE_SECURITY_FAILED');
    }
    const receipt = process.env.UAH_SMOKE_RECEIPT;
    if (!receipt) throw new Error('SHELL_SMOKE_RECEIPT_NOT_CONFIGURED');
    writeFileSync(receipt, JSON.stringify({
      shell: 'development-skeleton',
      preloadIpcVerified: true,
      rendererSandboxVerified: true,
      automaticRepairAvailable: false
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
}).catch(() => {
  process.exitCode = 1;
  app.quit();
});

app.on('before-quit',stopOnlyOwnedBrowser);
app.on('window-all-closed', () => {
  stopOnlyOwnedBrowser();
  if (process.platform !== 'darwin') app.quit();
});
