import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const MAX_CHROME_STARTUP_LOG_BYTES=1_048_576;

export type ChromeStartupLogSummary =
  | Readonly<{status:'unavailable'}>
  | Readonly<{status:'too-large'}>
  | Readonly<{status:'invalid-port'}>
  | Readonly<{
      status:'parsed';
      devtoolsAnnouncementCount:number;
      configuredLoopbackEndpointAnnounced:boolean;
      errorLineCount:number;
      fatalLineCount:number;
    }>;

/**
 * Return only fixed, allow-listed startup signals from a disposable Chrome log.
 * Never return log lines, URLs, ports, profile paths, browser IDs, or tokens.
 */
export function summarizeChromeStartupLog(
  content:string,expectedPort:number
):ChromeStartupLogSummary{
  if(Buffer.byteLength(content,'utf8')>MAX_CHROME_STARTUP_LOG_BYTES)
    return Object.freeze({status:'too-large'});
  if(!Number.isInteger(expectedPort)||expectedPort<1||expectedPort>65535)
    return Object.freeze({status:'invalid-port'});

  const lines=content.split(/\r\n|\n|\r/);
  let devtoolsAnnouncementCount=0,errorLineCount=0,fatalLineCount=0;
  let configuredLoopbackEndpointAnnounced=false;
  const endpointPattern=new RegExp(
    `DevTools listening on\\s+ws:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${expectedPort}(?:[/:\\s]|$)`,'i'
  );
  for(const line of lines){
    if(/DevTools listening on/i.test(line))
      devtoolsAnnouncementCount=Math.min(99,devtoolsAnnouncementCount+1);
    if(endpointPattern.test(line))configuredLoopbackEndpointAnnounced=true;
    if(/\bERROR:/i.test(line))errorLineCount=Math.min(99,errorLineCount+1);
    if(/\bFATAL:/i.test(line))fatalLineCount=Math.min(99,fatalLineCount+1);
  }
  return Object.freeze({status:'parsed',devtoolsAnnouncementCount,
    configuredLoopbackEndpointAnnounced,errorLineCount,fatalLineCount});
}

/** Read only the regular, size-bounded log inside the test-owned Profile. */
export function readChromeStartupLogSummary(
  profile:string,expectedPort:number
):ChromeStartupLogSummary{
  try{
    const path=join(profile,'chrome_debug.log');
    const info=lstatSync(path);
    if(!info.isFile()||info.isSymbolicLink())
      return Object.freeze({status:'unavailable'});
    if(info.size>MAX_CHROME_STARTUP_LOG_BYTES)
      return Object.freeze({status:'too-large'});
    return summarizeChromeStartupLog(readFileSync(path,'utf8'),expectedPort);
  }catch{
    return Object.freeze({status:'unavailable'});
  }
}
