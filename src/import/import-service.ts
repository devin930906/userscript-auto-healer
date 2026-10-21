/**
 * TASK-002: local-only, read-only .user.js ingestion.
 * All filesystem paths passed here MUST come from a user-approved native picker
 * or an equivalent explicitly authorized local selection. Never expose this
 * function as arbitrary-path renderer IPC.
 */
import { createHash } from 'node:crypto';
import { constants, type BigIntStats, type Dirent } from 'node:fs';
import { lstat, opendir, open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
export const MAX_SELECTED_FILES = 1000;
export const MAX_DIRECTORY_DEPTH = 8;
export const MAX_DIRECTORY_ENTRIES = 10000;
export const MAX_TOTAL_IMPORTED_BYTES = 128 * 1024 * 1024;

export type ImportFailureCode =
  'INVALID_PATH' | 'NOT_USER_SCRIPT' | 'SYMLINK_REJECTED' | 'NOT_REGULAR_FILE' |
  'FILE_TOO_LARGE' | 'INVALID_ENCODING' | 'EMPTY_FILE' | 'BINARY_CONTENT' |
  'IO_FAILURE' | 'FILE_CHANGED' | 'SCAN_LIMIT' | 'INVALID_DRAG_DATA';

export interface ImportFailure {
  readonly filename: string;
  readonly code: ImportFailureCode;
}

export interface ImportedScript {
  readonly filename: string;
  /** Original bytes are never modified or executed. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
  readonly textEncoding: 'utf-8' | 'utf-8-bom' | 'utf-16le-bom' | 'utf-16be-bom' | 'gb18030-explicit';
  readonly sourcePath?: string;
}

export interface ImportOutcome {
  readonly scripts: ImportedScript[];
  readonly errors: ImportFailure[];
  duplicates: number;
  /** Cancellation never erases successfully completed read-only imports. */
  canceled?: boolean;
  /** Native-selected items not started after a cancellation. */
  unprocessed?: number;
}

function failure(name: string, code: ImportFailureCode): ImportFailure {
  return { filename: name, code };
}

function validName(name: unknown): name is string {
  // Windows device names and NTFS alternate streams are not ordinary files.
  // Enforce the same rule for native picker imports and dropped byte payloads.
  return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    /^[^\\/:*?"<>|\u0000-\u001f]+\.user\.js$/i.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(name);
}

function decode(raw: Uint8Array, allowGb18030: boolean):
  ImportedScript['textEncoding'] | 'INVALID_ENCODING' | 'EMPTY_FILE' | 'BINARY_CONTENT' {
  if (raw.length === 0) return 'EMPTY_FILE';
  let text: string;
  let encoding: ImportedScript['textEncoding'];
  try {
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(3));
      encoding = 'utf-8-bom';
    } else if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(raw.subarray(2));
      encoding = 'utf-16le-bom';
    } else if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
      const swapped = Uint8Array.from(raw.subarray(2));
      for (let i = 0; i + 1 < swapped.length; i += 2) {
        const a = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = a;
      }
      if (swapped.length % 2 !== 0) return 'INVALID_ENCODING';
      text = new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
      encoding = 'utf-16be-bom';
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        encoding = 'utf-8';
      } catch {
        if (!allowGb18030) return 'INVALID_ENCODING';
        // Legacy encoding may be ambiguous; only use with explicit user consent.
        text = new TextDecoder('gb18030', { fatal: true }).decode(raw);
        encoding = 'gb18030-explicit';
      }
    }
  } catch {
    return 'INVALID_ENCODING';
  }
  if (!text.trim()) return 'EMPTY_FILE';
  // Broken encodings, NUL, and unexplained controls indicate binary/unsafe input.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)) return 'BINARY_CONTENT';
  return encoding;
}

function fromBytes(name: string, bytes: Uint8Array, allowGb18030 = false):
  ImportedScript | ImportFailure {
  if (!validName(name)) return failure(name, 'NOT_USER_SCRIPT');
  // Snapshot before *all* decoding and hashing. Untrusted typed-array
  // subclasses can override subarray/iteration, and shared backing stores
  // can change between validation and a later copy. The native constructor
  // copies the typed-array bytes without calling overridden JS methods.
  let copied:Uint8Array;
  try {
    if (bytes.byteLength > MAX_SCRIPT_BYTES) return failure(name, 'FILE_TOO_LARGE');
    copied = new Uint8Array(bytes);
  } catch {
    return failure(name, 'INVALID_DRAG_DATA');
  }
  if (copied.byteLength > MAX_SCRIPT_BYTES) return failure(name, 'FILE_TOO_LARGE');
  const encoding = decode(copied, allowGb18030);
  if (encoding === 'INVALID_ENCODING' || encoding === 'EMPTY_FILE' || encoding === 'BINARY_CONTENT') {
    return failure(name, encoding);
  }
  return {
    filename: name,
    bytes: copied,
    byteLength: copied.byteLength,
    sha256: createHash('sha256').update(copied).digest('hex'),
    textEncoding: encoding
  };
}

/** Safe pure input for future drag-and-drop: imports supplied bytes, never arbitrary renderer paths. */
export function importDroppedBytes(name: unknown, bytes: unknown): ImportedScript | ImportFailure {
  if (!validName(name)) return failure(typeof name === 'string' ? name : '(invalid)', 'NOT_USER_SCRIPT');
  try {
    if (!(bytes instanceof Uint8Array)) return failure(name, 'INVALID_DRAG_DATA');
    return fromBytes(name, bytes);
  } catch {
    // instanceof on a revoked Proxy can throw; it must not escape the IPC
    // import boundary or crash an otherwise independent import batch.
    return failure(name, 'INVALID_DRAG_DATA');
  }
}

/** Compare native identities before and after a bounded disk read.
 * A name/suffix check alone cannot protect a selected path from replacement
 * with a link or different file while another program is editing the folder.
 */
function sameSelectedFile(a:BigIntStats,b:BigIntStats):boolean {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
    a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs && a.mode===b.mode;
}
type DiskReadResult =
  {ok:true;bytes:Uint8Array} |
  {ok:false;code:ImportFailureCode};

/** Never use readFile(path) for an untrusted selected script: the file can
 * grow after lstat and a path can be swapped before opening. Read at most
 * MAX_SCRIPT_BYTES + 1 bytes from one descriptor and compare its identity to
 * the selected path at both ends. No script source leaves the main process.
 */
async function readBoundedSelectedFile(path:string,initial:BigIntStats):Promise<DiskReadResult> {
  let handle;
  try {
    handle=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  }catch(error){
    return {ok:false,code:(error as NodeJS.ErrnoException).code==='ELOOP'
      ?'SYMLINK_REJECTED':'IO_FAILURE'};
  }
  try {
    const opened=await handle.stat({bigint:true});
    if(!opened.isFile()||!sameSelectedFile(initial,opened))
      return {ok:false,code:'FILE_CHANGED'};
    const chunks:Buffer[]=[];
    const buffer=Buffer.allocUnsafe(64*1024);
    let length=0;
    while(true){
      // One extra byte distinguishes an exact-size script from a growing file.
      const limit=Math.min(buffer.length,MAX_SCRIPT_BYTES+1-length);
      const {bytesRead}=await handle.read(buffer,0,limit,null);
      if(bytesRead===0)break;
      length+=bytesRead;
      if(length>MAX_SCRIPT_BYTES)return {ok:false,code:'FILE_TOO_LARGE'};
      chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));
    }
    const after=await handle.stat({bigint:true});
    const byPath=await lstat(path,{bigint:true});
    if(byPath.isSymbolicLink()||!byPath.isFile()||
       !sameSelectedFile(initial,after)||!sameSelectedFile(after,byPath)||
       BigInt(length)!==after.size)
      return {ok:false,code:'FILE_CHANGED'};
    return {ok:true,bytes:Buffer.concat(chunks,length)};
  }catch{
    return {ok:false,code:'IO_FAILURE'};
  }finally {
    await handle.close().catch(()=>{});
  }
}

/** Reject directory junctions/symlinks above a native-selected item as well
 * as a link at the final item. O_NOFOLLOW protects only the final component;
 * this is a preflight guard, not an OS-wide lock against concurrent renames.
 */
async function hasLinkedPathComponent(path: string): Promise<boolean> {
  const normalized = resolve(path);
  const root = parse(normalized).root;
  let cursor = root;
  for (const part of normalized.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) return true;
  }
  return false;
}

export interface ReadOnlyImportProgress {
  readonly phase:'IMPORTING_READ_ONLY';
  readonly processed:number;
  readonly total:number;
  readonly accepted:number;
  readonly duplicates:number;
  readonly failed:number;
}
/** Native-only progress callback: counters, no filenames, paths, bytes or hashes. */
export type ImportProgressCallback=(update:ReadOnlyImportProgress)=>void;
export async function importApprovedPaths(paths: readonly string[], signal?: AbortSignal,
  onProgress?:ImportProgressCallback): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { scripts: [], errors: [], duplicates: 0 };
  const seenPaths = new Set<string>();
  const seenContents = new Set<string>();
  // Bound physical read work even when many different paths contain
  // byte-identical files (or malformed files which never reach scripts[]).
  let selectedBytes = 0;
  // After the aggregate read limit, do not access any remaining file.
  // Report every skipped selection so progress cannot silently stop early.
  let budgetExhausted = false;
  if (!Array.isArray(paths) || paths.length > MAX_SELECTED_FILES) {
    outcome.errors.push(failure('(selection)', 'SCAN_LIMIT'));
    return outcome;
  }
  for (let index = 0; index < paths.length; index++) {
    // Cooperative cancellation takes effect between files; do not interrupt a
    // descriptor read mid-flight or discard already validated script results.
    if (signal?.aborted) {
      outcome.canceled = true;
      outcome.unprocessed = paths.length - index;
      break;
    }
    try {
    const path = paths[index];
    const display = typeof path === 'string' ? basename(path) : '(invalid)';
    if (budgetExhausted) {
      outcome.errors.push(failure(display, 'SCAN_LIMIT'));
      continue;
    }
    // A native picker selects an exact path. Do not silently normalize away
    // . / .. components: with linked ancestors, lexical resolution can read a
    // different file than the one selected (or bypass an ancestor link check).
    if (typeof path !== 'string' || !isAbsolute(path) ||
        path !== resolve(path) || !validName(display)) {
      outcome.errors.push(failure(display, typeof path === 'string' && !validName(display) ? 'NOT_USER_SCRIPT' : 'INVALID_PATH'));
      continue;
    }
    const normalized = resolve(path);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seenPaths.has(key)) { outcome.duplicates++; continue; }
    seenPaths.add(key);
    try {
      if (await hasLinkedPathComponent(normalized)) {
        outcome.errors.push(failure(display, 'SYMLINK_REJECTED'));
        continue;
      }
      const info = await lstat(normalized,{bigint:true});
      if (info.isSymbolicLink()) { outcome.errors.push(failure(display, 'SYMLINK_REJECTED')); continue; }
      if (!info.isFile()) { outcome.errors.push(failure(display, 'NOT_REGULAR_FILE')); continue; }
      if (info.size > BigInt(MAX_SCRIPT_BYTES)) { outcome.errors.push(failure(display, 'FILE_TOO_LARGE')); continue; }
      if (BigInt(selectedBytes) + info.size > BigInt(MAX_TOTAL_IMPORTED_BYTES)) {
        // Account for the rest of the batch without further disk I/O.
        budgetExhausted = true;
        outcome.errors.push(failure(display, 'SCAN_LIMIT'));
        continue;
      }
      // Account for attempted file reads, not just accepted unique results.
      // Otherwise 1000 renamed identical files can evade the batch budget.
      selectedBytes += Number(info.size);
      const read = await readBoundedSelectedFile(normalized,info);
      if (!read.ok) {outcome.errors.push(failure(display,read.code));continue;}
      const parsed = fromBytes(display, read.bytes);
      if ('code' in parsed) outcome.errors.push(parsed);
      else if (seenContents.has(parsed.sha256)) outcome.duplicates++;
      else {
        // SHA-256 is over the exact source bytes, not file names or paths.
        // Different revisions with the same name remain distinct.
        seenContents.add(parsed.sha256);
        outcome.scripts.push({ ...parsed, sourcePath: normalized });
      }
    } catch {
      outcome.errors.push(failure(display, 'IO_FAILURE'));
    }
    } finally {
      // Do not allow a failed UI status listener to stop a validated import.
      // A native cancel still occurs between scripts, not in a file read.
      try { onProgress?.(Object.freeze({
        phase:'IMPORTING_READ_ONLY',processed:index+1,total:paths.length,
        accepted:outcome.scripts.length,duplicates:outcome.duplicates,
        failed:outcome.errors.length
      })); } catch { /* progress reporting has no file authority */ }
    }
  }
  return outcome;
}

/**
 * Scope is the user-picked root only. No symlink traversal, no external access,
 * depth/file/entry budgets, and per-entry error isolation.
 */
export async function scanApprovedDirectory(root: string, signal?: AbortSignal,
  onProgress?:ImportProgressCallback): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { scripts: [], errors: [], duplicates: 0 };
  if (signal?.aborted) { outcome.canceled = true; return outcome; }
  // Match the native-selected directory exactly; aliases must not be
  // reinterpreted before the linked-ancestor and containment checks.
  if (typeof root !== 'string' || !isAbsolute(root) || root !== resolve(root)) {
    outcome.errors.push(failure('(folder)', 'INVALID_PATH'));
    return outcome;
  }
  let base: string;
  try {
    if (await hasLinkedPathComponent(root)) {
      outcome.errors.push(failure(basename(root), 'SYMLINK_REJECTED'));
      return outcome;
    }
    const info = await lstat(root);
    if (info.isSymbolicLink()) { outcome.errors.push(failure(basename(root), 'SYMLINK_REJECTED')); return outcome; }
    if (!info.isDirectory()) { outcome.errors.push(failure(basename(root), 'NOT_REGULAR_FILE')); return outcome; }
    base = await realpath(root);
  } catch {
    outcome.errors.push(failure(basename(root), 'IO_FAILURE'));
    return outcome;
  }
  const approved: string[] = [];
  let visited = 0;
  let budgetExceeded = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (budgetExceeded || signal?.aborted) { if (signal?.aborted) outcome.canceled = true; return; }
    const entries: Dirent[] = [];
    try {
      // Enforce the traversal budget during enumeration, not after an
      // unbounded readdir allocation. Never follow symlink directory entries.
      const opened = await opendir(dir);
      for await (const entry of opened) {
        if (signal?.aborted) { outcome.canceled = true; return; }
        if (visited + entries.length >= MAX_DIRECTORY_ENTRIES) {
          budgetExceeded = true;
          outcome.errors.push(failure(basename(dir), 'SCAN_LIMIT'));
          return;
        }
        entries.push(entry);
      }
    } catch { outcome.errors.push(failure(basename(dir), 'IO_FAILURE')); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (signal?.aborted) { outcome.canceled = true; return; }
      visited++;
      if (visited > MAX_DIRECTORY_ENTRIES || approved.length >= MAX_SELECTED_FILES) {
        budgetExceeded = true;
        outcome.errors.push(failure(basename(dir), 'SCAN_LIMIT'));
        return;
      }
      const child = join(dir, entry.name);
      const rel = relative(base, child);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        outcome.errors.push(failure(entry.name, 'INVALID_PATH')); continue;
      }
      if (entry.isSymbolicLink()) {
        outcome.errors.push(failure(entry.name, 'SYMLINK_REJECTED')); continue;
      }
      if (entry.isDirectory()) {
        if (depth >= MAX_DIRECTORY_DEPTH) {
          outcome.errors.push(failure(entry.name, 'SCAN_LIMIT')); continue;
        }
        await walk(child, depth + 1);
        if (budgetExceeded) return;
      } else if (entry.isFile() && validName(entry.name)) {
        approved.push(child);
      }
    }
  };
  await walk(base, 0);
  if (signal?.aborted || outcome.canceled) {
    outcome.canceled = true;
    outcome.unprocessed = approved.length;
    return outcome;
  }
  const imported = await importApprovedPaths(approved, signal, onProgress);
  outcome.scripts.push(...imported.scripts);
  outcome.errors.push(...imported.errors);
  outcome.duplicates += imported.duplicates;
  if (imported.canceled) outcome.canceled = true;
  if (imported.unprocessed !== undefined) outcome.unprocessed = imported.unprocessed;
  return outcome;
}
