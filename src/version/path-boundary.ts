/** TASK-011 / TEST-020: reject directory junctions and symlink ancestors.
 * lstat(the final path) does not detect an intermediate Windows junction.
 * Native, already-validated absolute paths only. This is a conservative
 * snapshot check, NOT an atomic path handle or authorization token.
 * Callers must revalidate before and after sensitive filesystem operations.
 */
import {lstat} from 'node:fs/promises';
import {join,parse,resolve,sep} from 'node:path';

/** Pure lexical guard shared by read-only native imports and backup/restore.
 * A native picker pathname must never silently normalize into another name.
 * This function performs no filesystem I/O or authorization. */
export function hasUnsafePathSpelling(path:string):boolean{
  if(path!==resolve(path))return true;
  if(process.platform==='win32'&&
     (path.startsWith(String.fromCharCode(92,92,63,92))||
      path.startsWith(String.fromCharCode(92,92,46,92))))return true;
  const root=parse(path).root;
  return path.slice(root.length).split(sep).filter(Boolean).some(component=>{
    // Colons in components can name alternate data streams. Drive letters
    // belong to the parsed root, outside the component list.
    if(component.includes(':'))return true;
    if(process.platform==='win32'&&(
       /[<>"|?*\u0000-\u001f]/.test(component)||
       /^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|(?:COM|LPT)[1-9\u00B9\u00B2\u00B3])(?:\.|$)/i.test(component)||
       component.endsWith('.')||component.endsWith(' ')))return true;
    return false;
  });
}

/** Reject lexical aliases before inspecting each link or junction ancestor. */
export async function hasUnsafePathLink(path:string):Promise<boolean>{
  if(hasUnsafePathSpelling(path))return true;
  const root=parse(path).root;
  let current=root;
  for(const component of path.slice(root.length).split(sep).filter(Boolean)){
    current=join(current,component);
    if((await lstat(current,{bigint:true})).isSymbolicLink())return true;
  }
  return false;
}
