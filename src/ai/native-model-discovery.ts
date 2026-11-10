/**
 * TASK-014 / REQ-016 / TEST-015/016/026: single, native-only model discovery.
 * The renderer cannot supply paths, configuration, keys or provider payloads.
 * Only a trusted OS picker may select the input file; approval is a separate
 * native dialog that names the exact origin. No credentials are persisted.
 * A completed result is untrusted model metadata, never script-write authority.
 */
import {open,lstat} from 'node:fs/promises';
import {types as nodeTypes} from 'node:util';
import {OptionalAiGateway,type GatewayCode} from './model-gateway';

const MAX_NATIVE_CONFIG_BYTES=4096;
type FailureCode=GatewayCode|'CANCELLED'|'INVALID_CONFIGURATION';
export type NativeModelDiscoveryResult=
 |Readonly<{ok:false;code:FailureCode;automaticPatchAllowed:false}>
 |Readonly<{ok:true;status:'MODELS_DISCOVERED'|'MANUAL_MODEL_FALLBACK';
   models:readonly string[];manualModelAvailable:boolean;automaticPatchAllowed:false}>;
const blocked=(code:FailureCode):NativeModelDiscoveryResult=>
  Object.freeze({ok:false,code,automaticPatchAllowed:false as const});

/** Read at most 4097 bytes from an explicitly native-selected regular file.
 * Never accept a symlink, pipe, unbounded input, changed inode or invalid UTF-8.
 * The path is an implementation detail and never appears in a result or log.
 */
export async function readNativeSelectedAiConfig(path:unknown):Promise<string|null>{
  if(typeof path!=='string'||!path||path.length>4096)return null;
  try{
    const initial=await lstat(path,{bigint:true});
    if(!initial.isFile()||initial.isSymbolicLink()||
       initial.size<=0n||initial.size>BigInt(MAX_NATIVE_CONFIG_BYTES))return null;
    const handle=await open(path,'r');
    try{
      const opened=await handle.stat({bigint:true});
      if(!opened.isFile()||opened.dev!==initial.dev||opened.ino!==initial.ino||
         opened.size!==initial.size||opened.mtimeNs!==initial.mtimeNs)
        return null;
      const bytes=Buffer.alloc(MAX_NATIVE_CONFIG_BYTES+1);
      let count=0;
      while(count<bytes.length){
        const read=await handle.read(bytes,count,bytes.length-count,count);
        if(read.bytesRead===0)break;
        count+=read.bytesRead;
      }
      const after=await handle.stat({bigint:true});
      if(count!==Number(initial.size)||after.size!==initial.size||
         after.mtimeNs!==initial.mtimeNs||after.ctimeNs!==opened.ctimeNs||
         after.dev!==initial.dev||after.ino!==initial.ino)return null;
      return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count));
    }finally{await handle.close();}
  }catch{return null;}
}

/** A native OS consent callback is privileged. Before reading .aborted or
 * opening its dialog, reject any Proxy, fake signal or accessor override.
 * The native AbortSignal getter checks the engine's internal signal slot.
 */
function validNativeDiscoverySignal(value:unknown):value is AbortSignal{
  try{
    if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
       Object.getPrototypeOf(value)!==AbortSignal.prototype||
       ['aborted','addEventListener','removeEventListener'].some(key=>
         Object.prototype.hasOwnProperty.call(value,key)))return false;
    const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
    return typeof getter==='function'&&typeof getter.call(value)==='boolean';
  }catch{return false;}
}

/** Neither reading configuration nor native consent grants a persistent AI
 * session. The only possible network action is one bounded GET /models.
 */
export async function discoverModelsFromNativeConfig(
  configText:unknown,
  authorizeOrigin:(origin:string)=>Promise<boolean>,
  signal?:AbortSignal,
  transport:typeof fetch=fetch
):Promise<NativeModelDiscoveryResult>{
  if(signal!==undefined&&!validNativeDiscoverySignal(signal))
    return blocked('INVALID_CANCEL_SIGNAL');
  if(typeof configText!=='string'||
     Buffer.byteLength(configText,'utf8')>MAX_NATIVE_CONFIG_BYTES||
     configText.length===0||signal?.aborted)return signal?.aborted
       ?blocked('CANCELLED'):blocked('INVALID_CONFIGURATION');
  let gateway:OptionalAiGateway;
  let origin:string;
  try{
    const config:unknown=JSON.parse(configText);
    gateway=new OptionalAiGateway(config,transport);
    // URL input was already fully validated by the native gateway constructor.
    origin=new URL((config as {baseUrl:string}).baseUrl).origin;
  }catch{return blocked('INVALID_CONFIGURATION');}
  try{
    if(signal?.aborted)return blocked('CANCELLED');
    const approved=await authorizeOrigin(origin);
    if(!approved||signal?.aborted)return blocked('CANCELLED');
    const consent={userApproved:true as const,approvedOrigin:origin};
    if(!gateway.enable(consent))return blocked('NOT_AUTHORIZED');
    const result=await gateway.discoverModels(consent,signal);
    if(!result.ok)return blocked(result.code);
    return Object.freeze({ok:true,status:result.status,models:result.models,
      manualModelAvailable:result.manualModelAvailable,
      automaticPatchAllowed:false as const});
  }catch{return blocked('CANCELLED');
  }finally{gateway.disable();}
}
