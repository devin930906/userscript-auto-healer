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
    current=join(current,component);
    if((await lstat(current,{bigint:true})).isSymbolicLink())return true;
  }
  return false;
}
