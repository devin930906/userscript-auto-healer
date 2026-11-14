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
  batchCheckpoint?:'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'|'BLOCKED';
  batchCheckpointReason?:string;
  batchResumed?:boolean;
}
interface NativeImportProgress {
  active:boolean;
  phase?:'PICKING'|'SCANNING'|'IMPORTING'|'ANALYZING';
  processed?:number;total?:number;
  accepted?:number;duplicates?:number;failed?:number;
}
interface Window {
  healer: {
    getStatus(): Promise<{ shell: string; automaticRepairAvailable: boolean; aiEnabled: boolean; automaticApplyEnabled: boolean }>;
    requestNativeAiReview(id:string):Promise<{ok:boolean;code?:string;
      status?:'UNTRUSTED_AI_TEXT_ONLY';candidateText?:string;model?:string;
      automaticPatchAllowed:false;automaticRollbackAllowed?:false}>;
    discoverNativeAiModels():Promise<{ok:boolean;code?:string;
      status?:'MODELS_DISCOVERED'|'MANUAL_MODEL_FALLBACK';
      models?:readonly string[];manualModelAvailable?:boolean;
      automaticPatchAllowed:false}>;
    chooseFiles(): Promise<ImportResponse>;
    chooseFolder(): Promise<ImportResponse>;
    cancelNativeImport(): Promise<{ok:boolean;code?:string;status?:string}>;
    getNativeImportProgress(): Promise<NativeImportProgress>;
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
      recoveryExportFileName?:string;checkpointFileName?:string;
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
      sessionHealthStatus?:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'|'UNAVAILABLE';
      sessionHealthEventCount?:number;
      localArchiveStatus?:'SAVED_UNVERIFIED'|'UNAVAILABLE';
      tampermonkeyVerified:false;businessVerified:false;
      automaticPatchAllowed:false}>;
    readScenarioHistory(id:string):Promise<{ok:boolean;code?:string;status?:string;
      currentStatus?:'UNTESTED'|'ELEMENT_FOUND_ONLY'|'INDETERMINATE';
      archiveRetained?:boolean;
      archiveUnavailable?:true;
      events?:readonly {observedAtMs:number;
        status:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'}[];
      tampermonkeyVerified:false;businessVerified:false;
      automaticPatchAllowed:false;automaticRollbackAllowed:false}>;
    cancelScenarioInspection():Promise<{ok:boolean;status?:string;code?:string}>;
    inspectRestoreIntent():Promise<{ok:boolean;code?:string;status?:string;
      sourceState?:'ORIGINAL_PRESENT'|'DISPLACED_PRESENT';
      automaticPatchAllowed:false;businessVerified:false;tampermonkeyVerified:false}>;
    inspectRestoreInventory():Promise<{ok:boolean;code?:string;status?:string;
      inspected?:number;originalPresent?:number;displacedPresent?:number;rejected?:number;
      automaticPatchAllowed:false;businessVerified:false;tampermonkeyVerified:false}>;
    restoreManualOriginal():Promise<{ok:boolean;code?:string;status?:string;
      journalFileName?:string;displacedBackupFileName?:string;
      automaticPatchAllowed:false;tampermonkeyVerified:false;businessVerified:false}>;
    chooseChrome(): Promise<{ok:boolean;code?:string;filename?:string}>;
    chooseProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    createProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    startBrowser(port:number): Promise<{ok:boolean;code?:string;status?:string;chromeVersion?:string}>;
    connectExistingChrome(port:number): Promise<{ok:boolean;code?:string;status?:string;chromeVersion?:string}>;
    disconnectExistingChrome(): Promise<{ok:boolean;code?:string;status?:string}>;
    inspectTampermonkey(): Promise<{ok:boolean;code?:string;status?:string;matchedRuntimeTargets?:number}>;
    openTampermonkeyStore(): Promise<{ok:boolean;code?:string;status?:string;
      tampermonkeyVerified:false;gmApiVerified:false;businessVerified:false;
      automaticPatchAllowed:false}>;
    stopBrowser(): Promise<{ok:boolean;code?:string;status?:string}>;
    startGmProbe(runAt?:'document-start'|'document-body'|'document-end'|'document-idle'): Promise<{ok:boolean;code?:string;status?:string;runAt?:string;
      installUrl?:string;brokenUrl?:string;fixedUrl?:string;expiresAt?:number}>;
    saveGmReport(): Promise<{ok:boolean;code?:string;status?:string;fileName?:string;sha256?:string;byteLength?:number}>;
    gmProbeStatus(): Promise<{ok:boolean;code?:string;status?:string;
      observedModes?:number;reportedGmDefaultMatched?:boolean;
      reportedGmStorageRoundtripMatched?:boolean;
      reportedBrokenFailed?:boolean;reportedFixedRecovered?:boolean;
      consistencyStatus?:string;comparedModes?:number;
      brokenDomAction?:number|null;fixedDomAction?:number|null;
      brokenReport?:Readonly<{reportStatus:'NOT_REPORTED'|'SELF_REPORTED_ONLY'|'REJECTED_REPORT';
        reportedGmDefaultMatched:boolean|null;reportedGmStorageRoundtripMatched:boolean|null;
        reportedBusinessAction:boolean|null;tampermonkeyVerified:false;
        gmApiVerified:false;businessVerified:false}>;
      fixedReport?:Readonly<{reportStatus:'NOT_REPORTED'|'SELF_REPORTED_ONLY'|'REJECTED_REPORT';
        reportedGmDefaultMatched:boolean|null;reportedGmStorageRoundtripMatched:boolean|null;
        reportedBusinessAction:boolean|null;tampermonkeyVerified:false;
        gmApiVerified:false;businessVerified:false}>}>;
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
const intentInspectButton=document.getElementById('restore-inspect-intent') as HTMLButtonElement|null;
const intentInspectResult=document.getElementById('restore-inspect-result');
const intentInventoryButton=document.getElementById('restore-inspect-inventory') as HTMLButtonElement|null;
const intentInventoryResult=document.getElementById('restore-inventory-result');
const manualRestoreButton=document.getElementById('restore-manual-original') as HTMLButtonElement|null;
const manualRestoreResult=document.getElementById('restore-manual-result');
let manualRestoreBusy=false;
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
const aiReviewButton=document.getElementById('ai-reviewed-suggest') as HTMLButtonElement|null;
const aiReviewResult=document.getElementById('ai-reviewed-result');
let aiReviewPending=false;
// A previously authorized AI response cannot be attributed to a later
// scenario selection, even if the selector returns to the old value.
let aiReviewGeneration=0;
// A renderer hint only: the native gateway separately checks its own
// authorized observation receipt and still asks for consent before network.
const observedScenarioIds=new Set<string>();
scenarioInspectId?.addEventListener('change',()=>browserControls());
const scenarioInspectButton = document.getElementById('scenario-inspect') as HTMLButtonElement | null;
const scenarioRecheckStartButton = document.getElementById('scenario-recheck-start') as HTMLButtonElement | null;
const scenarioRecheckStopButton = document.getElementById('scenario-recheck-stop') as HTMLButtonElement | null;
const scenarioRecheckStatus = document.getElementById('scenario-recheck-status');
let recheckRunning=false;
let recheckCancelled=false;
let recheckNativeActive=false;
let recheckTimer:ReturnType<typeof setTimeout>|null=null;
let recheckWake:(()=>void)|null=null;
const RECHECK_INTERVAL_MS=60_000;
const RECHECK_MAX_ROUNDS=3;
function revokeBoundedRechecks():void{
 recheckCancelled=true;
 if(recheckTimer!==null){clearTimeout(recheckTimer);recheckTimer=null;}
 const wake=recheckWake;
 recheckWake=null;
 wake?.();
}
function waitRecheckInterval():Promise<void>{
 return new Promise(resolve=>{
  recheckWake=resolve;
  recheckTimer=setTimeout(()=>{
   recheckTimer=null;
   recheckWake=null;
   resolve();
  },RECHECK_INTERVAL_MS);
 });
}
const scenarioHistoryButton = document.getElementById('scenario-history') as HTMLButtonElement | null;
const scenarioHistorySummary = document.getElementById('scenario-history-summary');
const scenarioHistoryEntries = document.getElementById('scenario-history-entries');
let scenarioHistoryBusy=false;
// A superseded read-only history request cannot repaint another scenario.
let scenarioHistoryGeneration=0;
const scenarioExportButton = document.getElementById('scenario-export-manual') as HTMLButtonElement | null;
const scenarioCancelButton = document.getElementById('scenario-cancel') as HTMLButtonElement | null;
const scenarioList = document.getElementById('scenario-list');
let scenarioBusy=false;
function updateScenarioControls():void{
 if(scenarioScript)scenarioScript.disabled=seenScripts.size===0;
 if(scenarioRegister)scenarioRegister.disabled=seenScripts.size===0||scenarioBusy||
  scenarioApprove?.checked!==true;
}
// Consent is scoped to this registration attempt. Revoking it immediately
// disables the renderer action; the native service verifies consent again.
scenarioApprove?.addEventListener('change', updateScenarioControls);
let busy = false;
let activeImport = false;
let nativeImportMode = false;
let liveNativeImportProgress:NativeImportProgress|null=null;
// Independent renderer-side lifetime marker: an old IPC progress receipt
// must never overwrite a newer native picker batch's visible state.
let nativeImportGeneration=0;
const phaseRank:Record<NonNullable<NativeImportProgress['phase']>,number>={
 PICKING:0,SCANNING:1,IMPORTING:2,ANALYZING:3
};
/** The native producer starts analysis counters at zero after import.
 * Preserve phase ordering while accepting only forward counts inside a phase.
 * This affects UI presentation only, not IPC authority or imported bytes.
 */
function shouldAcceptNativeImportProgress(
 current:NativeImportProgress|null,next:NativeImportProgress
):boolean{
 if(!current?.active)return true;
 const incomingRank=phaseRank[next.phase!];
 const currentRank=phaseRank[current.phase!];
 if(incomingRank<currentRank)return false;
 if(incomingRank===currentRank&&(
   next.total!<current.total!||
   next.processed!<current.processed!||
   next.accepted!<current.accepted!||
   next.duplicates!<current.duplicates!||
   next.failed!<current.failed!
 ))return false;
 return true;
}
let cancelRequested = false;
let dropScanController: AbortController | null = null;
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
      : ' 不代表真实 Tampermonkey 或业务修复验证。')+
    (nativeImportMode&&liveNativeImportProgress?.active===true
      ? ' 原生进度：'+({
          PICKING:'等待选择文件',SCANNING:'扫描授权文件夹',
          IMPORTING:'读取文件',ANALYZING:'隔离 AST 分析'
        }[liveNativeImportProgress.phase??'PICKING'])+
        ' '+(liveNativeImportProgress.processed??0)+'/'+
        (liveNativeImportProgress.total??0)+
        '（成功 '+(liveNativeImportProgress.accepted??0)+
        '、重复 '+(liveNativeImportProgress.duplicates??0)+
        '、失败 '+(liveNativeImportProgress.failed??0)+'）'
      : '');
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
  const generation=++nativeImportGeneration;
  activeImport = true;
  nativeImportMode = true;
  liveNativeImportProgress=null;
  cancelRequested = false;
  if (cancelImport) cancelImport.disabled = false;
  updateImportSummary();
  // Poll only while this exact native request owns the renderer import state.
  // The bridge returns bounded counters, never source hashes/paths or script text.
  const refresh=async()=>{
    try {
      const result=await window.healer.getNativeImportProgress();
      if(!activeImport||!nativeImportMode||generation!==nativeImportGeneration)return;
      if(result.active&&typeof result.phase==='string'&&
         ['PICKING','SCANNING','IMPORTING','ANALYZING'].includes(result.phase)&&
         [result.processed,result.total,result.accepted,result.duplicates,result.failed]
           .every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1000)&&
         result.processed! <= result.total!&&
         shouldAcceptNativeImportProgress(liveNativeImportProgress,result)){
        liveNativeImportProgress=result;
        updateImportSummary();
      }
    }catch{/* progress UI cannot change the authenticated import */}
  };
  const poll=window.setInterval(()=>void refresh(),250);
  void refresh();
  try {
    const result = kind === 'files'
      ? await window.healer.chooseFiles()
      : await window.healer.chooseFolder();
    show(result);
    if (result.batchCheckpoint==='BLOCKED')
      logLine('批处理检查点未保存：'+(result.batchCheckpointReason??'UNKNOWN')+
        '；已导入的原始文件未被修改，静态分析不能据此视为已完成。');
    else if(result.batchCheckpoint==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
      logLine(result.batchResumed?'已重新核对同批脚本的只读持久调度记录；仍重新分析源码，不代表修复完成。':
        '只读 AST 批处理检查点已保存；仅记录有限调度状态，不授权修复脚本。');
    if (result.canceled) {
      unprocessedCount += result.unprocessed ?? 0;
      logLine('原生选择导入已取消；已经完成的只读结果仍保留。');
    }
  } finally {
    nativeImportGeneration++;
    window.clearInterval(poll);
    liveNativeImportProgress=null;
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
/** Legacy directory-entry APIs cannot be interrupted at the browser layer.
 * Settle a pending callback on cancel and ignore all late replies. */
function readDropEntry<T>(
  start:(ok:(value:T)=>void,fail:(error:DOMException)=>void)=>void,
  signal:AbortSignal
):Promise<T|null>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){resolve(null);return;}
    let settled=false;
    const finish=(value:T|null,error?:unknown)=>{
      if(settled)return;
      settled=true;
      clearTimeout(deadline);
      signal.removeEventListener('abort',onAbort);
      if(error!==undefined)reject(error);
      else resolve(value);
    };
    const onAbort=()=>finish(null);
    const deadline=setTimeout(()=>finish(null,new Error('DROP_ENTRY_TIMEOUT')),10000);
    signal.addEventListener('abort',onAbort,{once:true});
    try{start(value=>finish(value),error=>finish(null,error));}
    catch(error){finish(null,error);}
  });
}
async function filesFromDrop(transfer: DataTransfer,signal:AbortSignal): Promise<File[]> {
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
  let scanLimitReached=false;
  const visit = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    // Cancellation covers asynchronous directory enumeration, not just the
    // later byte-import loop. Unknown/unvisited entries remain uncounted.
    if (cancelRequested || signal.aborted || scanLimitReached) return;
    if (++visited > MAX_DIRECTORY_ENTRIES || found.length >= MAX_FILES) {
      // Preserve already enumerated files instead of discarding the batch.
      // No further entry or directory is read once either bound is reached.
      scanLimitReached=true;
      return;
    }
    if (entry.isFile) {
      // Nested directory entries are filtered, but explicitly dropped root
      // files reach the native validator so invalid filenames are reported.
      if (depth > 0 && !entry.name.toLowerCase().endsWith('.user.js')) return;
      const file = await readDropEntry<File>(
        (ok,fail)=>(entry as FileSystemFileEntry).file(ok,fail),signal);
      if (file&&!cancelRequested&&!signal.aborted) found.push(file);
      return;
    }
    if (!entry.isDirectory || cancelRequested) return;
    if (depth >= MAX_DIRECTORY_DEPTH) {
      logLine(entry.name + ': SCAN_LIMIT');
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (!cancelRequested&&!signal.aborted&&!scanLimitReached) {
      const batch = await readDropEntry<FileSystemEntry[]>(
        (ok,fail)=>reader.readEntries(ok,fail),signal);
      if (cancelRequested||signal.aborted||!batch||!batch.length) break;
      for (const child of batch) {
        if (cancelRequested||signal.aborted||scanLimitReached) break;
        await visit(child, depth + 1);
      }
    }
  };
  for (const root of roots) {
    if (cancelRequested||signal.aborted||scanLimitReached) break;
    await visit(root, 0);
  }
  if(scanLimitReached)logLine('拖放扫描达到上限；已发现 '+found.length+
    ' 份文件，其余未扫描文件数量未知。已发现文件仍会进行只读验证。');
  return found;
}

cancelImport?.addEventListener('click', () => {
  if (!activeImport || cancelRequested) return;
  cancelRequested = true;
  cancelImport.disabled = true;
  updateImportSummary();
  if (!nativeImportMode) dropScanController?.abort();
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
  if (!(event instanceof DragEvent) || !event.dataTransfer) return;
  if (busy) {
    // The current batch owns the drop target: do not silently imply that
    // the second batch was accepted, and never enumerate its file entries.
    logLine('当前仍在导入；本次拖放未接收，请等待完成后重新拖放。');
    return;
  }
  // A second drop must not traverse entries while an earlier batch owns the lock.
  // Start scanning synchronously inside the lock: drag data is protected
  // after the drop event returns. Keep cancellation enabled through scanning.
  const transfer = event.dataTransfer;
  void locked(async () => {
    activeImport = true;
    cancelRequested = false;
    const scanController=new AbortController();
    dropScanController=scanController;
    if (cancelImport) cancelImport.disabled = false;
    updateImportSummary();
    try {
      const dropped = await filesFromDrop(transfer,scanController.signal);
      if (cancelRequested) {
        // This is a lower bound only: remaining unenumerated files are unknown.
        unprocessedCount += dropped.length;
        logLine('已取消拖放目录扫描；已发现 ' + dropped.length +
          ' 份文件未读取，其他未枚举文件数量未知。');
        return;
      }
      // Enumeration finished; any later cancellation belongs to byte import.
      dropScanController=null;
      await importFiles(dropped);
    } finally {
      scanController.abort();
      if(dropScanController===scanController)dropScanController=null;
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
 if(scenarioBusy||!scenarioScript?.value||scenarioApprove?.checked!==true)return;
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
 // The checkbox grants exactly this captured registration, not a reusable
 // approval for a later click, retry, or a modified scenario. The main
 // process still independently verifies the explicit userApproved input.
 if(scenarioApprove)scenarioApprove.checked=false;
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
const connectExistingButton=document.getElementById('connect-existing-chrome') as HTMLButtonElement|null;
const disconnectExistingButton=document.getElementById('disconnect-existing-chrome') as HTMLButtonElement|null;
const inspectButton=document.getElementById('inspect-tampermonkey') as HTMLButtonElement|null;
const managerStoreButton=document.getElementById('open-tampermonkey-store') as HTMLButtonElement|null;
const stopButton=document.getElementById('stop-chrome') as HTMLButtonElement|null;
const portInput=document.getElementById('chrome-port') as HTMLInputElement|null;
const browserStatus=document.getElementById('browser-status');
let browserBusy=false;
function selectedCdpPort():number|null{
 const value=portInput?.value??'';
 const port=Number(value);
 return /^\d{4,5}$/.test(value)&&Number.isInteger(port)&&port>=1024&&port<=65535?port:null;
}
let scenarioInspectionBusy=false;
let manualExportBusy=false;
let stopInProgress=false;
let chromeSelected=false;
let profileSelected=false;
let browserConnected=false;
// A connected user Chrome stays separate from the app-owned diagnostic browser.
// This prevents external sessions from enabling the isolated GM test workflow.
let existingChromeConnected=false;
let existingConnectionBusy=false;
let existingDisconnectBusy=false;
// Renderer-only lifecycle token: a stopped Chrome cannot be resurrected by
// the delayed success reply of a pre-stop native launch handshake.
let browserSessionGeneration=0;
let gmProbeActive=false;
let gmProbeStarting=false;
let gmStopInProgress=false;
// A native stop revokes presentation authority of any earlier GM start reply.
// This renderer token does not grant fixture ownership or bypass native checks.
let gmProbeGeneration=0;
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
// An expired or explicitly revoked native fixture is not a usable UI session.
// Keep ordinary consent cancellation and transient failures visible without
// discarding a still-valid fixture; browserAction restores button states.
function retireGmIfNativeSessionGone(code:string|undefined):boolean{
 if(code!=='NO_ACTIVE_FIXTURE'&&code!=='SESSION_REVOKED')return false;
 clearGmDisplay('临时 GM 测试服务已结束或撤销，旧测试链接已失效。'+
  '若曾安装临时脚本，请自行从 Tampermonkey 删除。');
 return true;
}

function setBrowserStatus(value:string):void{
 if(browserStatus)browserStatus.textContent=value;
}
function browserControls():void{
 // Keep new browser actions disabled until native stop IPC has settled.
 const controlsBusy=browserBusy||stopInProgress;
 const externalBusy=(typeof existingConnectionBusy!=='undefined'&&existingConnectionBusy)||
   (typeof existingDisconnectBusy!=='undefined'&&existingDisconnectBusy);
 const allControlsBusy=controlsBusy||externalBusy;
 const externalConnected=typeof existingChromeConnected!=='undefined'&&existingChromeConnected;
 const anyBrowserConnected=browserConnected||externalConnected;
 if(chooseChromeButton)chooseChromeButton.disabled=controlsBusy||allControlsBusy||anyBrowserConnected;
 if(chooseProfileButton)chooseProfileButton.disabled=controlsBusy||allControlsBusy||anyBrowserConnected;
 if(createProfileButton)createProfileButton.disabled=controlsBusy||allControlsBusy||anyBrowserConnected||!chromeSelected;
 if(portInput)portInput.disabled=controlsBusy||allControlsBusy||anyBrowserConnected;
 if(launchButton)launchButton.disabled=controlsBusy||allControlsBusy||anyBrowserConnected||
   !chromeSelected||!profileSelected;
 if(typeof connectExistingButton!=='undefined'&&connectExistingButton)connectExistingButton.disabled=controlsBusy||allControlsBusy||anyBrowserConnected||
   !chromeSelected||!profileSelected;
 if(typeof disconnectExistingButton!=='undefined'&&disconnectExistingButton)disconnectExistingButton.disabled=
   (typeof existingDisconnectBusy!=='undefined'&&existingDisconnectBusy)||
   (!externalConnected&&!(typeof existingConnectionBusy!=='undefined'&&existingConnectionBusy));
 if(inspectButton)inspectButton.disabled=controlsBusy||allControlsBusy||!anyBrowserConnected;
 if(managerStoreButton)managerStoreButton.disabled=allControlsBusy||!browserConnected;
 if(stopButton)stopButton.disabled=stopInProgress||(!browserConnected&&!browserBusy);
 // History is a native read-only view and does not require live Chrome.
 // Keep scenario selection available offline; every live DOM/AI/export action
 // still enforces its own browserConnected and native authorization gates.
 if(scenarioInspectId)scenarioInspectId.disabled=controlsBusy||
   (scenarioInspectId.options.length<=1);
 if(scenarioInspectButton)scenarioInspectButton.disabled=!browserConnected||controlsBusy||
   (scenarioInspectId?.options.length??0)<=1;
 if(scenarioRecheckStartButton)scenarioRecheckStartButton.disabled=
   recheckRunning||!browserConnected||controlsBusy||
   (scenarioInspectId?.options.length??0)<=1;
 if(scenarioRecheckStopButton)scenarioRecheckStopButton.disabled=!recheckRunning;
 if(scenarioCancelButton)scenarioCancelButton.disabled=!(scenarioInspectionBusy||manualExportBusy);
 if(scenarioHistoryButton)scenarioHistoryButton.disabled=scenarioHistoryBusy||
   (scenarioInspectId?.options.length??0)<=1;
 if(scenarioExportButton)scenarioExportButton.disabled=!browserConnected||controlsBusy||
   manualExportBusy||(scenarioInspectId?.options.length??0)<=1;
 if(aiReviewButton)aiReviewButton.disabled=aiReviewPending||controlsBusy||
   !browserConnected||scenarioInspectionBusy||
   !observedScenarioIds.has(scenarioInspectId?.value??'');
 if(gmStartButton)gmStartButton.disabled=controlsBusy||!browserConnected||gmProbeActive;
 if(gmRunAtSelect)gmRunAtSelect.disabled=controlsBusy||gmProbeActive;
 if(gmStatusButton)gmStatusButton.disabled=controlsBusy||!gmProbeActive;
 if(gmReportButton)gmReportButton.disabled=controlsBusy||!gmProbeActive;
 for(const button of Object.values(gmVisitButtons))
  if(button)button.disabled=controlsBusy||!gmProbeActive;
 for(const button of Object.values(gmObserveButtons))
  if(button)button.disabled=controlsBusy||!gmProbeActive;
 // Native stop can revoke an in-flight GM start before the fixture exists.
 // Do not gate it behind browserAction's busy flag or an active fixture.
 if(gmStopButton)gmStopButton.disabled=gmStopInProgress||
   (!gmProbeStarting&&!gmProbeActive);
}
async function browserAction(fn:()=>Promise<void>):Promise<void>{
 if(browserBusy||stopInProgress)return;
 browserBusy=true;browserControls();
 try{await fn();}
 catch{setBrowserStatus('浏览器操作受阻；没有获得验证成功的结果。');}
 finally{browserBusy=false;browserControls();}
}
scenarioHistoryButton?.addEventListener('click',()=>{
 if(scenarioHistoryBusy)return;
 const id=scenarioInspectId?.value??'';
 if(!id){if(scenarioHistorySummary)scenarioHistorySummary.textContent='请先登记并选择一个只读场景。';return;}
 const requestGeneration=++scenarioHistoryGeneration;
 const isCurrentHistoryRequest=()=>requestGeneration===scenarioHistoryGeneration&&
   scenarioInspectId?.value===id;
 scenarioHistoryBusy=true;browserControls();
 scenarioHistoryEntries?.replaceChildren();
 if(scenarioHistorySummary)scenarioHistorySummary.textContent='正在读取本窗口及可能存在的本机脱敏历史；不会访问浏览器。';
 void window.healer.readScenarioHistory(id).then(view=>{
  if(!isCurrentHistoryRequest())return;
  if(!view.ok||view.status!=='UNVERIFIED_SESSION_HISTORY_ONLY'||!Array.isArray(view.events)){
   if(scenarioHistorySummary)scenarioHistorySummary.textContent='观察历史不可用：'+(view.code??'UNKNOWN');
   return;
  }
  if(scenarioHistorySummary)scenarioHistorySummary.textContent='当前状态：'+(
   view.currentStatus==='ELEMENT_FOUND_ONLY'?'仅观察到元素存在':
   view.currentStatus==='INDETERMINATE'?'证据不足／已过期':'尚未观察')+
   '；'+(view.archiveUnavailable?
    '本机持久历史暂无法读取，以下仅为当前窗口的观察；旧记录可能存在。':
    view.archiveRetained?'本机持久的未验证历史':'当前窗口的有限历史')+
   '共 '+view.events.length+' 条（最多 32 条）。旧历史不作为当前健康认证，也不证明脚本或业务正常。';
  for(const event of view.events){
   const row=document.createElement('li');
   row.textContent=new Date(event.observedAtMs).toLocaleString()+' — '+(
    event.status==='ELEMENT_FOUND_ONLY'?'只读 DOM 元素存在（未经验证）':
    '证据不足（未经验证）');
   scenarioHistoryEntries?.append(row);
  }
 }).catch(()=>{
  if(!isCurrentHistoryRequest())return;
  if(scenarioHistorySummary)scenarioHistorySummary.textContent='观察历史读取失败；不推断脚本状态。';
 }).finally(()=>{
  if(requestGeneration!==scenarioHistoryGeneration)return;
  scenarioHistoryBusy=false;browserControls();
 });
});
scenarioInspectId?.addEventListener('change',()=>{
 // A native read can finish later; its old scenario no longer owns this UI.
 // Retire the presentation lock without canceling or trusting the old IPC.
 scenarioHistoryGeneration++;
 scenarioHistoryBusy=false;
 scenarioHistoryEntries?.replaceChildren();
 if(scenarioHistorySummary)
  scenarioHistorySummary.textContent='已切换场景；请重新点击查看当前场景的观察历史。';
 browserControls();
});
// Explicitly user-started bounded monitoring, never unattended background
// authority. Each round re-enters the existing main-process native dialog,
// owned-browser check and read-only IPC. A refusal, failure, cancellation,
// browser stop or lost window stops the remainder of the plan.
scenarioRecheckStartButton?.addEventListener('click',()=>{
 if(recheckRunning||browserBusy||stopInProgress||!browserConnected)return;
 const id=scenarioInspectId?.value??'';
 if(!id){
  if(scenarioRecheckStatus)scenarioRecheckStatus.textContent='先选择已登记场景。';
  return;
 }
 recheckRunning=true;
 recheckCancelled=false;
 browserBusy=true;
 browserControls();
 void (async()=>{
  let stoppedByFailure=false;
  let finished=false;
  try{
   for(let round=1;round<=RECHECK_MAX_ROUNDS;round++){
    if(recheckCancelled||!browserConnected)break;
    if(scenarioRecheckStatus)scenarioRecheckStatus.textContent=
     '第 '+round+'/'+RECHECK_MAX_ROUNDS+
     ' 轮：等待本次独立原生授权；未授权不访问页面。';
    recheckNativeActive=true;
    let result:Awaited<ReturnType<typeof window.healer.inspectScenario>>;
    try{result=await window.healer.inspectScenario(id);}
    finally{recheckNativeActive=false;}
    if(recheckCancelled)break;
    if(!result.ok||result.status!=='LIMITED_DOM_SIGNAL_ONLY'){
     stoppedByFailure=true;
     if(scenarioRecheckStatus)scenarioRecheckStatus.textContent=
      '第 '+round+' 轮未通过：'+(result.code??'UNKNOWN')+
      '。后续复检已停止，未取得业务或管理器健康验证。';
     break;
    }
    observedScenarioIds.add(id);
    browserControls();
    if(round===RECHECK_MAX_ROUNDS)finished=true;
    if(scenarioRecheckStatus)scenarioRecheckStatus.textContent=
     '第 '+round+'/'+RECHECK_MAX_ROUNDS+' 轮：仅取得未验证 DOM 信号；'+
     '本机脱敏记录'+(result.localArchiveStatus==='SAVED_UNVERIFIED'?'已保存':'保存未确认')+
     '。不代表 Tampermonkey、GM 或业务恢复。'+
     (round<RECHECK_MAX_ROUNDS?'下轮间隔 60 秒，仍须重新原生授权。':'三轮结束。');
    if(round<RECHECK_MAX_ROUNDS)await waitRecheckInterval();
   }
  }catch{
   stoppedByFailure=true;
   if(!recheckCancelled&&scenarioRecheckStatus)
    scenarioRecheckStatus.textContent='复检请求失败；后续轮次已停止，结果未知。';
  }finally{
   const interrupted=recheckCancelled||!browserConnected;
   revokeBoundedRechecks();
   recheckRunning=false;
   recheckNativeActive=false;
   browserBusy=false;
   if(interrupted&&!stoppedByFailure&&!finished&&scenarioRecheckStatus)
    scenarioRecheckStatus.textContent='复检计划已停止；不再发起后续访问。';
   browserControls();
  }
 })();
});
/** A scheduled recheck is scoped to its originally selected scenario.
 * Switching the selected scenario cancels subsequent native visits to the
 * original target, without pretending an in-flight observation is undone.
 */
function stopScheduledRechecks(reason:'user'|'selection'):void{
 if(!recheckRunning)return;
 const cancelNative=recheckNativeActive;
 revokeBoundedRechecks();
 if(scenarioRecheckStatus)
  scenarioRecheckStatus.textContent=
   (reason==='selection'
     ?'已切换场景；原场景的后续复检已取消。'
     :'停止已请求；后续复检不会启动。')+
   (cancelNative?'正在撤销当前原生检查。':'当前没有进行中的网页访问。');
 if(cancelNative)void window.healer.cancelScenarioInspection().catch(()=>{
  if(scenarioRecheckStatus)
   scenarioRecheckStatus.textContent='当前检查的取消状态无法确认；后续轮次已停止。';
 });
}
scenarioRecheckStopButton?.addEventListener('click',()=>stopScheduledRechecks('user'));
scenarioInspectId?.addEventListener('change',()=>stopScheduledRechecks('selection'));
let scenarioInspectionGeneration=0;
// Selection changes retire presentation only; explicit cancellation also
// invalidates the pending observation's optional AI review eligibility.
let activeScenarioObservationGeneration=0;
let cancelledScenarioObservationGeneration=0;
scenarioInspectId?.addEventListener('change',()=>{
 // In-flight native observation belongs to its original scenario, not the
 // newly selected view. Do not revoke native consent or discard its receipt.
 scenarioInspectionGeneration++;
 if(scenarioStatus)scenarioStatus.textContent=
  '已切换场景；当前选择尚未执行新的只读检查。';
});
scenarioInspectButton?.addEventListener('click',()=>void browserAction(async()=>{
 const id=scenarioInspectId?.value??'';
 if(!id){
  if(scenarioStatus)scenarioStatus.textContent='必须先登记并选择一个场景。';
  return;
 }
 const requestGeneration=++scenarioInspectionGeneration;
 activeScenarioObservationGeneration=requestGeneration;
 scenarioInspectionBusy=true;browserControls();
 if(scenarioStatus)scenarioStatus.textContent='等待系统原生授权；限定 DOM 检查和短时页面 JavaScript 异常观察都不是业务验收。';
 try{
  const result=await window.healer.inspectScenario(id);
  // Preserve the native-scoped observation and browser lifecycle signal, but
  // prevent old replies from claiming to describe the current selection.
  if(result.code==='BROWSER_NOT_RUNNING')browserConnected=false;
  // Preserve genuine native observations across selection changes, but a
  // specifically cancelled inspection cannot unlock later optional AI review.
  if(result.ok&&result.status==='LIMITED_DOM_SIGNAL_ONLY'&&
     requestGeneration!==cancelledScenarioObservationGeneration)
   observedScenarioIds.add(id);
  if(requestGeneration!==scenarioInspectionGeneration||scenarioInspectId?.value!==id)
   return;
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
      '；当前会话有限观察历史：'+(
        result.sessionHealthStatus==='ELEMENT_FOUND_ONLY'?
          '只观察到目标元素存在（不是脚本正常或业务恢复）':
        result.sessionHealthStatus==='INDETERMINATE'?
          '证据不足，不能判断脚本状态':
          '记录不可用')+
      '；记录 '+(result.sessionHealthEventCount??0)+
      ' 条（本次窗口最多 32 条）。本地脱敏历史归档：'+
       (result.localArchiveStatus==='SAVED_UNVERIFIED'?'已保存（仍未经业务验证）':'未确认保存')+'。'+
      '仅为只读页面信号，Tampermonkey、GM 和真实业务未验证。'
   :'场景检查未通过：'+(result.code??'UNKNOWN')+
      '。没有获得 Tampermonkey 或业务验证结果。';
 }finally{scenarioInspectionBusy=false;browserControls();}
}));
manualRestoreButton?.addEventListener('click',()=>{
 if(manualRestoreBusy)return;
 manualRestoreBusy=true;
 manualRestoreButton.disabled=true;
 if(intentInspectButton)intentInspectButton.disabled=true;
  if(intentInventoryButton)intentInventoryButton.disabled=true;
 if(manualRestoreResult)manualRestoreResult.textContent=
   '仅通过系统对话框选择原始文件与可信备份；最终写入前必须再次确认。';
 void window.healer.restoreManualOriginal().then(result=>{
  if(manualRestoreResult)manualRestoreResult.textContent=
   result.ok&&result.status==='RESTORED_NATIVE_ONLY'
    ?'本机原字节手动恢复成功。被替换版本已单独保留为：'+
      (result.displacedBackupFileName??'(名称不可用)')+
      '；恢复意图记录：'+(result.journalFileName??'(名称不可用)')+
      '。仍需手工确认 Tampermonkey 已安装版本及业务结果；没有自动修复或回滚权限。'
    :'手动恢复未完成：'+(result.code??'UNKNOWN')+
      '。如果已经创建部分备份或恢复意图，需在选定目录人工核查；不要盲目重试或覆盖。';
 }).catch(()=>{
  if(manualRestoreResult)manualRestoreResult.textContent=
   '手动恢复请求失败；实际文件状态无法确认，请检查原始文件、备份与恢复意图。';
 }).finally(()=>{
  manualRestoreBusy=false;manualRestoreButton.disabled=false;
  if(intentInspectButton)intentInspectButton.disabled=false;
   if(intentInventoryButton)intentInventoryButton.disabled=false;
 });
});
intentInspectButton?.addEventListener('click',()=>{
 if(manualRestoreBusy)return;
 manualRestoreBusy=true;
 intentInspectButton.disabled=true;
 if(manualRestoreButton)manualRestoreButton.disabled=true;
  if(intentInventoryButton)intentInventoryButton.disabled=true;
 if(intentInspectResult)intentInspectResult.textContent=
   '请通过系统对话框独立选择当前脚本与已有恢复意图文件；仅执行只读字节核对。';
 void window.healer.inspectRestoreIntent().then(result=>{
  if(!intentInspectResult)return;
  if(result.ok&&result.status==='RESTORE_INTENT_OBSERVED_READ_ONLY'){
   intentInspectResult.textContent=result.sourceState==='ORIGINAL_PRESENT'
    ?'只读核对：当前本地文件的原版字节与恢复意图一致，两份独立备份亦核验通过。'
      +' 此结果不证明 Tampermonkey 已安装脚本或业务恢复，也不授权再次写入。'
    :'只读核对：当前本地文件仍为被替换前的版本；两份独立备份核验通过。'
      +' 没有执行任何恢复，请勿在未确认外部编辑状态前反复覆盖。';
  }else{
   intentInspectResult.textContent='只读核对未完成：'+(result.code??'UNKNOWN')+
     '。文件实际状态未获可信确认；请人工检查原文件与备份，不要盲目重复覆盖。';
  }
 }).catch(()=>{
  if(intentInspectResult)intentInspectResult.textContent=
   '只读核对请求失败；没有获得可信文件状态，不应据此执行自动恢复。';
 }).finally(()=>{
  manualRestoreBusy=false;intentInspectButton.disabled=false;
  if(manualRestoreButton)manualRestoreButton.disabled=false;
   if(intentInventoryButton)intentInventoryButton.disabled=false;
 });
});

intentInventoryButton?.addEventListener('click',()=>{
 if(manualRestoreBusy)return;
 manualRestoreBusy=true;
 intentInventoryButton.disabled=true;
 if(intentInspectButton)intentInspectButton.disabled=true;
 if(manualRestoreButton)manualRestoreButton.disabled=true;
 if(intentInventoryResult)intentInventoryResult.textContent=
  '正在请求系统授权，选择当前脚本及现有恢复意图目录；没有文件会被修改。';
 void window.healer.inspectRestoreInventory().then(result=>{
  if(!intentInventoryResult)return;
  intentInventoryResult.textContent=
   result.ok&&result.status==='RESTORE_INTENT_INVENTORY_READ_ONLY'
    ?'只读目录核对：检查 '+result.inspected+' 份恢复意图；原版字节匹配 '+
      result.originalPresent+' 份，被替换版本匹配 '+result.displacedPresent+
      ' 份，拒绝或不相符 '+result.rejected+
      ' 份。该摘要不授权恢复、更新 Tampermonkey 或确认业务成功。'
    :'只读目录核对未完成：'+(result.code??'UNKNOWN')+
      '。扫描受阻时不提供任何部分有效计数，请人工检查文件。';
 }).catch(()=>{
  if(intentInventoryResult)intentInventoryResult.textContent=
   '只读目录核对请求失败；文件状态不可确认，不应自动恢复。';
 }).finally(()=>{
  manualRestoreBusy=false;intentInventoryButton.disabled=false;
  if(intentInspectButton)intentInspectButton.disabled=false;
  if(manualRestoreButton)manualRestoreButton.disabled=false;
 });
});

scenarioExportButton?.addEventListener('click',()=>void browserAction(async()=>{
 const id=scenarioInspectId?.value??'';
 if(!id){
  if(scenarioStatus)scenarioStatus.textContent='先选择已登记的双选择器场景。';
  return;
 }
 // This native action may finish after selection changes. The separate
 // export remains valid evidence for its original scenario only; do not
 // repaint a newly selected scenario with the old candidate's filenames.
 const requestGeneration=++scenarioInspectionGeneration;
 manualExportBusy=true;browserControls();
 if(scenarioStatus)scenarioStatus.textContent=
   '正在等待原生授权并重新采集真实 DOM；未获授权、证据不足或源文件变化时不会导出。';
 try{
  const answer=await window.healer.exportManualScenario(id);
  if(requestGeneration!==scenarioInspectionGeneration||scenarioInspectId?.value!==id){
   if(answer.code==='BROWSER_NOT_RUNNING'||answer.code==='SESSION_REVOKED')
    browserConnected=false;
   return;
  }
  if(scenarioStatus)scenarioStatus.textContent=
   answer.ok&&answer.status==='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED'
    ?'已生成本地人工审核候选：'+(answer.exportFileName??'')+
      '（'+(answer.candidateByteLength??0)+' 字节；SHA-256 '+(answer.candidateSha256??'')+
      '）。人工恢复原始版本：'+(answer.recoveryExportFileName??'')+
       '。独立备份：'+(answer.backupFileName??'')+
      '。已保存恢复检查点（未经运行时验证）：'+(answer.checkpointFileName??'')+
      '。检查点只可供后续原生只读复核，不授权自动应用或回滚。'+
      ' 原始脚本未被本程序改写；仍需用户自行在真实 Tampermonkey 中审阅、安装、运行并验证业务。'
    :'人工导出未完成：'+(answer.code??'UNKNOWN')+
      '。未取得可用的候选导出回执；可能存在独立暂存文件，须检查所选文件夹。';
  if(answer.code==='BROWSER_NOT_RUNNING'||answer.code==='SESSION_REVOKED')
   browserConnected=false;
 }finally{manualExportBusy=false;browserControls();}
}));
scenarioCancelButton?.addEventListener('click',()=>{
 if(!scenarioInspectionBusy&&!manualExportBusy)return;
 // Native cancellation remains scoped to the original request. Retire
 // earlier inspection/export presentation immediately, so late success
 // cannot repaint a cancellation receipt or imply renewed authority.
 if(scenarioInspectionBusy)
  cancelledScenarioObservationGeneration=activeScenarioObservationGeneration;
 const requestGeneration=++scenarioInspectionGeneration;
 const requestScenarioId=scenarioInspectId?.value??'';
 const isCurrentCancel=()=>requestGeneration===scenarioInspectionGeneration&&
  scenarioInspectId?.value===requestScenarioId;
 scenarioCancelButton.disabled=true;
 void window.healer.cancelScenarioInspection().then(result=>{
  if(!isCurrentCancel())return;
  if(scenarioStatus)scenarioStatus.textContent=result.ok
   ?'已请求取消只读检查／人工导出写入前流程；打开过的标签页不用于业务验收。'
   :result.code==='EXPORT_WRITE_ALREADY_STARTED'
     ?'已开始创建备份／人工候选文件，无法通过此按钮撤销。请核对最终结果和输出目录。'
     :'取消请求未完成：'+(result.code??'UNKNOWN');
 }).catch(()=>{
  if(!isCurrentCancel())return;
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
connectExistingButton?.addEventListener('click',()=>void browserAction(async()=>{
 const port=selectedCdpPort();
 if(port===null){
  setBrowserStatus('CDP 端口必须是 1024 至 65535 的整数。');return;
 }
 existingConnectionBusy=true;browserControls();
 setBrowserStatus('正在核对所选 Chrome 与 Data，并等待 Chrome 的原生授权提示。请在 Chrome 中确认本次连接。');
 try{
  const result=await window.healer.connectExistingChrome(port);
  existingChromeConnected=result.ok&&result.status==='AUTHORIZED_EXISTING_CDP_BROWSER_VERIFIED';
  setBrowserStatus(existingChromeConnected
    ?'已获授权连接正在运行的 Chrome（'+(result.chromeVersion??'unknown')+'）。断开本软件不会关闭浏览器；目前只开放 Tampermonkey 只读探测，不代表脚本或业务已恢复。'
    :'连接正在运行的 Chrome 未通过：'+(result.code??'UNKNOWN'));
 }catch{
  existingChromeConnected=false;
  setBrowserStatus('连接请求受阻；请确认 Chrome 正在运行、已启用远程调试并允许本次连接。');
 }finally{existingConnectionBusy=false;browserControls();}
}));
disconnectExistingButton?.addEventListener('click',()=>{
 if(existingDisconnectBusy||(!existingChromeConnected&&!existingConnectionBusy))return;
 existingDisconnectBusy=true;browserControls();
 setBrowserStatus('正在断开本软件与 Chrome 的连接；浏览器会继续运行。');
 void window.healer.disconnectExistingChrome().then(result=>{
  if(result.ok&&result.status==='EXISTING_BROWSER_DISCONNECTED'){
   existingChromeConnected=false;
   setBrowserStatus('已断开本软件与 Chrome 的连接；Chrome 和现有 Data 均保持原状。');
  }else setBrowserStatus('断开连接状态未确认：'+(result.code??'UNKNOWN')+'。Chrome 仍由你控制。');
 }).catch(()=>setBrowserStatus('断开请求受阻；请在 Chrome 中检查浏览器是否仍正常运行。'))
  .finally(()=>{existingDisconnectBusy=false;browserControls();});
});
chooseProfileButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.chooseProfile();
 if(result.ok){
  profileSelected=true;
  setBrowserStatus('已通过系统窗口选择现有 Data / Profile；尚未连接或验证。');
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
 const port=selectedCdpPort();
 if(port===null){
  setBrowserStatus('CDP 端口必须是 1024 至 65535 的整数。');return;
 }
 setBrowserStatus('检查独立 Chrome 配置与进程归属中；请在系统确认窗口授权。');
 const requestGeneration=browserSessionGeneration;
 const result=await window.healer.startBrowser(port);
 // A stop requested during native launch invalidates this renderer receipt;
 // the privileged main process remains the authority on actual ownership.
 if(requestGeneration!==browserSessionGeneration)return;
 browserConnected=result.ok&&result.status==='OWNED_CDP_BROWSER_VERIFIED';
 setBrowserStatus(browserConnected
   ? '已确认本程序启动的 Chrome CDP 连接（'+(result.chromeVersion??'unknown')+
     '）；Tampermonkey、脚本注入和业务结果仍未验证。'
   : '独立 Chrome 启动未通过：'+(result.code??'UNKNOWN'));
}));
managerStoreButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.openTampermonkeyStore();
 setBrowserStatus(result.ok&&result.status==='OFFICIAL_STORE_TAB_OPENED_UNVERIFIED'
   ?'已在本程序启动的独立 Chrome 中打开官方安装页；请在 Chrome 里自行确认安装与权限。扩展身份、GM 和业务结果仍未验证。'
   :'官方安装页未打开：'+(result.code??'UNKNOWN')+'；未安装或修改扩展。');
}));
inspectButton?.addEventListener('click',()=>void browserAction(async()=>{
 const result=await window.healer.inspectTampermonkey();
 if(result.ok&&result.status==='RUNTIME_TARGET_HINT_ONLY')
  setBrowserStatus((existingChromeConnected?'已连接的 Chrome：':'本程序启动的 Chrome：')+
    '发现 '+result.matchedRuntimeTargets+
    ' 个疑似 Tampermonkey 运行目标；扩展真实性、脚本安装、GM API 与业务执行均未验证。');
 else if(result.code==='BROWSER_NOT_RUNNING'){
  if(existingChromeConnected){
   existingChromeConnected=false;
   setBrowserStatus('Chrome 连接已失效；浏览器可能已退出或撤销授权。');
  }else{
   clearGmDisplay('独立 Chrome 已退出；本机测试会话无法继续。');
   browserConnected=false;
   setBrowserStatus('独立 Chrome 已退出，无法执行只读探测。');
  }
 }else setBrowserStatus('Tampermonkey 只读探测未通过：'+(result.code??'UNKNOWN'));
}));
// Stop is intentionally NOT gated by browserAction's busy mutex. It must
// abort a pending 20-second Chrome handshake or native-consent interaction,
// and can stop only the exact child tracked by the privileged main process.
stopButton?.addEventListener('click',()=>{
 if(stopInProgress||(!browserBusy&&!browserConnected&&!(typeof chromeSelected!=='undefined'&&chromeSelected)))return;
 // Browser shutdown must revoke a pending scheduled recheck immediately.
 // A failed native stop never grants permission for another inspection.
 if(recheckRunning){
  revokeBoundedRechecks();
  if(scenarioRecheckStatus)scenarioRecheckStatus.textContent=
   '已请求停止浏览器；复检计划已取消，不再自动启动下一轮。';
 }
 // A pending fixture start cannot repaint links after browser shutdown.
 gmProbeGeneration++;
 // Invalidate any pre-stop launch reply before waiting on native shutdown.
 browserSessionGeneration++;
 // An already authorized optional AI request may finish after native stop.
 // Retire its renderer presentation now; this never revokes native consent.
 aiReviewGeneration++;
 if(aiReviewResult)aiReviewResult.textContent=
  '已请求停止独立 Chrome；先前的 AI 文字建议已隐藏，停止状态仍待系统确认。';
 stopInProgress=true;browserControls();
 void window.healer.stopBrowser().then(result=>{
  if(result.ok||result.code==='BROWSER_NOT_RUNNING'||
     result.code==='GRACEFUL_CLOSE_FAILED'){
   browserConnected=false;
   if(typeof existingChromeConnected!=='undefined')existingChromeConnected=false;
   clearGmDisplay('浏览器控制会话已结束；本机测试会话也已撤销。如曾安装临时脚本，请自行从 Tampermonkey 删除。');
  }
  if(result.ok&&result.status==='OWNED_BROWSER_GRACEFUL_CLOSE_REQUESTED')
   setBrowserStatus('已通过经过身份复核的 Chrome CDP 请求正常关闭本程序启动的独立 Chrome。');
  else if(result.ok&&result.status==='EXISTING_BROWSER_DISCONNECTED')
   setBrowserStatus('已断开本软件与原本正在运行的 Chrome；浏览器与 Data 保持原状。');
  else if(result.ok&&result.status==='PENDING_BROWSER_OPERATION_CANCELLED')
   setBrowserStatus('已取消尚未完成的浏览器启动或连接操作。');
  else if(result.code==='GRACEFUL_CLOSE_FAILED')
   setBrowserStatus('未能确认 Chrome 正常关闭；本软件已撤销控制，不会强制结束进程。请手动关闭该独立 Chrome。');
  else setBrowserStatus(result.ok?'浏览器控制操作已完成。':
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
 const requestGeneration=++gmProbeGeneration;
 gmProbeStarting=true;browserControls();
 let result:Awaited<ReturnType<typeof window.healer.startGmProbe>>;
 try{result=await window.healer.startGmProbe(runAt);}
 finally{gmProbeStarting=false;browserControls();}
 // Stop may settle before the original native start reply is delivered.
 // Never resurrect a revoked fixture or display temporary URLs in that case.
 if(requestGeneration!==gmProbeGeneration)return;
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
 // A user may stop the fixture while this status request is pending.
 // Its earlier unverified report must not repaint the stopped session.
 const requestGeneration=gmProbeGeneration;
 const result=await window.healer.gmProbeStatus();
 if(requestGeneration!==gmProbeGeneration||!gmProbeActive)return;
 if(!result.ok){
  // A failed status lookup is not proof that a native fixture ended. Keep
  // the active session and its stop/cleanup control unless native explicitly
  // reports expiration or revocation. Never promote an error to GM evidence.
  if(retireGmIfNativeSessionGone(result.code))return;
  if(gmResult)gmResult.textContent='读取本机测试回执受阻：'+(result.code??'UNKNOWN')+
    '。原有测试服务可能仍在运行；可重试查看或主动关闭。未取得新的 GM 或业务验证。';
  return;
 }
 // Preserve three states: a missing self-report is not a negative receipt.
 const selfReported=(value:boolean|null|undefined)=>
  value===true?'是':value===false?'否':'未报告';
 const renderModeReport=(mode:'broken'|'fixed')=>{
   const report=mode==='broken'?result.brokenReport:result.fixedReport;
   if(!report)return mode+'：状态无法确认';
   if(report.reportStatus==='NOT_REPORTED')return mode+'：尚无自报回执';
   if(report.reportStatus==='REJECTED_REPORT')return mode+'：自报回执无效，已拒绝';
   const flag=(v:boolean|null)=>v===true?'自报匹配':v===false?'自报未匹配':'未报告';
   return mode+'：默认值 '+flag(report.reportedGmDefaultMatched)+
     '、存储读回 '+flag(report.reportedGmStorageRoundtripMatched)+
     '、页面动作 '+flag(report.reportedBusinessAction);
  };
  if(gmResult)gmResult.textContent=renderModeReport('broken')+'；'+
    renderModeReport('fixed')+'。报告模式数：'+(result.observedModes??0)+
   '；自报 GM 默认值匹配：'+selfReported(result.reportedGmDefaultMatched)+
   '；自报 GM 存储写入读回：'+selfReported(result.reportedGmStorageRoundtripMatched)+
   '；自报 broken 失败：'+selfReported(result.reportedBrokenFailed)+
   '；自报 fixed 动作：'+selfReported(result.reportedFixedRecovered)+
   '；独立 DOM 对照：'+(result.consistencyStatus??'UNKNOWN')+
   '（已比较 '+(result.comparedModes??0)+' 组；broken 动作 '+
   (result.brokenDomAction??'未观察')+'、fixed 动作 '+
   (result.fixedDomAction??'未观察')+'）。仅限未经认证的夹具对照，不证明真实 GM 或业务恢复。';
}));
gmReportButton?.addEventListener('click',()=>void browserAction(async()=>{
 const requestGeneration=gmProbeGeneration;
 const result=await window.healer.saveGmReport();
 if(requestGeneration!==gmProbeGeneration||!gmProbeActive)return;
 if(!result.ok&&retireGmIfNativeSessionGone(result.code))return;
 if(gmResult)gmResult.textContent=result.ok&&result.status==='UNVERIFIED_REPORT_SAVED_ONLY'
  ?'已另存未经认证的本机诊断摘要：'+result.fileName+
   '（SHA-256 '+result.sha256+'，'+result.byteLength+' bytes）。'+
   '仍须真实 Tampermonkey/GM/业务专项验收。'
  :'本机报告未保存：'+(result.code??'UNKNOWN')+'。已有文件不会被覆盖。';
}));
for(const mode of ['broken','fixed'] as const){
 gmVisitButtons[mode]?.addEventListener('click',()=>void browserAction(async()=>{
  const requestGeneration=gmProbeGeneration;
  const result=await window.healer.visitGmFixture(mode);
  if(requestGeneration!==gmProbeGeneration||!gmProbeActive)return;
  if(!result.ok&&retireGmIfNativeSessionGone(result.code))return;
  if(gmResult)gmResult.textContent=result.ok
   ?mode+' 专用测试页已在本程序拥有的 Chrome 打开；脚本执行未验证。'
   :'测试页未打开：'+(result.code??'UNKNOWN');
 }));
 gmObserveButtons[mode]?.addEventListener('click',()=>void browserAction(async()=>{
  const requestGeneration=gmProbeGeneration;
  const result=await window.healer.observeGmFixture(mode);
  if(requestGeneration!==gmProbeGeneration||!gmProbeActive)return;
  if(!result.ok&&retireGmIfNativeSessionGone(result.code))return;
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
 if(gmStopInProgress||(!gmProbeActive&&!gmProbeStarting))return;
 gmProbeGeneration++;
 gmStopInProgress=true;browserControls();
 void window.healer.stopGmProbe().then(result=>{
  if(result.ok||result.status==='NO_ACTIVE_FIXTURE'){
   clearGmDisplay(result.ok
    ?'本机测试服务已请求关闭；请自行删除独立 Tampermonkey 中的临时脚本。'
    :'没有活动的本机测试服务。');
  }else if(gmResult)gmResult.textContent=
   '关闭请求未获确认；本机测试状态无法确认，请重新检查。';
 }).catch(()=>{
  if(gmResult)gmResult.textContent='关闭请求受阻；本机测试状态无法确认。';
 }).finally(()=>{gmStopInProgress=false;browserControls();});
});
browserControls();

const aiDiscoveryButton=document.getElementById('ai-model-discover') as HTMLButtonElement|null;
const aiDiscoveryResult=document.getElementById('ai-model-discovery-result');
let aiDiscoveryPending=false;
aiDiscoveryButton?.addEventListener('click',()=>{
  if(aiDiscoveryPending)return;
  aiDiscoveryPending=true;
  aiDiscoveryButton.disabled=true;
  if(aiDiscoveryResult)aiDiscoveryResult.textContent='正在等待本机文件选择与系统权限确认；未授权不会发起请求。';
  void window.healer.discoverNativeAiModels().then(result=>{
    if(!aiDiscoveryResult)return;
    if(!result.ok){
      aiDiscoveryResult.textContent='未完成模型列表查询：'+(result.code??'UNKNOWN')+
        '。未授权时不联网；不会安装或修改任何用户脚本。';
      return;
    }
    const models=(result.models??[]).slice(0,15).join('、');
    aiDiscoveryResult.textContent=result.status==='MANUAL_MODEL_FALLBACK'
      ?'该服务不提供 /models 列表，允许已配置模型名称作人工后续选择；尚未请求建议或安装脚本。'
      :'已获取模型标识 '+(result.models?.length??0)+' 项：'+(models||'（空列表）')+
        ((result.models?.length??0)>15?'……':'')+
        '。这只是未经验证的服务模型列表，不代表脚本修复或安全授权。';
  }).catch(()=>{
    if(aiDiscoveryResult)aiDiscoveryResult.textContent='模型发现受阻：DISCOVERY_FAILED。无脚本修改。';
  }).finally(()=>{
    aiDiscoveryPending=false;
    aiDiscoveryButton.disabled=false;
  });
});


aiReviewButton?.addEventListener('click',()=>{
  if(aiReviewPending||browserBusy||stopInProgress||scenarioInspectionBusy)return;
  // Read-only observations from a past Chrome session are not a live action.
  // Native still independently checks manager/session authority before any call.
  if(!browserConnected){
    if(aiReviewResult)aiReviewResult.textContent=
      '独立 Chrome 尚未连接；请先启动浏览器并完成当前场景的只读检查。';
    return;
  }
  // Native still independently checks the selected scenario's observation.
  const id=scenarioInspectId?.value??'';
  if(!id||!observedScenarioIds.has(id)){
    if(aiReviewResult)aiReviewResult.textContent='尚未选择已登记的只读场景。先完成本机只读场景检查。';
    return;
  }
  const requestGeneration=++aiReviewGeneration;
  const isCurrentAiReview=()=>requestGeneration===aiReviewGeneration&&
    scenarioInspectId?.value===id;
  aiReviewPending=true;
  aiReviewButton.disabled=true;
  if(aiReviewResult)aiReviewResult.textContent='请选择本地 AI 配置并在原生窗口确认具体外发字段；未同意不联网。';
  void window.healer.requestNativeAiReview(id).then(result=>{
    if(!isCurrentAiReview()||!aiReviewResult)return;
    if(!result.ok){
      aiReviewResult.textContent='本次 AI 文字建议未取得：'+(result.code??'UNKNOWN')+
        '。不会修改或安装任何脚本。';
      return;
    }
    // Never use innerHTML: returned provider strings are untrusted.
    aiReviewResult.textContent='未经验证的 AI 文字建议（'+(result.model??'未指定模型')+'）：'+
      (result.candidateText??'')+
      '。仅供人工复核，未验证 Tampermonkey 或业务功能；不具备脚本写入权限。';
  }).catch(()=>{
    if(isCurrentAiReview()&&aiReviewResult)
      aiReviewResult.textContent='本次 AI 请求受阻，未产生任何可信修复结果。';
  }).finally(()=>{aiReviewPending=false;browserControls();});
});
// Selection changes retire only renderer presentation, not the native call.
// Already authorized work may finish; its delayed text must not cross views.
scenarioInspectId?.addEventListener('change',()=>{
  aiReviewGeneration++;
  if(aiReviewResult)aiReviewResult.textContent='已切换场景；先前的 AI 文字建议已隐藏。'+
    (aiReviewPending
      ?'原请求可能仍在执行，完成后请为当前场景单独授权。'
      :'如需本场景建议，请单独授权。');
});

/** Keep each workspace mounted so pending operations and form values survive tab changes.
 * Navigation stays in the document because IPC verifies the exact file URL.
 */
const workspaceTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.workspace-tabs [role="tab"]')
).flatMap(button => {
  const panel = document.getElementById(button.dataset.workspaceTarget ?? '');
  return panel ? [{ button, panel }] : [];
});
const workspaceTablist = document.querySelector<HTMLElement>('.workspace-tabs');
const workspaceContent = document.querySelector<HTMLElement>('.workspace-content');
const skipWorkspaces = document.getElementById('skip-workspaces');
const scenarioContext = document.getElementById('scenario-context');
let selectedWorkspace = 0;

function selectWorkspace(index: number, focus: 'tab' | 'panel' | 'none'): void {
  const selected = workspaceTabs[index];
  if (!selected) return;
  const changed = index !== selectedWorkspace;
  selectedWorkspace = index;
  const contextSlot = selected.panel.querySelector('[data-scenario-context-slot]');
  const statusSlot = selected.panel.querySelector('[data-scenario-status-slot]');
  if (scenarioContext && contextSlot && scenarioContext.parentElement !== contextSlot) {
    contextSlot.append(scenarioContext);
  }
  if (scenarioStatus && statusSlot && scenarioStatus.parentElement !== statusSlot) {
    statusSlot.append(scenarioStatus);
  }
  workspaceTabs.forEach(({ button, panel }, position) => {
    const active = position === index;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
  skipWorkspaces?.setAttribute('aria-controls', selected.panel.id);
  if (changed && workspaceContent) workspaceContent.scrollTop = 0;
  if (focus === 'tab') selected.button.focus({ preventScroll: true });
  if (focus === 'panel') selected.panel.focus({ preventScroll: true });
  if (focus !== 'none' && workspaceTablist?.getAttribute('aria-orientation') === 'horizontal') {
    selected.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function updateWorkspaceOrientation(): void {
  workspaceTablist?.setAttribute('aria-orientation', window.innerWidth > 760 ? 'vertical' : 'horizontal');
}

workspaceTabs.forEach(({ button }, index) => {
  button.addEventListener('click', () => selectWorkspace(index, 'tab'));
  button.addEventListener('keydown', event => {
    const horizontal = workspaceTablist?.getAttribute('aria-orientation') === 'horizontal';
    const previous = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const next = horizontal ? 'ArrowRight' : 'ArrowDown';
    const count = workspaceTabs.length;
    let target: number;
    switch (event.key) {
      case previous: target = (index + count - 1) % count; break;
      case next: target = (index + 1) % count; break;
      case 'Home': target = 0; break;
      case 'End': target = count - 1; break;
      default: return;
    }
    event.preventDefault();
    selectWorkspace(target, 'tab');
  });
});
skipWorkspaces?.addEventListener('click', () => selectWorkspace(selectedWorkspace, 'panel'));
document.querySelectorAll<HTMLButtonElement>('[data-open-workspace]').forEach(button => {
  button.addEventListener('click', () => {
    const index = workspaceTabs.findIndex(({ panel }) => panel.id === button.dataset.openWorkspace);
    selectWorkspace(index, 'panel');
  });
});
if (workspaceTablist) {
  window.addEventListener('resize', updateWorkspaceOrientation);
  updateWorkspaceOrientation();
  selectWorkspace(0, 'none');
}

