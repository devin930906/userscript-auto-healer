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
const statusElement = document.getElementById('status');
const output = document.getElementById('import-list');
const chooseFile = document.getElementById('choose-files') as HTMLButtonElement | null;
const chooseFolder = document.getElementById('choose-folder') as HTMLButtonElement | null;
const chooser = document.getElementById('select-files') as HTMLInputElement | null;
const dropZone = document.getElementById('drop-area');
let busy = false;
function logLine(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  output?.append(item);
}
function show(result: ImportResponse): void {
  if (result.canceled) return;
  for (const x of result.scripts) logLine(x.filename + ': ' + x.byteLength + ' bytes / ' + x.textEncoding + ' / SHA-256 ' + x.sha256);
  for (const x of result.errors) logLine(x.filename + ': ' + x.code);
  if (result.duplicates) logLine('忽略重复路径：' + result.duplicates);
}
async function locked(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  if (chooseFile) chooseFile.disabled = true;
  if (chooseFolder) chooseFolder.disabled = true;
  if (chooser) chooser.disabled = true;
  try { await task(); }
  catch { logLine('导入未成功：文件或权限检查未通过。'); }
  finally {
    busy = false;
    if (chooseFile) chooseFile.disabled = false;
    if (chooseFolder) chooseFolder.disabled = false;
    if (chooser) chooser.disabled = false;
  }
}
async function importFiles(files: readonly File[]): Promise<void> {
  if (files.length > 1000) { logLine('单批最多处理 1000 份文件'); return; }
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) { logLine(file.name + ': 文件超过 8 MiB'); continue; }
    const answer = await window.healer.importDropped(file.name, new Uint8Array(await file.arrayBuffer()));
    if (answer.ok && answer.script) show({canceled:false,scripts:[answer.script],errors:[],duplicates:0});
    else logLine(file.name + ': ' + (answer.code ?? 'INVALID_INPUT'));
  }
}
chooseFile?.addEventListener('click', () => { void locked(async () => show(await window.healer.chooseFiles())); });
chooseFolder?.addEventListener('click', () => { void locked(async () => show(await window.healer.chooseFolder())); });
chooser?.addEventListener('change', () => {
  void locked(async () => {
    await importFiles(Array.from(chooser.files ?? []));
    chooser.value = '';
  });
});
dropZone?.addEventListener('dragover', event => { event.preventDefault(); });
dropZone?.addEventListener('drop', event => {
  event.preventDefault();
  if (!(event instanceof DragEvent)) return;
  void locked(async () => importFiles(Array.from(event.dataTransfer?.files ?? [])));
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
