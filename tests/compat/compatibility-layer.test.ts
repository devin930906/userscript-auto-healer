import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {LimitedCompatibilityLayer} from '../../src/compat/compatibility-layer';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const initial = {
  version:'1.0.0',
  consumers:[A,B],
  bindings:[
    {key:'submit', selector:'#old-submit', attempts:2, delayMs:100, observeMutations:true},
    {key:'status', selector:'.status', attempts:1, delayMs:0, observeMutations:false}
  ]
};
const newer = {...initial, version:'1.1.0', bindings:[
  {...initial.bindings[0],selector:'#new-submit'}, initial.bindings[1]
]};
const checks = [{scriptHash:A, passed:true},{scriptHash:B,passed:true}];

test('TEST-025: pin active locator settings while staging a multi-consumer offline preview', () => {
  const layer = new LimitedCompatibilityLayer(initial);
  assert.equal(layer.resolve('submit')?.selector, '#old-submit');
  assert.equal(layer.resolve('missing'), null);
  assert.equal(layer.snapshot().active.version, '1.0.0');
  const result = layer.previewUpgrade(newer, checks);
  assert.equal(result.status, 'OFFLINE_PREVIEW_ONLY');
  assert.equal(result.automaticActivationAllowed, false);
  assert.equal(result.tampermonkeyVerified, false);
  assert.equal(result.businessVerified, false);
  assert.equal(layer.snapshot().preview?.version, '1.1.0');
  assert.equal(layer.resolve('submit')?.selector, '#old-submit');
  assert.equal(layer.snapshot().active.version, '1.0.0');
  assert.ok(Object.isFrozen(layer.snapshot()));
  assert.ok(Object.isFrozen(layer.snapshot().active.bindings));
  assert.throws(() => { (layer.snapshot().active.bindings as unknown as unknown[]).push('bad'); });
  assert.equal(layer.rollbackPreview(), true);
  assert.equal(layer.snapshot().preview, null);
  assert.equal(layer.rollbackPreview(), false);
  assert.equal(layer.resolve('submit')?.selector, '#old-submit');
});

test('TEST-025: one failed or missing consumer check blocks the entire shared upgrade', () => {
  for (const reports of [
    [{scriptHash:A,passed:true}],
    [{scriptHash:A,passed:true},{scriptHash:B,passed:false}],
    [{scriptHash:A,passed:true},{scriptHash:C,passed:true}],
    [{scriptHash:A,passed:true},{scriptHash:A,passed:true}],
    [{scriptHash:A,passed:true},{scriptHash:B,passed:true},{scriptHash:C,passed:true}],
    [{scriptHash:A,passed:true},{scriptHash:B,passed:'true'}],
    [{scriptHash:A,passed:true},{scriptHash:B,passed:true, tampermonkeyVerified:true}]
  ]) {
    const layer = new LimitedCompatibilityLayer(initial);
    const result = layer.previewUpgrade(newer,reports);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticActivationAllowed,false);
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  }
});

test('TEST-025: reject downgrade, version aliases, missing bindings and changed consumer membership', () => {
  for (const invalid of [
    {...newer,version:'1.0.0'},
    {...newer,version:'0.9.9'},
    {...newer,version:'01.1.0'},
    {...newer,version:'1.1.0-beta'},
    {...newer,bindings:[newer.bindings[0]]},
    {...newer,bindings:[...newer.bindings,newer.bindings[0]]},
    {...newer,consumers:[A]},
    {...newer,consumers:[A,B,C]},
    {...newer,bindings:[{...newer.bindings[0],selector:'  #new-submit'},newer.bindings[1]]},
    {...newer,bindings:[{...newer.bindings[0],attempts:999},newer.bindings[1]]},
    {...newer,automaticPatchAllowed:true},
    {...initial,version:'1.1.0'}
  ]) {
    const layer = new LimitedCompatibilityLayer(initial);
    assert.equal(layer.previewUpgrade(invalid, checks).status,'BLOCKED');
    assert.equal(layer.snapshot().preview,null);
  }
});

test('TEST-025: hostile descriptors, arrays and secret fields fail closed without invoking getters', () => {
  let getterHit = false;
  const forged = {...newer};
  Object.defineProperty(forged,'bindings',{get(){getterHit = true;throw Error('private-key');}});
  const forgedCheck = {scriptHash:B};
  Object.defineProperty(forgedCheck,'passed',{get(){getterHit = true;throw Error('private-key');}});
  const layer = new LimitedCompatibilityLayer(initial);
  for (const [candidate,reports] of [
    [forged,checks],
    [newer,[checks[0],forgedCheck]],
    [newer,Object.assign(Object.create({0:checks[0]}),{length:2,1:checks[1]})],
    [newer,[...checks, {scriptHash:C,passed:true}]],
    [newer,[checks[0],{...checks[1],secret:'https://private.example/'}]],
    [{...newer,bindings:[{...newer.bindings[0],selector:'a\nprivate'},newer.bindings[1]]},checks]
  ] as const) {
    const result=layer.previewUpgrade(candidate,reports);
    assert.equal(result.status,'BLOCKED');
    assert.equal(JSON.stringify(result).includes('private-key'),false);
    assert.equal(layer.snapshot().preview,null);
  }
  assert.equal(getterHit,false);
});

test('TEST-025: staged review cannot be mistaken for a Tampermonkey test or write approval', () => {
  const layer=new LimitedCompatibilityLayer(initial);
  const first=layer.previewUpgrade(newer,checks);
  assert.equal(first.status,'OFFLINE_PREVIEW_ONLY');
  assert.equal('verified' in first,false);
  assert.equal('automaticPatchAllowed' in first,false);
  assert.equal(first.automaticActivationAllowed,false);
  assert.equal(layer.previewUpgrade({...newer,version:'1.2.0'},checks).status,'BLOCKED');
  const snapshot=layer.snapshot();
  assert.equal(snapshot.tampermonkeyVerified,false);
  assert.equal(snapshot.businessVerified,false);
  assert.equal(snapshot.automaticActivationAllowed,false);
  assert.equal(snapshot.preview?.bindings[0].selector,'#new-submit');
  assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  assert.throws(() => new LimitedCompatibilityLayer({...initial,consumers:[A,'secret']}));
});
