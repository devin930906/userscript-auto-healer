/**
 * TASK-009/010/011; TEST-019/020/021/026.
 * An untrusted Proxy must be rejected BEFORE reflection: catching thrown
 * traps after invocation does not undo attacker-controlled side effects.
 * No filesystem, browser, or real userscript is touched by these tests.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  proposeLiteralSelectorPatch,auditProposedLiteralSelectorPatch,
  type LiteralPatchRequest
} from '../../src/repair/patch-planner';
import {assessLocalAcceptancePreflight} from '../../src/acceptance/acceptance-gate';
import {prepareReviewedLocalBackupOnly} from '../../src/acceptance/local-backup-preflight';
import {verifyApprovedSourceFingerprint} from '../../src/version/source-snapshot';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {verifyBackupRecoverySource} from '../../src/version/recovery-source';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {inspectChangedSourceRestorePreflightReadOnly} from
  '../../src/version/changed-source-restore-preflight';

const source=[
  '// ==UserScript==',
  '// @name proxy-reflection-boundary',
  '// @match https://example.com/*',
  '// @grant none',
  '// ==/UserScript==',
  "document.querySelector('#stale');",
  ''
].join('\n');
const request:LiteralPatchRequest={
  source,expectedSourceSha256:createHash('sha256').update(source).digest('hex'),
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#stale',
  replacementSelector:'#fixed',faultEvidenceId:'proxy_boundary_case'
};
const candidate=proposeLiteralSelectorPatch(request);
assert.equal(candidate.status,'CANDIDATE_ONLY');
const originalInput={
  sourcePath:'C:\\Safe\\script.user.js',
  backupDirectory:'C:\\Safe\\backups',
  backupFileName:'script.00000000-0000-4000-8000-000000000000.backup.user.js',
  expectedSha256:request.expectedSourceSha256,
  expectedByteLength:Buffer.byteLength(source),
  expectedCurrentSha256:'f'.repeat(64),
  expectedOriginalSha256:request.expectedSourceSha256,
  expectedOriginalByteLength:Buffer.byteLength(source),
  userApproved:true
};
type Result={status:string;automaticPatchAllowed?:boolean;automaticRollbackAllowed?:boolean};
const endpoints:ReadonlyArray<{
  name:string;invoke:(input:unknown)=>Promise<Result>|Result
}>=[
  {name:'AST patch planner request',invoke:input=>
    proposeLiteralSelectorPatch(input as LiteralPatchRequest)},
  {name:'AST candidate audit',invoke:input=>
    auditProposedLiteralSelectorPatch(request,input)},
  {name:'offline acceptance options',invoke:input=>
    assessLocalAcceptancePreflight(request,candidate,input)},
  {name:'native backup preparation options',invoke:input=>
    prepareReviewedLocalBackupOnly(request,candidate,input)},
  {name:'source fingerprint options',invoke:input=>
    verifyApprovedSourceFingerprint(input)},
  {name:'backup creation options',invoke:input=>
    createVerifiedBackupOnly(input)},
  {name:'backup verification options',invoke:input=>
    verifyBackupRecoverySource(input)},
  {name:'staged candidate options',invoke:input=>
    stageReviewedCandidateOnly(request,candidate,input)},
  {name:'changed-source restore options',invoke:input=>
    inspectChangedSourceRestorePreflightReadOnly(input)}
];

for(const endpoint of endpoints){
  test('TEST-019/020/021/026: '+endpoint.name+
    ' refuses a live Proxy without invoking traps',async()=>{
    let traps=0;
    const target={...originalInput};
    const hostile=new Proxy(target,{
      get(){traps++;throw Error('unsafe get');},
      getPrototypeOf(){traps++;throw Error('unsafe prototype');},
      ownKeys(){traps++;throw Error('unsafe keys');},
      getOwnPropertyDescriptor(){traps++;throw Error('unsafe descriptor');}
    });
    const result=await endpoint.invoke(hostile);
    assert.equal(result.status,'BLOCKED',endpoint.name);
    assert.equal(result.automaticPatchAllowed,false,endpoint.name);
    if('automaticRollbackAllowed' in result)
      assert.equal(result.automaticRollbackAllowed,false,endpoint.name);
    assert.equal(traps,0,endpoint.name+' executed untrusted Proxy traps');
  });

  test('TEST-019/020/021/026: '+endpoint.name+
    ' refuses a revoked Proxy without throwing',async()=>{
    const wrapped=Proxy.revocable({...originalInput},{});
    wrapped.revoke();
    const result=await endpoint.invoke(wrapped.proxy);
    assert.equal(result.status,'BLOCKED',endpoint.name);
    assert.equal(result.automaticPatchAllowed,false,endpoint.name);
    if('automaticRollbackAllowed' in result)
      assert.equal(result.automaticRollbackAllowed,false,endpoint.name);
  });
}

test('TEST-019/026: audit rejects a Proxy nested in candidate.change without traps',()=>{
  assert.equal(candidate.status,'CANDIDATE_ONLY');
  if(candidate.status!=='CANDIDATE_ONLY')return;
  let traps=0;
  const hostileChange=new Proxy({...candidate.change},{
    getPrototypeOf(){traps++;throw Error('nested prototype');},
    ownKeys(){traps++;throw Error('nested ownKeys');}
  });
  const audit=auditProposedLiteralSelectorPatch(request,{
    ...candidate,change:hostileChange
  });
  assert.equal(audit.status,'BLOCKED');
  assert.equal(audit.automaticPatchAllowed,false);
  assert.equal(traps,0,'nested candidate.change Proxy was reflected');
});
