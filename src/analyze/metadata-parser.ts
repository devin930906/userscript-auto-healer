/** TASK-003 / REQ-004: read-only userscript metadata extraction. */
import type { ImportedScript } from '../import/import-service';

const KNOWN = new Set([
  'name','namespace','version','description','author','match','include',
  'exclude','run-at','grant','require','resource','connect','updateurl',
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
  const raw = script.bytes;
  let bytes = raw;
  let encoding = 'utf-8';
  switch (script.textEncoding) {
    case 'utf-8-bom':
      if (raw[0] !== 0xef || raw[1] !== 0xbb || raw[2] !== 0xbf) return null;
      bytes = raw.subarray(3); break;
    case 'utf-16le-bom':
      if (raw[0] !== 0xff || raw[1] !== 0xfe) return null;
      bytes = raw.subarray(2); encoding = 'utf-16le'; break;
    case 'utf-16be-bom':
      if (raw[0] !== 0xfe || raw[1] !== 0xff || (raw.length - 2) % 2) return null;
      bytes = Uint8Array.from(raw.subarray(2));
      for (let i = 0; i < bytes.length; i += 2) {
        const value = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = value;
      }
      encoding = 'utf-16le'; break;
    case 'gb18030-explicit': encoding = 'gb18030'; break;
    case 'utf-8': break;
    default: return null;
  }
  try { return new TextDecoder(encoding, {fatal:true}).decode(bytes); }
  catch { return null; }
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
