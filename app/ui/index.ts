interface Imported {
  filename: string;
  byteLength: number;
  sha256: string;
  textEncoding: string;
  analysis: {
    status: 'STATIC_ANALYSIS_ONLY' | 'SKIPPED_TOO_LARGE' | 'INVALID_ENCODING' |
      'INVALID_METADATA' | 'PARSE_ERROR' | 'SKIPPED_BATCH_BUDGET';
    totalSites: number;
    literalSites: number;
    runtimeConfirmationSites: number;
    automaticPatchAllowed: false;
  };
}
interface ImportResponse {
  canceled: boolean;
  unprocessed?: number;
  scripts: Imported[];
  errors: { filename: string; code: string }[];
  duplicates: number;
}
interface Window {
  healer: {
    getStatus(): Promise<{ shell: string; automaticRepairAvailable: boolean; aiEnabled: boolean; automaticApplyEnabled: boolean }>;
    chooseFiles(): Promise<ImportResponse>;
    chooseFolder(): Promise<ImportResponse>;
    cancelNativeImport(): Promise<{ok:boolean;code?:string;status?:string}>;
    importDropped(name: string, bytes: Uint8Array): Promise<{ ok: boolean; script?: Imported; code?: string }>;
    chooseChrome(): Promise<{ok:boolean;code?:string;filename?:string}>;
    chooseProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    createProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    startBrowser(port:number): Promise<{ok:boolean;code?:string;status?:string;chromeVersion?:string}>;
    inspectTampermonkey(): Promise<{ok:boolean;code?:string;status?:string;matchedRuntimeTargets?:number}>;
    stopBrowser(): Promise<{ok:boolean;code?:string;status?:string}>;
    startGmProbe(runAt?:'document-start'|'document-body'|'document-end'|'document-idle'): Promise<{ok:boolean;code?:string;status?:string;runAt?:string;
      installUrl?:string;brokenUrl?:string;fixedUrl?:string;expiresAt?:number}>;
    saveGmReport(): Promise<{ok:boolean;code?:string;status?:string;fileName?:string;sha256?:string;byteLength?:number}>;
    gmProbeStatus(): Promise<{ok:boolean;code?:string;status?:string;
      observedModes?:number;reportedGmDefaultMatched?:boolean;
      reportedBrokenFailed?:boolean;reportedFixedRecovered?:boolean;
      consistencyStatus?:string;comparedModes?:number;
      brokenDomAction?:number|null;fixedDomAction?:number|null}>;
    visitGmFixture(mode:'broken'|'fixed'): Promise<{ok:boolean;code?:string;status?:string}>;
    observeGmFixture(mode:'broken'|'fixed'): Promise<{ok:boolean;code?:string;
      status?:string;actionCount?:number;fixtureDomMatchesExpected?:boolean}>;
    stopGmProbe(): Promise<{ok:boolean;status?:string}>;
  };
}

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 8;
const MAX_DIRECTORY_ENTRIES = 10000;

const statusElement = document.getElementById('status');
const output = document.getElementById('import-list');
const importSummary = document.getElementById('import-summary');
const cancelImport = document.getElementById('cancel-import') as HTMLButtonElement | null;
const chooseFile = document.getElementById('choose-files') as HTMLButtonElement | null;
const chooseFolder = document.getElementById('choose-folder') as HTMLButtonElement | null;
const chooser = document.getElementById('select-files') as HTMLInputElement | null;
const dropZone = document.getElementById('drop-area');
const seenScripts = new Set<string>();
let busy = false;
let activeImport = false;
let nativeImportMode = false;
let cancelRequested = false;
// Session-only counters: no script bytes, paths or account data enter history.
let acceptedCount = 0;
let duplicateCount = 0;
let failedCount = 0;
let unprocessedCount = 0;

function updateImportSummary(): void {
  if (importSummary) importSummary.textContent =
    '本次会话：成功 ' + acceptedCount + '，重复 ' + duplicateCount +
    '，失败 ' + failedCount + '，未处理 ' + unprocessedCount +
    '。' + (activeImport
      ? cancelRequested ? ' 正在取消，当前文件读取完成后停止。' : ' 正在导入，只读分析。'
      : ' 不代表真实 Tampermonkey 或业务修复验证。');
}

function logLine(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  output?.append(item);
}
function show(result: ImportResponse): void {
  // A canceled native batch may still contain earlier successfully read files.
  let duplicates = result.duplicates;
  for (const item of result.scripts) {
    // Exact byte identity works across renamed files, native pickers,
    // drag/drop and file-input batches. Same name with changed bytes stays
    // separately reviewable; nothing is executed or overwritten.
    const key = item.sha256;
    if (seenScripts.has(key)) { duplicates++; continue; }
    seenScripts.add(key);
    acceptedCount++;
    const a = item.analysis;
    const preview = a?.status === 'STATIC_ANALYSIS_ONLY'
      ? '静态定位器 ' + a.totalSites + '（字面值 ' + a.literalSites +
        ' / 需运行确认 ' + a.runtimeConfirmationSites + '；未验证真实网页）'
      : '静态分析：' + (a?.status ?? 'NOT_AVAILABLE');
    logLine(item.filename + ': ' + item.byteLength + ' bytes / ' +
      item.textEncoding + ' / SHA-256 ' + item.sha256 + ' / ' + preview);
  }
  for (const error of result.errors) { failedCount++; logLine(error.filename + ': ' + error.code); }
  duplicateCount += duplicates;
  if (duplicates) logLine('忽略重复脚本：' + duplicates);
  updateImportSummary();
}

async function locked(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  if (chooseFile) chooseFile.disabled = true;
  if (chooseFolder) chooseFolder.disabled = true;
  if (chooser) chooser.disabled = true;
  try { await task(); }
  catch { failedCount++; logLine('导入未成功：文件、目录或权限检查未通过。'); updateImportSummary(); }
  finally {
    busy = false;
    if (chooseFile) chooseFile.disabled = false;
    if (chooseFolder) chooseFolder.disabled = false;
    if (chooser) chooser.disabled = false;
  }
}

async function importNativeSelection(kind: 'files'|'folder'): Promise<void> {
  activeImport = true;
  nativeImportMode = true;
  cancelRequested = false;
  if (cancelImport) cancelImport.disabled = false;
  updateImportSummary();
  try {
    const result = kind === 'files'
      ? await window.healer.chooseFiles()
      : await window.healer.chooseFolder();
    show(result);
    if (result.canceled) {
      unprocessedCount += result.unprocessed ?? 0;
      logLine('原生选择导入已取消；已经完成的只读结果仍保留。');
    }
  } finally {
    nativeImportMode = false;
    activeImport = false;
    cancelRequested = false;
    if (cancelImport) cancelImport.disabled = true;
    updateImportSummary();
  }
}

async function importFiles(files: readonly File[]): Promise<void> {
  activeImport = true;
  cancelRequested = false;
  if (cancelImport) cancelImport.disabled = false;
  updateImportSummary();
  try {
    if (files.length > MAX_FILES) {
      failedCount++;
      logLine('单批最多处理 1000 份文件');
      return;
    }
    let readBytes = 0;
    for (let index = 0; index < files.length; index++) {
      if (cancelRequested) {
        unprocessedCount += files.length - index;
        logLine('用户取消导入：其余 ' + (files.length - index) + ' 份文件未读取。');
        break;
      }
      const file = files[index];
      if (file.size > MAX_FILE_BYTES) {
        failedCount++;
        logLine(file.name + ': FILE_TOO_LARGE');
        updateImportSummary();
        continue;
      }
      if (readBytes + file.size > MAX_BATCH_BYTES) {
        unprocessedCount += files.length - index;
        logLine('本批次超过 128 MiB 导入限制；后续文件未读取。');
        break;
      }
      readBytes += file.size;
      // A rejected file never discards the rest of the batch.
      // Cancellation does not interrupt already running native IPC.
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const answer = await window.healer.importDropped(file.name, bytes);
        if (answer.ok && answer.script) {
          show({ canceled: false, scripts: [answer.script], errors: [], duplicates: 0 });
        } else {
          failedCount++;
          logLine(file.name + ': ' + (answer.code ?? 'INVALID_INPUT'));
        }
      } catch {
        failedCount++;
        logLine(file.name + ': READ_OR_IMPORT_FAILED');
      }
      updateImportSummary();
    }
  } finally {
    activeImport = false;
    cancelRequested = false;
    if (cancelImport) cancelImport.disabled = true;
    updateImportSummary();
  }
}

/** Read only the files of a folder explicitly dropped by the user.
 * The renderer never sends filesystem paths to privileged IPC.
 * Directory traversal is bounded and never executes any script bytes.
 */
async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items).filter(item => item.kind === 'file');
  if (!items.length) return Array.from(transfer.files);
  const roots: FileSystemEntry[] = [];
  const fallback: File[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry) roots.push(entry);
    else {
      const file = item.getAsFile();
      if (file) fallback.push(file);
    }
  }
  if (!roots.length) return fallback.length ? fallback : Array.from(transfer.files);
  const found: File[] = [...fallback];
  let visited = 0;
  const visit = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (++visited > MAX_DIRECTORY_ENTRIES || found.length >= MAX_FILES) {
      throw new Error('SCAN_LIMIT');
    }
    if (entry.isFile) {
      // A dropped directory only contributes userscripts; for individual
      // dropped files, leave extension validation to the main process.
      if (!entry.name.toLowerCase().endsWith('.user.js')) return;
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      found.push(file);
      return;
    }
    if (!entry.isDirectory) return;
    if (depth >= MAX_DIRECTORY_DEPTH) {
      logLine(entry.name + ': SCAN_LIMIT');
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await visit(child, depth + 1);
    }
  };
  for (const root of roots) await visit(root, 0);
  return found;
}

cancelImport?.addEventListener('click', () => {
  if (!activeImport || cancelRequested) return;
  cancelRequested = true;
  cancelImport.disabled = true;
  updateImportSummary();
  if (nativeImportMode) {
    // This requests cooperative cancellation; never claim a file read was
    // stopped until the native IPC actually resolves.
    void window.healer.cancelNativeImport().catch(() => {
      logLine('原生导入取消请求未成功，需等待当前操作完成。');
    });
  }
});
updateImportSummary();

chooseFile?.addEventListener('click', () => { void locked(async () => importNativeSelection('files')); });
chooseFolder?.addEventListener('click', () => { void locked(async () => importNativeSelection('folder')); });
chooser?.addEventListener('change', () => {
  void locked(async () => {
    try { await importFiles(Array.from(chooser.files ?? [])); }
    finally { chooser.value = ''; }
  });
});
dropZone?.addEventListener('dragover', event => { event.preventDefault(); });
dropZone?.addEventListener('drop', event => {
  event.preventDefault();
  if (!(event instanceof DragEvent) || !event.dataTransfer || busy) return;
  // A second drop must not traverse entries while an earlier batch owns the lock.
  // Acquire DataTransfer entries synchronously: drag data is protected after
  // the drop event returns, even while downstream file reads are asynchronous.
  const dropped = filesFromDrop(event.dataTransfer);
  void locked(async () => importFiles(await dropped));
});

void window.healer.getStatus().then(s => {
  if (statusElement) statusElement.textContent = s.shell === 'development-skeleton'
    && !s.automaticRepairAvailable && !s.aiEnabled && !s.automaticApplyEnabled
      ? '安全入口运行中；只读导入可用，独立 Chrome 连接与 Tampermonkey 只读探测需要另外授权。'
      : '安全检查未通过，自动处理仍被禁用。';
}).catch(() => {
  if (statusElement) statusElement.textContent = '应用入口不可用。';
  if (chooseFile) chooseFile.disabled = true;
  if (chooseFolder) chooseFolder.disabled = true;
  if (chooser) chooser.disabled = true;
});


// Native browser actions never expose arbitrary executable/Profile paths to
// renderer IPC. Every connect and manager inspection asks through an Electron
// native dialog; status alone never attests an installed or working userscript.
const chooseChromeButton=document.getElementById('choose-chrome') as HTMLButtonElement|null;
const chooseProfileButton=document.getElementById('choose-profile') as HTMLButtonElement|null;
const createProfileButton=document.getElementById('create-profile') as HTMLButtonElement|null;
const launchButton=document.getElementById('launch-chrome') as HTMLButtonElement|null;
const inspectButton=document.getElementById('inspect-tampermonkey') as HTMLButtonElement|null;
const stopButton=document.getElementById('stop-chrome') as HTMLButtonElement|null;
const portInput=document.getElementById('chrome-port') as HTMLInputElement|null;
const browserStatus=document.getElementById('browser-status');
let browserBusy=false;
let stopInProgress=false;
let chromeSelected=false;
let profileSelected=false;
let browserConnected=false;
let gmProbeActive=false;
const gmStartButton=document.getElementById('gm-probe-start') as HTMLButtonElement|null;
const gmRunAtSelect=document.getElementById('gm-run-at') as HTMLSelectElement|null;
const gmStatusButton=document.getElementById('gm-probe-status') as HTMLButtonElement|null;
const gmReportButton=document.getElementById('gm-probe-save-report') as HTMLButtonElement|null;
const gmStopButton=document.getElementById('gm-probe-stop') as HTMLButtonElement|null;
const gmVisitButtons={
 broken:document.getElementById('gm-probe-visit-broken') as HTMLButtonElement|null,
 fixed:document.getElementById('gm-probe-visit-fixed') as HTMLButtonElement|null
};
const gmObserveButtons={
 broken:document.getElementById('gm-probe-observe-broken') as HTMLButtonElement|null,
 fixed:document.getElementById('gm-probe-observe-fixed') as HTMLButtonElement|null
};
const gmLinks=document.getElementById('gm-probe-links');
const gmResult=document.getElementById('gm-probe-result');
function clearGmDisplay(message:string):void{
 gmProbeActive=false;
 if(gmLinks)gmLinks.textContent='';
 if(gmResult)gmResult.textContent=message;
}

function setBrowserStatus(value:string):void{
 if(browserStatus)browserStatus.textContent=value;
}
function browserControls():void{
 if(chooseChromeButton)chooseChromeButton.disabled=browserBusy||browserConnected;
 if(chooseProfileButton)chooseProfileButton.disabled=browserBusy||browserConnected;
 if(createProfileButton)createProfileButton.disabled=browserBusy||browserConnected||!chromeSelected;
 if(portInput)portInput.disabled=browserBusy||browserConnected;
 if(launchButton)launchButton.disabled=browserBusy||browserConnected||
   !chromeSelected||!profileSelected;
 if(inspectButton)inspectButton.disabled=browserBusy||!browserConnected;
 if(stopButton)stopButton.disabled=stopInProgress||(!browserConnected&&!browserBusy);
 if(gmStartButton)gmStartButton.disabled=browserBusy||!browserConnected||gmProbeActive;
 if(gmRunAtSelect)gmRunAtSelect.disabled=browserBusy||gmProbeActive;
 if(gmStatusButton)gmStatusButton.disabled=browserBusy||!gmProbeActive;
 if(gmReportButton)gmReportButton.disabled=browserBusy||!gmProbeActive;
 for(const button of Object.values(gmVisitButtons))
  if(button)button.disabled=browserBusy||!gmProbeActive;
 for(const button of Object.values(gmObserveButtons))
  if(button)button.disabled=browserBusy||!gmProbeActive;
 // Stop remains available during an in-flight CDP operation to revoke consent.
 if(gmStopButton)gmStopButton.disabled=!gmProbeActive;
}
async function browserAction(fn:()=>Promise<void>):Promise<void>{
 if(browserBusy)return;
 browserBusy=true;browserControls();
 try{await fn();}
 catch{setBrowserStatus('浏览器操作受阻；没有获得验证成功的结果。');}
 finally{browserBusy=false;browserControls();}
}
chooseChromeButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.chooseChrome();
 if(result.ok){
  chromeSelected=true;
  setBrowserStatus('已通过系统窗口选择 Chrome；尚未启动或验证。');
 }else setBrowserStatus('Chrome 选择未完成：'+(result.code??'UNKNOWN'));
}));
chooseProfileButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.chooseProfile();
 if(result.ok){
  profileSelected=true;
  setBrowserStatus('已通过系统窗口选择独立 Profile；尚未启动或验证。');
 }else setBrowserStatus('Profile 选择未完成：'+(result.code??'UNKNOWN'));
}));
createProfileButton?.addEventListener('click',()=>void browserAction(async()=>{
 setBrowserStatus('通过系统窗口选择新 Profile 的父目录并确认授权；绝不覆盖已有目录。');
 const result=await window.healer.createProfile();
 if(result.ok){
  profileSelected=true;
  setBrowserStatus('已创建独立空 Profile；启动 Chrome 仍需要单独确认。');
 }else setBrowserStatus('新 Profile 未创建：'+(result.code??'UNKNOWN'));
}));
launchButton?.addEventListener('click',()=>void browserAction(async()=>{
 const value=portInput?.value??'';
 const port=Number(value);
 if(!/^\d{4,5}$/.test(value)||!Number.isInteger(port)||port<1024||port>65535){
  setBrowserStatus('CDP 端口必须是 1024 至 65535 的整数。');return;
 }
 setBrowserStatus('检查独立 Chrome 配置与进程归属中；请在系统确认窗口授权。');
 const result=await window.healer.startBrowser(port);
 browserConnected=result.ok&&result.status==='OWNED_CDP_BROWSER_VERIFIED';
 setBrowserStatus(browserConnected
   ? '已确认本程序启动的 Chrome CDP 连接（'+(result.chromeVersion??'unknown')+
     '）；Tampermonkey、脚本注入和业务结果仍未验证。'
   : '独立 Chrome 启动未通过：'+(result.code??'UNKNOWN'));
}));
inspectButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.inspectTampermonkey();
 if(result.ok&&result.status==='RUNTIME_TARGET_HINT_ONLY')
  setBrowserStatus('发现 '+result.matchedRuntimeTargets+
    ' 个疑似 Tampermonkey 运行目标；扩展真实性、脚本安装、GM API 与业务执行均未验证。');
 else if(result.code==='BROWSER_NOT_RUNNING'){
  clearGmDisplay('独立 Chrome 已退出；本机测试会话无法继续。');
  browserConnected=false;
  setBrowserStatus('独立 Chrome 已退出，无法执行只读探测。');
 }else setBrowserStatus('Tampermonkey 只读探测未通过：'+(result.code??'UNKNOWN'));
}));
// Stop is intentionally NOT gated by browserAction's busy mutex. It must
// abort a pending 20-second Chrome handshake or native-consent interaction,
// and can stop only the exact child tracked by the privileged main process.
stopButton?.addEventListener('click',()=>{
 if(stopInProgress||(!browserBusy&&!browserConnected))return;
 stopInProgress=true;browserControls();
 void window.healer.stopBrowser().then(result=>{
  if(result.ok||result.code==='BROWSER_NOT_RUNNING'){
   browserConnected=false;
   clearGmDisplay('独立 Chrome 已停止；本机测试会话结束。如曾安装临时脚本，请自行从 Tampermonkey 删除。');
  }
  setBrowserStatus(result.ok?'已请求停止本程序启动的独立 Chrome。':
    '停止操作：'+(result.code??'UNKNOWN'));
 }).catch(()=>{
  setBrowserStatus('停止操作受阻；仍需确认独立 Chrome 状态。');
 }).finally(()=>{stopInProgress=false;browserControls();});
});

gmStartButton?.addEventListener('click',()=>void browserAction(async()=>{
 const runAt=gmRunAtSelect?.value;
 if(runAt!=='document-start'&&runAt!=='document-body'&&
    runAt!=='document-end'&&runAt!=='document-idle'){
  if(gmResult)gmResult.textContent='注入时机无效；本机测试未启动。';
  return;
 }
 const result=await window.healer.startGmProbe(runAt);
 if(!result.ok||result.status!=='MANUAL_FIXTURE_READY_ONLY'||
    !result.installUrl||!result.brokenUrl||!result.fixedUrl||
    !result.expiresAt){
  if(gmResult)gmResult.textContent='临时 GM 测试未启动：'+(result.code??'UNKNOWN');
  return;
 }
 gmProbeActive=true;
 // Only visible in the trusted local renderer, never written to logs.
 if(gmLinks)gmLinks.textContent='在独立 Tampermonkey 中手动从 URL 导入：'+
   result.installUrl+' ｜ 失败测试页：'+result.brokenUrl+
   ' ｜ 预设修正测试页：'+result.fixedUrl;
 if(gmResult)gmResult.textContent='测试服务已开启（'+(result.runAt??runAt)+
   '），至 '+new Date(result.expiresAt).toLocaleTimeString()+
   ' 到期；先安装临时脚本，再分别通过按钮打开并只读检查 broken / fixed。'+
   '扩展运行目标仅是提示，测试结果不是 GM 或业务恢复证明。';
}));
gmStatusButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.gmProbeStatus();
 if(!result.ok){
  clearGmDisplay('没有有效的测试会话：'+(result.code??'UNKNOWN')+
    '。如已安装临时脚本，请自行清理。');
  return;
 }
 if(gmResult)gmResult.textContent='报告模式数：'+(result.observedModes??0)+
   '；自报 GM 默认值匹配：'+Boolean(result.reportedGmDefaultMatched)+
   '；自报 broken 失败：'+Boolean(result.reportedBrokenFailed)+
   '；自报 fixed 动作：'+Boolean(result.reportedFixedRecovered)+
   '；独立 DOM 对照：'+(result.consistencyStatus??'UNKNOWN')+
   '（已比较 '+(result.comparedModes??0)+' 组；broken 动作 '+
   (result.brokenDomAction??'未观察')+'、fixed 动作 '+
   (result.fixedDomAction??'未观察')+'）。仅限未经认证的夹具对照，不证明真实 GM 或业务恢复。';
}));
gmReportButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.saveGmReport();
 if(gmResult)gmResult.textContent=result.ok&&result.status==='UNVERIFIED_REPORT_SAVED_ONLY'
  ?'已另存未经认证的本机诊断摘要：'+result.fileName+
   '（SHA-256 '+result.sha256+'，'+result.byteLength+' bytes）。'+
   '仍须真实 Tampermonkey/GM/业务专项验收。'
  :'本机报告未保存：'+(result.code??'UNKNOWN')+'。已有文件不会被覆盖。';
}));
for(const mode of ['broken','fixed'] as const){
 gmVisitButtons[mode]?.addEventListener('click',()=>void browserAction(async()=>{
  const result=await window.healer.visitGmFixture(mode);
  if(gmResult)gmResult.textContent=result.ok
   ?mode+' 专用测试页已在本程序拥有的 Chrome 打开；脚本执行未验证。'
   :'测试页未打开：'+(result.code??'UNKNOWN');
 }));
 gmObserveButtons[mode]?.addEventListener('click',()=>void browserAction(async()=>{
  const result=await window.healer.observeGmFixture(mode);
  if(gmResult)gmResult.textContent=result.ok
   ?mode+' 只读 DOM 动作数：'+result.actionCount+
      '；符合人工预设：'+Boolean(result.fixtureDomMatchesExpected)+
      '。这不是管理器或 GM API 验证。'
   :'只读 DOM 对照失败：'+(result.code??'UNKNOWN');
 }));
}
// Do not hold browserAction's busy lock when stopping; native stop cancels
// pending visit/DOM checks and the short-lived loopback fixture.
gmStopButton?.addEventListener('click',()=>{
 if(!gmProbeActive)return;
 void window.healer.stopGmProbe().then(result=>{
  clearGmDisplay(result.ok
   ?'本机测试服务已请求关闭；请自行删除独立 Tampermonkey 中的临时脚本。'
   :'没有活动的本机测试服务。');
 }).catch(()=>clearGmDisplay('关闭操作受阻；请确认本机测试已结束。'));
});
browserControls();
