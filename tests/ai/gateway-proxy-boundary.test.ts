import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {OptionalAiGateway} from '../../src/ai/model-gateway';

/** TASK-014 / TEST-015/026: input validation must not invoke Proxy traps. */
function hostileProxy(){
  let traps=0;
  const value=new Proxy({},{
    getPrototypeOf(){traps++;throw Error('UNTRUSTED_PROXY_GET_PROTOTYPE');},
    ownKeys(){traps++;throw Error('UNTRUSTED_PROXY_OWN_KEYS');},
    getOwnPropertyDescriptor(){traps++;throw Error('UNTRUSTED_PROXY_DESCRIPTOR');}
  });
  return {value,trapsCalled:()=>traps};
}
const config={
  baseUrl:'http://127.0.0.1:9555/v1',apiKey:'test-only',
  manualModel:'fixture-model',maxRequests:1,timeoutMs:1000,maxOutputTokens:64
};
const approval={userApproved:true,approvedOrigin:'http://127.0.0.1:9555'};
const evidence={diagnosticCode:'SELECTOR_ASSERTION',
  scenarioHash:'a'.repeat(64),selectorHash:'b'.repeat(64)};

test('TEST-015/026: proxy configuration rejected without invoking any traps',()=>{
  const hostile=hostileProxy();
  assert.throws(()=>new OptionalAiGateway(hostile.value),/INVALID_AI_CONFIGURATION/);
  assert.equal(hostile.trapsCalled(),0);
  const wrapped=new Proxy(config,{});
  assert.throws(()=>new OptionalAiGateway(wrapped),/INVALID_AI_CONFIGURATION/);
  const revoked=Proxy.revocable(config,{});
  revoked.revoke();
  assert.throws(()=>new OptionalAiGateway(revoked.proxy),/INVALID_AI_CONFIGURATION/);
});

test('TEST-015/026: proxy consent and evidence fail closed before any network request',async()=>{
  let requests=0;
  const gateway=new OptionalAiGateway(config,async()=>{
    requests++;
    return Response.json({choices:[{message:{role:'assistant',content:'Untrusted'}}]});
  });
  const consentProxy=hostileProxy();
  assert.equal(gateway.enable(consentProxy.value),false);
  assert.equal(consentProxy.trapsCalled(),0);
  assert.equal(gateway.enable(approval),true);
  assert.deepEqual(await gateway.discoverModels(consentProxy.value),
    {ok:false,code:'NOT_AUTHORIZED',automaticPatchAllowed:false});
  assert.equal(consentProxy.trapsCalled(),0);
  const evidenceProxy=hostileProxy();
  assert.deepEqual(await gateway.suggest(approval,evidenceProxy.value),
    {ok:false,code:'INVALID_EVIDENCE',automaticPatchAllowed:false});
  assert.equal(evidenceProxy.trapsCalled(),0);
  const revoked=Proxy.revocable(evidence,{});
  revoked.revoke();
  assert.deepEqual(await gateway.suggest(approval,revoked.proxy),
    {ok:false,code:'INVALID_EVIDENCE',automaticPatchAllowed:false});
  assert.equal(requests,0,'rejected input must not initiate provider traffic');
  assert.equal(gateway.status().remainingRequests,1);
});
