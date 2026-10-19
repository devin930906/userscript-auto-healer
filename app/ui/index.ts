interface Imported {
  filename: string;
  byteLength: number;
  sha256: string;
  textEncoding: string;
  analysis: {
    status: 'STATIC_ANALYSIS_ONLY' | 'SKIPPED_TOO_LARGE' | 'INVALID_ENCODING' |
      'INVALID_METADATA' | 'PARSE_ERROR' | 'SKIPPED_BATCH_BUDGET' |
      'SKIPPED_CANCELLED' | 'ISOLATED_ANALYSIS_FAILED';
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
    cancelDroppedImport(): Promise<{ok:boolean;code?:string;status?:string}>;
    importDropped(name: string, bytes: Uint8Array): Promise<{ ok: boolean; script?: Imported; code?: string }>;
    registerScenario(input: {
      id:string;scriptSha256:string;targetUrl:string;selector:string;
      replacementSelector?:string;
      userApproved:boolean;requiresLogin:boolean;loginReady:boolean;
    }): Promise<{ok:boolean;code?:string;status?:string;id?:string;
      state?:string;issues?:readonly string[];readOnlyDomEligible?:boolean;
       automaticPatchAllowed:false;
      tampermonkeyVerified:false;businessVerified:false}>;
    exportManualScenario(id:string):Promise<{ok:boolean;code?:string;status?:string;
      backupFileName?:string;candidateFileName?:string;exportFileName?:string;
      candidateSha256?:string;candidateByteLength?:number;
      tampermonkeyVerified:false;businessVerified:false;automaticPatchAllowed:false}>;
    inspectScenario(id:string):Promise<{ok:boolean;code?:string;status?:string;
      checkedAssertions?:number;triageStatus?:string;faultCategory?:string;
      evidenceCount?:number;
      selectorComparisonStatus?:'NOT_REQUESTED'|
        'OLD_SELECTOR_MISSING_ALTERNATIVE_PRESENT'|
        'NO_SELECTOR_MISSING_IN_WINDOW'|'INCONCLUSIVE_OR_OTHER_SIGNAL';
      pageRuntimeStatus?:'PAGE_EXCEPTION_SIGNAL_ONLY'|'NO_EXCEPTION_IN_WINDOW_ONLY';
      pageExceptionCount?:number;
      tampermonkeyVerified:false;businessVerified:false;
      automaticPatchAllowed:false}>;
    cancelScenarioInspection():Promise<{ok:boolean;status?:string;code?:string}>;
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
const scenarioScript = document.getElementById('scenario-script') as HTMLSelectElement | null;
const scenarioId = document.getElementById('scenario-id') as HTMLInputElement | null;
const scenarioUrl = document.getElementById('scenario-url') as HTMLInputElement | null;
const scenarioSelector = document.getElementById('scenario-selector') as HTMLInputElement | null;
const scenarioReplacement = document.getElementById('scenario-replacement') as HTMLInputElement | null;
const scenarioNeedsLogin = document.getElementById('scenario-needs-login') as HTMLInputElement | null;
const scenarioLoginReady = document.getElementById('scenario-login-ready') as HTMLInputElement | null;
const scenarioApprove = document.getElementById('scenario-approve') as HTMLInputElement | null;
const scenarioRegister = document.getElementById('scenario-register') as HTMLButtonElement | null;
const scenarioStatus = document.getElementById('scenario-status');
const scenarioInspectId = document.getElementById('scenario-inspect-id') as HTMLSelectElement | null;
const scenarioInspectButton = document.getElementById('scenario-inspect') as HTMLButtonElement | null;
const scenarioExportButton = document.getElementById('scenario-export-manual') as HTMLButtonElement | null;
const scenarioCancelButton = document.getElementById('scenario-cancel') as HTMLButtonElement | null;
const scenarioList = document.getElementById('scenario-list');
let scenarioBusy=false;
function updateScenarioControls():void{
 if(scenarioScript)scenarioScript.disabled=seenScripts.size===0;
 if(scenarioRegister)scenarioRegister.disabled=seenScripts.size===0||scenarioBusy;
}
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
    if(scenarioScript){
      const option=document.createElement('option');
      option.value=key;
      option.textContent=item.filename+' / '+key.slice(0,12);
      scenarioScript.append(option);
      if(scenarioScript.value==='')scenarioScript.value=key;
    }
    updateScenarioControls();
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
      // Byte reading may finish first; native IPC can abort the isolated AST worker.
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
    // Cancellation covers asynchronous directory enumeration, not just the
    // later byte-import loop. Unknown/unvisited entries remain uncounted.
    if (cancelRequested) return;
    if (++visited > MAX_DIRECTORY_ENTRIES || found.length >= MAX_FILES) {
      throw new Error('SCAN_LIMIT');
    }
    if (entry.isFile) {
      // Nested directory entries are filtered, but explicitly dropped root
      // files reach the native validator so invalid filenames are reported.
      if (depth > 0 && !entry.name.toLowerCase().endsWith('.user.js')) return;
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      if (!cancelRequested) found.push(file);
      return;
    }
    if (!entry.isDirectory || cancelRequested) return;
    if (depth >= MAX_DIRECTORY_DEPTH) {
      logLine(entry.name + ': SCAN_LIMIT');
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (!cancelRequested) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject));
      if (cancelRequested || !batch.length) break;
      for (const child of batch) {
        if (cancelRequested) break;
        await visit(child, depth + 1);
      }
    }
  };
  for (const root of roots) {
    if (cancelRequested) break;
    await visit(root, 0);
  }
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
  }else{
    // A drag/drop/file-input import already reading bytes keeps its valid
    // result; only in-flight static analysis is canceled by native IPC.
    // Scanning a dropped directory can be canceled locally before IPC exists.
    void window.healer.cancelDroppedImport().catch(() => {
      logLine('当前静态分析的取消请求未确认；需等待本次导入结束。');
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
  // Start scanning synchronously inside the lock: drag data is protected
  // after the drop event returns. Keep cancellation enabled through scanning.
  const transfer = event.dataTransfer;
  void locked(async () => {
    activeImport = true;
    cancelRequested = false;
    if (cancelImport) cancelImport.disabled = false;
    updateImportSummary();
    try {
      const dropped = await filesFromDrop(transfer);
      if (cancelRequested) {
        // This is a lower bound only: remaining unenumerated files are unknown.
        unprocessedCount += dropped.length;
        logLine('已取消拖放目录扫描；已发现 ' + dropped.length +
          ' 份文件未读取，其他未枚举文件数量未知。');
        return;
      }
      await importFiles(dropped);
    } finally {
      activeImport = false;
      cancelRequested = false;
      if (cancelImport) cancelImport.disabled = true;
      updateImportSummary();
    }
  });
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


// Staging is read-only, in-memory and keyed to an actual imported SHA-256.
 // The native process checks the digest again; a renderer string cannot claim
 // script import, browser consent or Tampermonkey verification.
scenarioRegister?.addEventListener('click',()=>{
 if(scenarioBusy||!scenarioScript?.value)return;
 const input={
  id:scenarioId?.value.trim()??'',
  scriptSha256:scenarioScript.value,
  targetUrl:scenarioUrl?.value.trim()??'',
  selector:scenarioSelector?.value.trim()??'',
  ...(scenarioReplacement?.value.trim()?{replacementSelector:scenarioReplacement.value.trim()}:{}),
  userApproved:scenarioApprove?.checked===true,
  requiresLogin:scenarioNeedsLogin?.checked===true,
  loginReady:scenarioLoginReady?.checked===true
 };
 scenarioBusy=true;updateScenarioControls();
 if(scenarioStatus)scenarioStatus.textContent='正在检查本机会话场景输入；不会访问网站。';
 void window.healer.registerScenario(input).then(result=>{
  if(!result.ok||result.status!=='STAGED_RUNTIME_UNVERIFIED'){
   if(scenarioStatus)scenarioStatus.textContent='场景未登记：'+(result.code??'UNKNOWN');
   return;
  }
  if(scenarioStatus)scenarioStatus.textContent='场景登记成功：'+
   (result.state??'UNKNOWN')+'。'+(result.readOnlyDomEligible===true
     ?'可申请限定只读 DOM 检查；仍未验证任何业务动作。'
     :'仅已登记；当前不符合限定只读 DOM 检查条件，未执行任何业务动作。');
  // Native eligibility is a UI hint only. The privileged main process
  // independently rechecks ownership and requires fresh native consent.
  if(scenarioInspectId&&result.readOnlyDomEligible===true){
   const option=document.createElement('option');
   option.value=result.id??input.id;
   option.textContent=result.id??input.id;
   scenarioInspectId.append(option);
   if(scenarioInspectId.value==='')scenarioInspectId.value=option.value;
  }
  browserControls();
  const item=document.createElement('li');
  item.textContent=(result.id??input.id)+' / '+input.scriptSha256.slice(0,12)+
   ' / '+(result.state??'UNKNOWN')+
   ' / '+(result.issues?.join(',')||'无登记前置问题')+
   '（未执行、未修改脚本）';
  scenarioList?.append(item);
 }).catch(()=>{
  if(scenarioStatus)scenarioStatus.textContent='场景登记受阻；未获得成功结果。';
 }).finally(()=>{scenarioBusy=false;updateScenarioControls();});
});
updateScenarioControls();

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
let scenarioInspectionBusy=false;
let manualExportBusy=false;
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
 if(scenarioInspectId)scenarioInspectId.disabled=!browserConnected||browserBusy||
   (scenarioInspectId.options.length<=1);
 if(scenarioInspectButton)scenarioInspectButton.disabled=!browserConnected||browserBusy||
   (scenarioInspectId?.options.length??0)<=1;
 if(scenarioCancelButton)scenarioCancelButton.disabled=!scenarioInspectionBusy;
 if(scenarioExportButton)scenarioExportButton.disabled=!browserConnected||browserBusy||
   manualExportBusy||(scenarioInspectId?.options.length??0)<=1;
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
scenarioInspectButton?.addEventListener('click',()=>void browserAction(async()=>{
 const id=scenarioInspectId?.value??'';
 if(!id){
  if(scenarioStatus)scenarioStatus.textContent='必须先登记并选择一个场景。';
  return;
 }
 scenarioInspectionBusy=true;browserControls();
 if(scenarioStatus)scenarioStatus.textContent='等待系统原生授权；限定 DOM 检查和短时页面 JavaScript 异常观察都不是业务验收。';
 try{
  const result=await window.healer.inspectScenario(id);
  if(scenarioStatus)scenarioStatus.textContent=result.ok&&result.status==='LIMITED_DOM_SIGNAL_ONLY'
   ?'场景 '+id+'：只读 DOM 断言 '+(result.checkedAssertions??0)+
      ' 项；故障信号 '+(result.faultCategory??'UNKNOWN')+
      ' / '+(result.triageStatus??'UNKNOWN')+
      '，证据数 '+(result.evidenceCount??0)+
      '；双选择器人工审核提示：'+(
        result.selectorComparisonStatus==='OLD_SELECTOR_MISSING_ALTERNATIVE_PRESENT'
          ?'本次稳定 DOM 观察到旧选择器缺失、替代选择器存在；仅供人工审核，不证明补丁能修复脚本'
          :result.selectorComparisonStatus==='NO_SELECTOR_MISSING_IN_WINDOW'
            ?'本次窗口两项选择器均未观察到缺失；未发现此类故障'
            :result.selectorComparisonStatus==='INCONCLUSIVE_OR_OTHER_SIGNAL'
              ?'无法确认旧缺失而新存在；请人工复核'
              :'未申请双选择器比较')+
      '；页面 JavaScript 异常：'+(result.pageRuntimeStatus==='PAGE_EXCEPTION_SIGNAL_ONLY'
        ?'在 1.2 秒窗口观察到 '+(result.pageExceptionCount??0)+' 次（不能归因油猴脚本）'
        :result.pageRuntimeStatus==='NO_EXCEPTION_IN_WINDOW_ONLY'
          ?'1.2 秒窗口未观察到（不代表没有异常）'
          :'未取得可靠的页面异常观察')+
      '。仅为只读页面信号，Tampermonkey、GM 和真实业务未验证。'
   :'场景检查未通过：'+(result.code??'UNKNOWN')+
      '。没有获得 Tampermonkey 或业务验证结果。';
  if(result.code==='BROWSER_NOT_RUNNING')browserConnected=false;
 }finally{scenarioInspectionBusy=false;browserControls();}
}));
scenarioExportButton?.addEventListener('click',()=>void browserAction(async()=>{
 const id=scenarioInspectId?.value??'';
 if(!id){
  if(scenarioStatus)scenarioStatus.textContent='先选择已登记的双选择器场景。';
  return;
 }
 manualExportBusy=true;browserControls();
 if(scenarioStatus)scenarioStatus.textContent=
   '正在等待原生授权并重新采集真实 DOM；未获授权、证据不足或源文件变化时不会导出。';
 try{
  const answer=await window.healer.exportManualScenario(id);
  if(scenarioStatus)scenarioStatus.textContent=
   answer.ok&&answer.status==='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED'
    ?'已生成本地人工审核候选：'+(answer.exportFileName??'')+
      '（'+(answer.candidateByteLength??0)+' 字节；SHA-256 '+(answer.candidateSha256??'')+
      '）。独立备份：'+(answer.backupFileName??'')+
      '。原始脚本未被本程序改写；仍需用户自行在真实 Tampermonkey 中审阅、安装、运行并验证业务。'
    :'人工导出未完成：'+(answer.code??'UNKNOWN')+
      '。未取得可用的候选导出回执；可能存在独立暂存文件，须检查所选文件夹。';
  if(answer.code==='BROWSER_NOT_RUNNING'||answer.code==='SESSION_REVOKED')
   browserConnected=false;
 }finally{manualExportBusy=false;browserControls();}
}));
scenarioCancelButton?.addEventListener('click',()=>{
 if(!scenarioInspectionBusy)return;
 scenarioCancelButton.disabled=true;
 void window.healer.cancelScenarioInspection().then(result=>{
  if(scenarioStatus)scenarioStatus.textContent=result.ok
   ?'已请求取消限定 DOM 检查；已打开的标签页不会被用于通过验收。'
   :'取消请求未完成：'+(result.code??'UNKNOWN');
 }).catch(()=>{
  if(scenarioStatus)scenarioStatus.textContent='取消检查失败，需核实运行状态。';
 });
});
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
