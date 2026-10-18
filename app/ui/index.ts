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
  scripts: Imported[];
  errors: { filename: string; code: string }[];
  duplicates: number;
}
interface Window {
  healer: {
    getStatus(): Promise<{ shell: string; automaticRepairAvailable: boolean; aiEnabled: boolean; automaticApplyEnabled: boolean }>;
    chooseFiles(): Promise<ImportResponse>;
    chooseFolder(): Promise<ImportResponse>;
    importDropped(name: string, bytes: Uint8Array): Promise<{ ok: boolean; script?: Imported; code?: string }>;
    chooseChrome(): Promise<{ok:boolean;code?:string;filename?:string}>;
    chooseProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    createProfile(): Promise<{ok:boolean;code?:string;directoryName?:string}>;
    startBrowser(port:number): Promise<{ok:boolean;code?:string;status?:string;chromeVersion?:string}>;
    inspectTampermonkey(): Promise<{ok:boolean;code?:string;status?:string;matchedRuntimeTargets?:number}>;
    stopBrowser(): Promise<{ok:boolean;code?:string;status?:string}>;
  };
}

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 8;
const MAX_DIRECTORY_ENTRIES = 10000;

const statusElement = document.getElementById('status');
const output = document.getElementById('import-list');
const chooseFile = document.getElementById('choose-files') as HTMLButtonElement | null;
const chooseFolder = document.getElementById('choose-folder') as HTMLButtonElement | null;
const chooser = document.getElementById('select-files') as HTMLInputElement | null;
const dropZone = document.getElementById('drop-area');
const seenScripts = new Set<string>();
let busy = false;

function logLine(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  output?.append(item);
}
function show(result: ImportResponse): void {
  if (result.canceled) return;
  let duplicates = result.duplicates;
  for (const item of result.scripts) {
    // Path-based dedup in the main process; content identity in the renderer
    // also covers repeated drag/drop and files chosen in different dialogs.
    const key = JSON.stringify([item.filename.toLowerCase(), item.sha256]);
    if (seenScripts.has(key)) { duplicates++; continue; }
    seenScripts.add(key);
    const a = item.analysis;
    const preview = a?.status === 'STATIC_ANALYSIS_ONLY'
      ? '静态定位器 ' + a.totalSites + '（字面值 ' + a.literalSites +
        ' / 需运行确认 ' + a.runtimeConfirmationSites + '；未验证真实网页）'
      : '静态分析：' + (a?.status ?? 'NOT_AVAILABLE');
    logLine(item.filename + ': ' + item.byteLength + ' bytes / ' +
      item.textEncoding + ' / SHA-256 ' + item.sha256 + ' / ' + preview);
  }
  for (const error of result.errors) logLine(error.filename + ': ' + error.code);
  if (duplicates) logLine('忽略重复脚本：' + duplicates);
}

async function locked(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  if (chooseFile) chooseFile.disabled = true;
  if (chooseFolder) chooseFolder.disabled = true;
  if (chooser) chooser.disabled = true;
  try { await task(); }
  catch { logLine('导入未成功：文件、目录或权限检查未通过。'); }
  finally {
    busy = false;
    if (chooseFile) chooseFile.disabled = false;
    if (chooseFolder) chooseFolder.disabled = false;
    if (chooser) chooser.disabled = false;
  }
}

async function importFiles(files: readonly File[]): Promise<void> {
  if (files.length > MAX_FILES) { logLine('单批最多处理 1000 份文件'); return; }
  let readBytes = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      logLine(file.name + ': FILE_TOO_LARGE');
      continue;
    }
    if (readBytes + file.size > MAX_BATCH_BYTES) {
      logLine('本批次超过 128 MiB 导入限制；后续文件未读取。');
      break;
    }
    readBytes += file.size;
    const answer = await window.healer.importDropped(file.name, new Uint8Array(await file.arrayBuffer()));
    if (answer.ok && answer.script) {
      show({ canceled: false, scripts: [answer.script], errors: [], duplicates: 0 });
    } else {
      logLine(file.name + ': ' + (answer.code ?? 'INVALID_INPUT'));
    }
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

chooseFile?.addEventListener('click', () => { void locked(async () => show(await window.healer.chooseFiles())); });
chooseFolder?.addEventListener('click', () => { void locked(async () => show(await window.healer.chooseFolder())); });
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
  if(result.ok||result.code==='BROWSER_NOT_RUNNING')browserConnected=false;
  setBrowserStatus(result.ok?'已请求停止本程序启动的独立 Chrome。':
    '停止操作：'+(result.code??'UNKNOWN'));
 }).catch(()=>{
  setBrowserStatus('停止操作受阻；仍需确认独立 Chrome 状态。');
 }).finally(()=>{stopInProgress=false;browserControls();});
});
browserControls();
