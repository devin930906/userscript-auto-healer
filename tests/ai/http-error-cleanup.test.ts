import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {OptionalAiGateway} from '../../src/ai/model-gateway';

/** TASK-014 / TEST-016/026: error bodies must not pin native connections. */
test('rejected AI HTTP responses release streams without waiting for cancellation',async()=>{
  for(const status of [404,405,429,503]){
    let cancelCalls=0;
    const body=new ReadableStream<Uint8Array>({
      cancel(){cancelCalls++;return new Promise<void>(()=>{});}
    });
    const gateway=new OptionalAiGateway({
      baseUrl:'http://127.0.0.1:9556/v1',apiKey:'fixture-only',
      manualModel:'fixture-model',maxRequests:1,timeoutMs:500,maxOutputTokens:32
    },async()=>new Response(body,{status}));
    const consent={userApproved:true as const,approvedOrigin:'http://127.0.0.1:9556'};
    assert.equal(gateway.enable(consent),true);
    const outcome=await Promise.race([
      gateway.discoverModels(consent),
      new Promise<'ERROR_BODY_STALLED'>(resolve=>setTimeout(()=>resolve('ERROR_BODY_STALLED'),1000))
    ]);
    assert.notEqual(outcome,'ERROR_BODY_STALLED',`HTTP ${status}: response handling stalled`);
    if(status===404||status===405){
      assert.deepEqual(outcome,{
        ok:true,status:'MANUAL_MODEL_FALLBACK',models:[],
        manualModelAvailable:true,automaticPatchAllowed:false
      });
    }else{
      assert.deepEqual(outcome,{ok:false,code:'HTTP_REJECTED',automaticPatchAllowed:false});
    }
    assert.equal(cancelCalls,1,`HTTP ${status}: rejected stream must be cancelled`);
    assert.equal(gateway.status().remainingRequests,0);
  }
});
