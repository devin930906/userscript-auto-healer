import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {discoverModelsFromNativeConfig,readNativeSelectedAiConfig} from '../../src/ai/native-model-discovery';

const config=()=>JSON.stringify({
  baseUrl:'https://models.example.com/v1',apiKey:'private-native-key',
  manualModel:'manual-model',maxRequests:2,timeoutMs:1200,maxOutputTokens:64
});
const modelTransport=(calls:{url:string;authorization:string}[]):typeof fetch=>
  async (input,init)=>{
    calls.push({url:String(input),authorization:String((init?.headers as Record<string,string>)?.Authorization)});
    return Response.json({data:[{id:'safe-model'},{id:'safe-model'},{id:'second-model'}]});
  };

test('TASK-014/TEST-015/016: no native consent means zero provider requests',async()=>{
  const calls:{url:string;authorization:string}[]=[];
  const refused=await discoverModelsFromNativeConfig(config(),async()=>false,undefined,modelTransport(calls));
  assert.deepEqual(refused,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(calls.length,0);
  const aborted=new AbortController();aborted.abort();
  const result=await discoverModelsFromNativeConfig(config(),async()=>true,aborted.signal,modelTransport(calls));
  assert.deepEqual(result,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(calls.length,0);
});

test('TASK-014/TEST-016: selected native config and approved origin fetch models only',async()=>{
  const calls:{url:string;authorization:string}[]=[];
  const approved:string[]=[];
  const result=await discoverModelsFromNativeConfig(config(),async origin=>{
    approved.push(origin);return true;
  },undefined,modelTransport(calls));
  assert.deepEqual(approved,['https://models.example.com']);
  assert.deepEqual(calls,[{url:'https://models.example.com/v1/models',
    authorization:'Bearer private-native-key'}]);
  assert.deepEqual(result,{ok:true,status:'MODELS_DISCOVERED',
    models:['safe-model','second-model'],manualModelAvailable:true,
    automaticPatchAllowed:false});
  assert.equal(JSON.stringify(result).includes('private-native-key'),false);
  assert.equal(JSON.stringify(result).includes('models.example.com'),false);
});

test('TASK-014/TEST-016: 404 is an explicit manual-model fallback, not installation',async()=>{
  const result=await discoverModelsFromNativeConfig(config(),async()=>true,
    undefined,async()=>new Response('',{status:404}));
  assert.deepEqual(result,{ok:true,status:'MANUAL_MODEL_FALLBACK',
    models:[],manualModelAvailable:true,automaticPatchAllowed:false});
});

test('TASK-014/TEST-015/016: invalid, oversized or revoked native config never calls provider',async()=>{
  let requests=0;let confirmations=0;
  const transport:typeof fetch=async()=>{requests++;return Response.json({data:[]});};
  const confirm=async()=>{confirmations++;return true;};
  for(const bad of ['{}','not-json',config()+' '.repeat(5000),
      config().replace('private-native-key','key\\nspoof')]){
    const result=await discoverModelsFromNativeConfig(bad,confirm,undefined,transport);
    assert.deepEqual(result,{ok:false,code:'INVALID_CONFIGURATION',automaticPatchAllowed:false});
  }
  assert.equal(requests,0);
  assert.equal(confirmations,0);
  const controller=new AbortController();
  const waiting=discoverModelsFromNativeConfig(config(),async()=>{
    controller.abort();return true;
  },controller.signal,transport);
  assert.deepEqual(await waiting,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(requests,0);
});

test('TASK-014/TEST-016/026: native-picked config read is bounded, UTF-8 strict and rejects links',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'uah-ai-native-'));
  try{
    const valid=join(dir,'valid.json'),large=join(dir,'large.json');
    const invalid=join(dir,'invalid.json'),alias=join(dir,'alias.json');
    await writeFile(valid,config(),'utf8');
    await writeFile(large,Buffer.alloc(4097,0x41));
    await writeFile(invalid,Buffer.from([0xc3,0x28]));
    assert.equal(await readNativeSelectedAiConfig(valid),config());
    assert.equal(await readNativeSelectedAiConfig(large),null);
    assert.equal(await readNativeSelectedAiConfig(invalid),null);
    assert.equal(await readNativeSelectedAiConfig(join(dir,'absent.json')),null);
    try{
      await symlink(valid,alias,'file');
      assert.equal(await readNativeSelectedAiConfig(alias),null);
    }catch(error){
      if(!['EPERM','ENOTSUP','EACCES'].includes(
         (error as NodeJS.ErrnoException).code??''))throw error;
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('TASK-014/TEST-015/016/026: forged native discovery cancellation never touches getters or consent',async()=>{
  let approvals=0;
  let requests=0;
  let getterCalls=0;
  const approve=async()=>{approvals++;return true;};
  const transport:typeof fetch=async()=>{requests++;return Response.json({data:[]});};
  const forged=Object.defineProperty({},'aborted',{get(){
    getterCalls++;
    throw Error('PRIVATE_FORGED_CANCEL_GETTER');
  }});
  const native=new AbortController().signal;
  const proxy=new Proxy(native,{get(){
    getterCalls++;
    throw Error('PRIVATE_PROXY_CANCEL_GETTER');
  }});
  for(const signal of [forged,proxy] as unknown as AbortSignal[]){
    assert.deepEqual(await discoverModelsFromNativeConfig(config(),approve,signal,transport),
      {ok:false,code:'INVALID_CANCEL_SIGNAL',automaticPatchAllowed:false});
  }
  assert.equal(getterCalls,0,'no forged cancellation accessor or Proxy trap can run');
  assert.equal(approvals,0,'invalid cancellation must not reach privileged OS consent');
  assert.equal(requests,0,'invalid cancellation must not access provider');
});

test('TASK-014/TEST-016/026: forged non-aborted cancellation is rejected before OS approval',async()=>{
  let approvals=0;
  let sent=0;
  const fake={aborted:false} as AbortSignal;
  const result=await discoverModelsFromNativeConfig(config(),async()=>{
    approvals++;
    return true;
  },fake,async()=>{sent++;return Response.json({data:[]});});
  assert.deepEqual(result,{ok:false,code:'INVALID_CANCEL_SIGNAL',automaticPatchAllowed:false});
  assert.equal(approvals,0);
  assert.equal(sent,0);
});


test('TASK-014/TEST-015/016: revoking native consent cancels a pending approval before any provider request',async()=>{
  const controller=new AbortController();
  let approvalStarted:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{approvalStarted=resolve;});
  let requests=0;
  const pending=discoverModelsFromNativeConfig(config(),async()=>{
    approvalStarted();
    return new Promise<boolean>(()=>{});
  },controller.signal,async()=>{
    requests++;
    return Response.json({data:[]});
  });
  await started;
  controller.abort();
  const result=await Promise.race([
    pending,
    new Promise<'TIMED_OUT'>(resolve=>setTimeout(()=>resolve('TIMED_OUT'),500))
  ]);
  assert.deepEqual(result,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(requests,0,'revoked consent cannot invoke the provider');
});
