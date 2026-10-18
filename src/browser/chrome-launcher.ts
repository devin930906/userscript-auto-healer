/** TASK-005: Windows Chrome preflight only.
 * This module never creates profiles, starts Chrome, or attaches to existing CDP.
 * A positive result still requires executable version, process and endpoint
 * ownership to be verified by the later launch/session step.
 */
import { lstat, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { win32 } from 'node:path';
import { validateBrowserConfig, type BrowserConfig } from '../security/browser-config';

export type BrowserPreflightFailure =
  'INVALID_CONFIG' | 'UNSUPPORTED_PLATFORM' | 'EXECUTABLE_NOT_FOUND' |
  'EXECUTABLE_LINK_REJECTED' | 'EXECUTABLE_NOT_FILE' | 'UNSAFE_PROFILE' |
  'PROFILE_NOT_FOUND' | 'PROFILE_LINK_REJECTED' | 'PROFILE_NOT_DIRECTORY' |
  'PROFILE_IN_USE' | 'CDP_PORT_IN_USE' | 'PORT_PROBE_FAILED';
export type BrowserPreflight =
  | { readonly ok: true; readonly status: 'PATH_AND_PORT_CHECKED_ONLY';
      readonly config: BrowserConfig; readonly runtimeIdentityVerified: false }
  | { readonly ok: false; readonly code: BrowserPreflightFailure };

function isDefaultProfile(path:string):boolean {
  const normalized=win32.normalize(path).toLowerCase().replace(/\\+$/,'');
  return /\\google\\chrome\\user data(?:\\|$)/.test(normalized) ||
    /\\microsoft\\edge\\user data(?:\\|$)/.test(normalized) ||
    /\\chromium\\user data(?:\\|$)/.test(normalized);
}
async function hasLinkedComponent(path:string):Promise<boolean> {
  const normalized=win32.normalize(path);
  const parts=normalized.split('\\').filter(Boolean);
  let cursor=win32.parse(normalized).root;
  const beginning=cursor.split('\\').filter(Boolean).length;
  for(const segment of parts.slice(beginning)){
    cursor=win32.join(cursor,segment);
    let s;
    try {s=await lstat(cursor);} catch {break;}
    if(s.isSymbolicLink())return true;
  }
  return false;
}
function availableOnLoopback(port:number):Promise<boolean> {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',(err:NodeJS.ErrnoException)=>{
      if(err.code==='EADDRINUSE'||err.code==='EACCES'){resolve(false);return;}
      reject(err);
    });
    server.listen({host:'127.0.0.1',port,exclusive:true},()=>{
      server.close((err)=>err?reject(err):resolve(true));
    });
  });
}
/** Only use with user-selected paths; this is a read-only check, NOT permission to launch. */
export async function preflightChrome(input:unknown):Promise<BrowserPreflight>{
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  const parsed=validateBrowserConfig(input);
  if(!parsed.ok)return {ok:false,code:'INVALID_CONFIG'};
  const config=parsed.config;
  if(isDefaultProfile(config.userDataDir))return {ok:false,code:'UNSAFE_PROFILE'};
  try{
    if(await hasLinkedComponent(config.executablePath))return {ok:false,code:'EXECUTABLE_LINK_REJECTED'};
    const exe=await lstat(config.executablePath);
    if(!exe.isFile())return {ok:false,code:'EXECUTABLE_NOT_FILE'};
  }catch{return {ok:false,code:'EXECUTABLE_NOT_FOUND'};}
  try {
    if(await hasLinkedComponent(config.userDataDir))return {ok:false,code:'PROFILE_LINK_REJECTED'};
    const profile=await lstat(config.userDataDir);
    if(!profile.isDirectory())return {ok:false,code:'PROFILE_NOT_DIRECTORY'};
    // An existing active Chrome Profile is never implicitly reusable.
    const entries=await readdir(config.userDataDir);
    if(entries.some(name=>['SingletonLock','SingletonCookie','SingletonSocket','lockfile'].includes(name)))
      return {ok:false,code:'PROFILE_IN_USE'};
  }catch{return {ok:false,code:'PROFILE_NOT_FOUND'};}
  try {
    if(!await availableOnLoopback(config.remoteDebuggingPort))
      return {ok:false,code:'CDP_PORT_IN_USE'};
  }catch{return {ok:false,code:'PORT_PROBE_FAILED'};}
  return {ok:true,status:'PATH_AND_PORT_CHECKED_ONLY',config,runtimeIdentityVerified:false};
}


/** Read-only executable identity gate for selected standard/portable official Chrome.
 * File version metadata is not enough: an unsigned renamed EXE is rejected.
 * Passing this check is NOT a running-process/CDP/profile compatibility verdict.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const runPowershell=promisify(execFileCallback);
export type ChromeBinaryInspection =
  | {readonly ok:true; readonly status:'SIGNED_GOOGLE_CHROME_BINARY';
     readonly version:string;readonly publisher:'Google LLC';readonly runtimeVerified:false}
  | {readonly ok:false;readonly code:'INVALID_CONFIG'|'UNSUPPORTED_PLATFORM'|
      'IDENTITY_UNAVAILABLE'|'UNTRUSTED_BINARY'|'VERSION_UNAVAILABLE'};
export async function inspectWindowsChromeBinary(input:unknown):Promise<ChromeBinaryInspection> {
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  const valid=validateBrowserConfig(input);
  if(!valid.ok)return {ok:false,code:'INVALID_CONFIG'};
  // Base64 transport prevents shell parsing of user-selected paths. No powershell interpolation.
  const file=Buffer.from(valid.config.executablePath,'utf16le').toString('base64');
  const script='$ErrorActionPreference="Stop";'+
    '$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("'+file+'"));'+
    '$item=Get-Item -LiteralPath $p -ErrorAction Stop;'+
    '$signature=Get-AuthenticodeSignature -LiteralPath $p -ErrorAction Stop;'+
    '$vi=$item.VersionInfo;'+
    '[pscustomobject]@{name=$vi.ProductName;fileName=$vi.OriginalFilename;'+
    'version=$vi.ProductVersion;status=[string]$signature.Status;'+
    'signer=[string]$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress';
  let data:Record<string,unknown>;
  try{
    const encoded=Buffer.from(script,'utf16le').toString('base64');
    let output:string|undefined;
    for(const executable of ['pwsh.exe','powershell.exe']){
      try{
        const result=await runPowershell(executable,
          ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
          {windowsHide:true,timeout:15000,maxBuffer:8192});
        output=result.stdout;break;
      }catch(e){
        // Only fall back when the modern host is absent, never after an identity failure.
        if(executable==='pwsh.exe' && (e as NodeJS.ErrnoException).code==='ENOENT')continue;
        throw e;
      }
    }
    if(!output)throw Error('EMPTY_IDENTITY_PROBE');
    data=JSON.parse(output) as Record<string,unknown>;
  }catch{
    return {ok:false,code:'IDENTITY_UNAVAILABLE'};
  }
  if(data.status!=='Valid' || typeof data.signer!=='string' ||
     !/(?:^|,)\s*CN=Google LLC(?:,|$)/i.test(data.signer) ||
     !['Google Chrome','Google Chrome for Testing'].includes(data.name as string) || typeof data.fileName!=='string' ||
     data.fileName.toLowerCase()!=='chrome.exe')
    return {ok:false,code:'UNTRUSTED_BINARY'};
  if(typeof data.version!=='string' ||
     !/^\d+\.\d+\.\d+\.\d+$/.test(data.version))
    return {ok:false,code:'VERSION_UNAVAILABLE'};
  return {ok:true,status:'SIGNED_GOOGLE_CHROME_BINARY',
    version:data.version,publisher:'Google LLC',runtimeVerified:false};
}

/** TASK-005 / REQ-007: create ONLY an explicitly approved, empty, new
 * isolated Profile. Existing directories, links, default profiles and implicit
 * parent creation are deliberately not supported by this operation.
 */
export type ProfilePreparation =
  | {readonly ok:true;readonly status:'EMPTY_PROFILE_CREATED';readonly userDataDir:string}
  | {readonly ok:false;readonly code:'NOT_AUTHORIZED'|'UNSUPPORTED_PLATFORM'|
      'INVALID_CONFIG'|'UNSAFE_PARENT'|'PARENT_UNAVAILABLE'|'PROFILE_EXISTS'|
      'BINARY_NOT_VERIFIED'|'PROFILE_CREATE_FAILED'};
export async function prepareApprovedIsolatedProfile(
  input:unknown,userApproved:boolean
):Promise<ProfilePreparation> {
  if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
  if(process.platform!=='win32')return {ok:false,code:'UNSUPPORTED_PLATFORM'};
  const valid=validateBrowserConfig(input);
  if(!valid.ok)return {ok:false,code:'INVALID_CONFIG'};
  const cfg=valid.config;
  if(isDefaultProfile(cfg.userDataDir))return {ok:false,code:'INVALID_CONFIG'};
  const parent=win32.dirname(cfg.userDataDir);
  try{
    if(await hasLinkedComponent(parent))return {ok:false,code:'UNSAFE_PARENT'};
    const stat=await lstat(parent);
    if(!stat.isDirectory())return {ok:false,code:'PARENT_UNAVAILABLE'};
  }catch{return {ok:false,code:'PARENT_UNAVAILABLE'};}
  try{
    await lstat(cfg.userDataDir);
    return {ok:false,code:'PROFILE_EXISTS'};
  }catch(e){
    if((e as NodeJS.ErrnoException).code!=='ENOENT')
      return {ok:false,code:'PROFILE_CREATE_FAILED'};
  }
  // Reject unsigned substitutions before writing anything to the selected disk.
  const binary=await inspectWindowsChromeBinary(cfg);
  if(!binary.ok)return {ok:false,code:'BINARY_NOT_VERIFIED'};
  try {
    await mkdir(cfg.userDataDir,{recursive:false});
    const stat=await lstat(cfg.userDataDir);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      return {ok:false,code:'PROFILE_CREATE_FAILED'};
    return {ok:true,status:'EMPTY_PROFILE_CREATED',userDataDir:cfg.userDataDir};
  }catch(e){
    if((e as NodeJS.ErrnoException).code==='EEXIST')
      return {ok:false,code:'PROFILE_EXISTS'};
    return {ok:false,code:'PROFILE_CREATE_FAILED'};
  }
}
