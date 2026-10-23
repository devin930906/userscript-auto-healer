/** TASK-011 / TEST-020: reject directory junctions and symlink ancestors.
 * lstat(the final path) does not detect an intermediate Windows junction.
 * Native, already-validated absolute paths only. This is a conservative
 * snapshot check, NOT an atomic path handle or authorization token.
 * Callers must revalidate before and after sensitive filesystem operations.
 */
import {lstat} from 'node:fs/promises';
import {join,parse,resolve,sep} from 'node:path';

export async function hasUnsafePathLink(path:string):Promise<boolean>{
  // Refuse ambiguous lexical aliases instead of normalizing a consented path.
  if(path!==resolve(path))return true;
  const root=parse(path).root;
  let current=root;
  for(const component of path.slice(root.length).split(sep).filter(Boolean)){
    // A colon within a component can name an NTFS stream. A drive letter
    // is already part of the parsed root and remains valid.
    if(component.includes(':'))return true;
    // Device aliases (including extension suffixes) may resolve to Win32
    // DOS device namespaces rather than the source path the user selected.
    // Reject before any filesystem lookup or source-derived lock identity.
    if(process.platform==='win32'&&
       /^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|(?:COM|LPT)[1-9\u00B9\u00B2\u00B3])(?:\.|$)/i.test(component))return true;
    // Win32 APIs may resolve "folder." or "folder " to "folder" (without
    // the explicit extended-path namespace). Their spelling can therefore
    // bypass source-path-derived backup identities or cooperative mutexes.
    // Reject those ambiguous ancestors before lstat follows an alias.
    // Hidden names such as ".config" and interior spaces remain legitimate.
    if(process.platform==='win32'&&
       (component.endsWith('.')||component.endsWith(' ')))return true;
    current=join(current,component);
    if((await lstat(current,{bigint:true})).isSymbolicLink())return true;
  }
  return false;
}
