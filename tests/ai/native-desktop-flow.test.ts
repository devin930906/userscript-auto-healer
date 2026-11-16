import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {NativeAiEvidenceStore} from '../../src/ai/native-reviewed-suggestion';
import {
  discoverNativeAiModelsFromDesktop,
  requestNativeAiSuggestionFromDesktop,
  type NativeAiDesktopSelection
} from '../../src/ai/native-desktop-flow';

const SCRIPT_SHA='a'.repeat(64);
const CONFIG=JSON.stringify({
  baseUrl:'https://models.example.test/custom/v1',
  apiKey:'synthetic-test-key',
  manualModel:'review-model',
  maxRequests:2,
  timeoutMs:1000,
  maxOutputTokens:64,
  protocol:'responses'
});

function selection(path:string|null,config: string|null,revoked:()=>boolean=()=>false){
  const loaded:string[]=[];
  const remembered:string[]=[];
  const flow:NativeAiDesktopSelection={
    selectConfigFile:async()=>path,
    readConfigFile:async(value)=>{loaded.push(value);return config;},
    rememberSelectedPath:(value)=>remembered.push(value),
    isRevoked:revoked
  };
  return {flow,loaded,remembered};
}

test('TASK-014/TEST-015/016: native desktop discovery cancellation and refusal send zero provider traffic',async()=>{
  let reads=0,approvals=0,requests=0;
  const transport:typeof fetch=async()=>{
    requests++;
    return Response.json({data:[{id:'should-not-be-used'}]});
  };
  const cancelled=selection(null,CONFIG);
  const cancelledResult=await discoverNativeAiModelsFromDesktop(
    cancelled.flow,async()=>{approvals++;return true;},undefined,transport);
  assert.deepEqual(cancelledResult,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.deepEqual(cancelled.loaded,[]);
  assert.deepEqual(cancelled.remembered,[]);

  const refused=selection('synthetic-native-config.json',CONFIG);
  const refusedResult=await discoverNativeAiModelsFromDesktop({
    ...refused.flow,
    readConfigFile:async(path)=>{reads++;return refused.flow.readConfigFile(path);}
  },async()=>{approvals++;return false;},undefined,transport);
  assert.deepEqual(refusedResult,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(reads,1);
  assert.equal(approvals,1);
  assert.equal(requests,0);
});

test('TASK-014/TEST-016: native desktop discovery sends one bounded request only after approval',async()=>{
  const picked=selection('synthetic-native-config.json',CONFIG);
  const approvals:string[]=[];
  const requests:{url:string;authorization:string}[]=[];
  const transport:typeof fetch=async(input,init)=>{
    requests.push({url:String(input),
      authorization:String((init?.headers as Record<string,string>)?.Authorization)});
    return Response.json({data:[{id:'safe-model'}]});
  };
  const result=await discoverNativeAiModelsFromDesktop(picked.flow,async(origin)=>{
    approvals.push(origin);
    return true;
  },undefined,transport);
  assert.deepEqual(picked.remembered,['synthetic-native-config.json']);
  assert.deepEqual(approvals,['https://models.example.test']);
  assert.deepEqual(requests,[{
    url:'https://models.example.test/custom/v1/models',
    authorization:'Bearer synthetic-test-key'
  }]);
  assert.deepEqual(result,{ok:true,status:'MODELS_DISCOVERED',models:['safe-model'],
    manualModelAvailable:true,automaticPatchAllowed:false});
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'),false);
});

test('TASK-014/TEST-015/016: selected native scenario and config drive one disclosed untrusted suggestion',async()=>{
  const store=new NativeAiEvidenceStore();
  assert.equal(store.record('synthetic_scenario',SCRIPT_SHA,'#private-selector',
    'SELECTOR_ASSERTION'),true);
  const evidence=store.resolve('synthetic_scenario');
  assert.ok(evidence);
  const picked=selection('synthetic-native-config.json',CONFIG);
  let disclosedTarget:unknown;
  let disclosedEvidence:unknown;
  const requests:{url:string;authorization:string;body:string}[]=[];
  const transport:typeof fetch=async(input,init)=>{
    requests.push({url:String(input),
      authorization:String((init?.headers as Record<string,string>)?.Authorization),
      body:String(init?.body)});
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',
      status:'completed',content:[{type:'output_text',text:'Untrusted test suggestion.'}]}]});
  };
  const result=await requestNativeAiSuggestionFromDesktop(picked.flow,evidence,
    async(_origin,review,target)=>{
      disclosedEvidence=review;
      disclosedTarget=target;
      return true;
    },undefined,transport);
  assert.deepEqual(picked.remembered,['synthetic-native-config.json']);
  assert.deepEqual(disclosedEvidence,evidence);
  assert.deepEqual(disclosedTarget,{method:'POST',
    url:'https://models.example.test/custom/v1/responses'});
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,(disclosedTarget as {url:string}).url);
  assert.equal(requests[0].authorization,'Bearer synthetic-test-key');
  assert.deepEqual(JSON.parse(requests[0].body).input[0],
    {role:'user',content:JSON.stringify(evidence)});
  assert.deepEqual(result,{ok:true,status:'UNTRUSTED_AI_TEXT_ONLY',
    candidateText:'Untrusted test suggestion.',model:'review-model',
    tampermonkeyVerified:false,businessVerified:false,
    automaticPatchAllowed:false,automaticRollbackAllowed:false});
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'),false);
  assert.equal(requests[0].body.includes('#private-selector'),false);
});

test('TASK-014/TEST-015/016: review picker cancellation or native refusal sends zero provider traffic',async()=>{
  const store=new NativeAiEvidenceStore();
  assert.equal(store.record('synthetic_scenario',SCRIPT_SHA,'#private-selector',
    'SELECTOR_ASSERTION'),true);
  const evidence=store.resolve('synthetic_scenario');
  assert.ok(evidence);
  let approvals=0,requests=0;
  const transport:typeof fetch=async()=>{
    requests++;
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',
      status:'completed',content:[{type:'output_text',text:'must not be returned'}]}]});
  };
  const cancelled=selection(null,CONFIG);
  const cancelledResult=await requestNativeAiSuggestionFromDesktop(cancelled.flow,
    evidence,async()=>{approvals++;return true;},undefined,transport);
  assert.deepEqual(cancelledResult,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.deepEqual(cancelled.remembered,[]);

  const refused=selection('synthetic-native-config.json',CONFIG);
  const refusedResult=await requestNativeAiSuggestionFromDesktop(refused.flow,
    evidence,async()=>{approvals++;return false;},undefined,transport);
  assert.deepEqual(refusedResult,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.deepEqual(refused.remembered,['synthetic-native-config.json']);
  assert.equal(approvals,1);
  assert.equal(requests,0);
});

test('TASK-014/TEST-015/016: abort during native review authorization settles promptly and ignores late approval',async()=>{
  const store=new NativeAiEvidenceStore();
  assert.equal(store.record('synthetic_scenario',SCRIPT_SHA,'#private-selector',
    'SELECTOR_ASSERTION'),true);
  const evidence=store.resolve('synthetic_scenario');
  assert.ok(evidence);
  const controller=new AbortController();
  const picked=selection('synthetic-native-config.json',CONFIG);
  let resolveApproval!:(approved:boolean)=>void;
  let markAuthorizationStarted!:()=>void;
  const authorizationStarted=new Promise<void>(resolve=>{
    markAuthorizationStarted=resolve;
  });
  const pendingApproval=new Promise<boolean>(resolve=>{
    resolveApproval=resolve;
  });
  let requests=0;
  const transport:typeof fetch=async()=>{
    requests++;
    return Response.json({status:'completed',output:[]});
  };
  const request=requestNativeAiSuggestionFromDesktop(picked.flow,evidence,()=>{
    markAuthorizationStarted();
    return pendingApproval;
  },controller.signal,transport);
  await authorizationStarted;
  controller.abort();
  const timedOut=Symbol('authorization did not settle after cancellation');
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const outcome=await Promise.race([
    request,
    new Promise<typeof timedOut>(resolve=>{
      timeout=setTimeout(()=>resolve(timedOut),25);
    })
  ]);
  if(timeout)clearTimeout(timeout);
  resolveApproval(true);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.notEqual(outcome,timedOut);
  assert.deepEqual(outcome,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(requests,0);
});

test('TASK-014/TEST-015/016: window or selection revocation after config read prevents native approval and network traffic',async()=>{
  let revoked=false,approvals=0,requests=0;
  const picked=selection('synthetic-native-config.json',CONFIG,()=>revoked);
  const flow:NativeAiDesktopSelection={
    ...picked.flow,
    readConfigFile:async(path)=>{
      const config=await picked.flow.readConfigFile(path);
      revoked=true;
      return config;
    }
  };
  const transport:typeof fetch=async()=>{
    requests++;
    return Response.json({data:[{id:'forbidden'}]});
  };
  const result=await discoverNativeAiModelsFromDesktop(flow,async()=>{
    approvals++;
    return true;
  },undefined,transport);
  assert.deepEqual(result,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(approvals,0);
  assert.equal(requests,0);
});
