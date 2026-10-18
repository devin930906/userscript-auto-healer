/** TASK-005: Windows Chrome preflight only.
 * This module never creates profiles, starts Chrome, or attaches to existing CDP.
 * A positive result still requires executable version, process and endpoint
 * ownership to be verified by the later launch/session step.
 */
import { lstat, readdir } from 'node:fs/promises';
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
