/**
 * TASK-018 / GATE-006/010: fail-closed, read-only audit of npm lockfile
 * license metadata against actual installed package manifests.
 *
 * This proves only package identity and license DECLARATION consistency.
 * It does not approve license compatibility, verify license texts, audit
 * vulnerabilities or constitute Stable acceptance. No network or writes.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');

function fail(code){throw Error(code);}
function validPackagePath(key){
 if(typeof key!=='string'||!key||key.includes('\\')||key.includes('\0'))return false;
 const segments=key.split('/');
 let index=0;
 const plain=/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
 const scope=/^@[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
 while(index<segments.length){
  if(segments[index++]!=='node_modules'||index>=segments.length)return false;
  let name=segments[index++];
  if(name.startsWith('@')){
   if(!scope.test(name)||index>=segments.length||
      !plain.test(segments[index])||segments[index]==='..')return false;
   index++;
  }else if(!plain.test(name)||name==='.'||name==='..')return false;
 }
 return true;
}
function audit(root){
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
 if(!lock||lock.lockfileVersion!==3||
    !lock.packages||typeof lock.packages!=='object'||
    Array.isArray(lock.packages))fail('INVALID_LOCKFILE');
 const canonicalRoot=fs.realpathSync(root);
 const prefix=canonicalRoot+path.sep;
 let reviewed=0,optionalAbsent=0;
 const entries=Object.entries(lock.packages);
 for(const [key,record] of entries){
  if(key==='')continue; // npm's root package is not a third-party dependency
  if(!validPackagePath(key))fail('INVALID_LOCKED_PACKAGE_PATH');
  if(!record||typeof record!=='object'||Array.isArray(record)||
     typeof record.version!=='string'||!record.version.trim())
   fail('INVALID_LOCKED_PACKAGE_RECORD');
  if(typeof record.license!=='string'||!record.license.trim())
   fail('MISSING_LICENSE_DECLARATION');
  reviewed++;
  const folder=path.join(root,...key.split('/'));
  let status;
  try{status=fs.lstatSync(folder);}catch(error){
   if(error?.code==='ENOENT'&&record.optional===true){
    optionalAbsent++;continue;
   }
   fail('LOCKED_DEPENDENCY_NOT_INSTALLED');
  }
  if(!status.isDirectory()||status.isSymbolicLink())
   fail('UNSAFE_INSTALLED_PACKAGE_DIRECTORY');
  let installedRoot;
  try{installedRoot=fs.realpathSync(folder);}catch{fail('UNSAFE_INSTALLED_PACKAGE_DIRECTORY');}
  if(!installedRoot.startsWith(prefix))fail('UNSAFE_INSTALLED_PACKAGE_DIRECTORY');
  let installed;
  try{
   installed=JSON.parse(fs.readFileSync(path.join(installedRoot,'package.json'),'utf8'));
  }catch{fail('INSTALLED_PACKAGE_MANIFEST_UNREADABLE');}
  if(!installed||installed.version!==record.version)
   fail('INSTALLED_VERSION_MISMATCH');
  if(typeof installed.license!=='string'||
     installed.license.trim()!==record.license.trim())
   fail('INSTALLED_LICENSE_MISMATCH');
 }
 if(reviewed===0)fail('EMPTY_LOCKED_DEPENDENCY_SET');
 return {reviewed,optionalAbsent};
}
try{
 if(process.argv.length!==2)fail('INVALID_AUDIT_ARGUMENTS');
 const result=audit(process.cwd());
 console.log('LOCKED_DEPENDENCY_LICENSE_METADATA_OK packages='+result.reviewed+
   ' optionalAbsent='+result.optionalAbsent+
   ' scope=lockfile-and-installed-manifests-only');
}catch(error){
 // Print bounded machine-readable failure code, never absolute paths or source.
 const raw=String(error?.message||'AUDIT_FAILED');
 const code=/^[A-Z][A-Z0-9_]{2,72}$/.test(raw)?raw:'AUDIT_FAILED';
 console.error(code);
 process.exitCode=1;
}
