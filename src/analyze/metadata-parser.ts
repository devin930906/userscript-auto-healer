/** TASK-003 / REQ-004: read-only userscript metadata extraction. */
import {types as nodeTypes} from 'node:util';
import type { ImportedScript } from '../import/import-service';

const KNOWN = new Set([
  'name','namespace','version','description','author','match','include',
  'exclude','exclude-match','run-at','grant','require','resource','connect','updateurl',
  'downloadurl','icon','icon64','license','homepage','homepageurl','supporturl',
  'noframes','unwrap'
]);
/** The untrusted report boundary must only accept parser-canonical tag keys. */
export function isCanonicalKnownUserscriptMetadataTag(name:string):boolean {
 return name===name.toLowerCase()&&KNOWN.has(name);
}
export interface MetadataLine {
  readonly line: number;
  readonly raw: string;
  readonly kind: 'tag' | 'comment' | 'blank';
  readonly name?: string;
  readonly value?: string;
  readonly known?: boolean;
}
export type MetadataStatus = 'OK' | 'MISSING_HEADER' | 'UNTERMINATED_HEADER' | 'INVALID_ENCODING';
export interface MetadataResult {
  readonly status: MetadataStatus;
  readonly header: string | null;
  readonly lines: MetadataLine[];
  readonly tags: Readonly<Record<string, string[]>>;
  readonly unknownNames: string[];
}
export function readUserscriptSource(script: Pick<ImportedScript, 'bytes'|'textEncoding'>): string | null {
  try {
    // This exported parser also receives direct caller input outside the
    // vetted native import path. Do not execute hostile property accessors,
    // Proxy traps, fake subarray methods or custom TypedArray constructors.
    if (!script || typeof script !== 'object' || nodeTypes.isProxy(script)) return null;
    const proto = Object.getPrototypeOf(script);
    if (proto !== Object.prototype && proto !== null) return null;
    const fields = Object.getOwnPropertyDescriptors(script);
    const source = fields.bytes;
    const declaredEncoding = fields.textEncoding;
    if (!source || !declaredEncoding ||
        !Object.prototype.hasOwnProperty.call(source, 'value') ||
        !Object.prototype.hasOwnProperty.call(declaredEncoding, 'value')) return null;
    const raw: unknown = source.value;
    if (!raw || nodeTypes.isProxy(raw) || !(raw instanceof Uint8Array)) return null;

    // Call intrinsic TypedArray getters rather than caller-shadowable
    // .buffer/.byteOffset/.byteLength or .subarray/.slice/.constructor.
    const intrinsic = Object.getPrototypeOf(Uint8Array.prototype);
    const backing = Object.getOwnPropertyDescriptor(intrinsic, 'buffer')?.get?.call(raw) as ArrayBuffer;
    const offset = Object.getOwnPropertyDescriptor(intrinsic, 'byteOffset')?.get?.call(raw) as number;
    const length = Object.getOwnPropertyDescriptor(intrinsic, 'byteLength')?.get?.call(raw) as number;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0) return null;
    const view = new Uint8Array(backing, offset, length);

    let bytes: Uint8Array = view;
    let encoding = 'utf-8';
    switch (declaredEncoding.value) {
      case 'utf-8-bom':
        if (view[0] !== 0xef || view[1] !== 0xbb || view[2] !== 0xbf) return null;
        bytes = view.subarray(3); break;
      case 'utf-16le-bom':
        if (view[0] !== 0xff || view[1] !== 0xfe) return null;
        bytes = view.subarray(2); encoding = 'utf-16le'; break;
      case 'utf-16be-bom':
        if (view[0] !== 0xfe || view[1] !== 0xff || (view.length - 2) % 2) return null;
        bytes = new Uint8Array(view.length - 2);
        for (let i = 0; i < bytes.length; i += 2) {
          bytes[i] = view[i + 3];
          bytes[i + 1] = view[i + 2];
        }
        encoding = 'utf-16le'; break;
      case 'gb18030-explicit': encoding = 'gb18030'; break;
      case 'utf-8': break;
      default: return null;
    }
    return new TextDecoder(encoding, {fatal:true}).decode(bytes);
  } catch {
    return null;
  }
}
export function parseUserscriptMetadata(script: Pick<ImportedScript, 'bytes'|'textEncoding'>): MetadataResult {
  const source = readUserscriptSource(script);
  const empty = (status: MetadataStatus): MetadataResult =>
    ({status,header:null,lines:[],tags:{},unknownNames:[]});
  if (source === null) return empty('INVALID_ENCODING');
  const lines = source.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
  const start = lines.findIndex(line => line.trim() !== '');
  if (start === -1 || !/^\s*\/\/\s*==UserScript==\s*$/.test(lines[start])) {
    return empty('MISSING_HEADER');
  }
  const end = lines.findIndex((line,i) => i > start && /^\s*\/\/\s*==\/UserScript==\s*$/.test(line));
  if (end === -1) return empty('UNTERMINATED_HEADER');
  const parsed: MetadataLine[] = [];
  const tags: Record<string,string[]> = Object.create(null) as Record<string,string[]>;
  const unknown = new Set<string>();
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i];
    const match = /^\s*\/\/\s*@([a-zA-Z][a-zA-Z0-9_:.-]*)(?:\s+(.*))?$/.exec(raw);
    if (!match) {
      parsed.push({line:i+1,raw,kind:raw.trim()?'comment':'blank'});
      continue;
    }
    const name = match[1];
    const canonical = name.toLowerCase();
    const value = match[2] ?? '';
    const known = KNOWN.has(canonical);
    (tags[canonical] ??= []).push(value);
    if (!known) unknown.add(name);
    parsed.push({line:i+1,raw,kind:'tag',name,value,known});
  }
  return {status:'OK',header:lines.slice(start,end+1).join('\n'),
    lines:parsed,tags,unknownNames:[...unknown]};
}
