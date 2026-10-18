interface Imported {
  filename: string;
  byteLength: number;
  sha256: string;
  textEncoding: string;
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
    logLine(item.filename + ': ' + item.byteLength + ' bytes / ' + item.textEncoding + ' / SHA-256 ' + item.sha256);
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
      ? '安全入口运行中；仅允许读取用户主动选择的脚本。'
      : '安全检查未通过，自动处理仍被禁用。';
}).catch(() => {
  if (statusElement) statusElement.textContent = '应用入口不可用。';
  if (chooseFile) chooseFile.disabled = true;
  if (chooseFolder) chooseFolder.disabled = true;
  if (chooser) chooser.disabled = true;
});
