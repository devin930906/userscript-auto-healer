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
  assert.equal(snapshot.preview?.bindings.find(binding=>binding.key==='submit')?.selector,'#new-submit');
  assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  assert.throws(() => new LimitedCompatibilityLayer({...initial,consumers:[A,'secret']}));
});


// TASK-016 / TEST-025/026: Object.getPrototypeOf/Reflect.ownKeys and array
// shape reads on a Proxy are executable attacker code, even without getters.
// Reject the proxy itself at every trust boundary before touching any trap.
test('TASK-016/TEST-025/026: compatibility definition and preview reject Proxy traps without execution', () => {
  let trapped=0;
  const hostile=<T extends object>(value:T):T=>new Proxy(value,{
    getPrototypeOf(){trapped++;return Object.getPrototypeOf(value);},
    ownKeys(){trapped++;return Reflect.ownKeys(value);},
    get(_target,key,receiver){trapped++;return Reflect.get(value,key,receiver);}
  });
  for(const invalid of [
    hostile(initial),
    {...initial,consumers:hostile([...initial.consumers])},
    {...initial,bindings:hostile([...initial.bindings])},
    {...initial,bindings:[hostile({...initial.bindings[0]}),initial.bindings[1]]}
  ]){
    assert.throws(()=>new LimitedCompatibilityLayer(invalid),/INVALID_COMPAT/);
    assert.equal(trapped,0,'constructor must not execute untrusted Proxy traps');
  }
  for(const [candidate,reports] of [
    [hostile(newer),checks],
    [{...newer,consumers:hostile([...newer.consumers])},checks],
    [{...newer,bindings:hostile([...newer.bindings])},checks],
    [{...newer,bindings:[hostile({...newer.bindings[0]}),newer.bindings[1]]},checks],
    [newer,hostile([...checks])],
    [newer,[hostile({...checks[0]}),checks[1]]]
  ] as const){
    const layer=new LimitedCompatibilityLayer(initial);
    const decision=layer.previewUpgrade(candidate,reports);
    assert.equal(decision.status,'BLOCKED');
    assert.equal(decision.automaticActivationAllowed,false);
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
    assert.equal(trapped,0,'preview must not execute untrusted Proxy traps');
  }
  const revoked=Proxy.revocable([...checks],{});
  revoked.revoke();
  const layer=new LimitedCompatibilityLayer(initial);
  assert.equal(layer.previewUpgrade(newer,revoked.proxy).status,'BLOCKED');
  assert.equal(layer.snapshot().preview,null);
  assert.equal(trapped,0);
});

test('TASK-016/TEST-025/026: bidi formatting cannot disguise a shared selector in offline preview',()=>{
  const disguised=['#target\\u202ejs','[data-name="ok\\u2066x"]',
    '.status\\u2028hidden'].map(s=>s.replace(/\\u([0-9a-f]{4})/gi,
      (_full,hex:string)=>String.fromCharCode(parseInt(hex,16))));
  for(const selector of disguised){
    const candidate={...newer,bindings:[
      {...newer.bindings[0],selector},newer.bindings[1]]};
    assert.throws(()=>new LimitedCompatibilityLayer({
      ...initial,bindings:[{...initial.bindings[0],selector},initial.bindings[1]]
    }),/INVALID_COMPAT_BINDING/,
    'directional or line-format controls cannot become active locators');
    const layer=new LimitedCompatibilityLayer(initial);
    const result=layer.previewUpgrade(candidate,checks);
    assert.equal(result.status,'BLOCKED');
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  }
});


test('TASK-016/TEST-025/026: zero-width formatting is rejected in shared locator review',()=>{
  const invisible=['\u200b','\u200c','\u200d','\u2060','\ufeff'];
  for(const mark of invisible){
    const selector='#submit'+mark;
    assert.throws(()=>new LimitedCompatibilityLayer({...initial,bindings:[
      {...initial.bindings[0],selector},initial.bindings[1]
    ]}),/INVALID_COMPAT_BINDING/);
    const layer=new LimitedCompatibilityLayer(initial);
    assert.equal(layer.previewUpgrade({...newer,bindings:[
      {...newer.bindings[0],selector},newer.bindings[1]
    ]},checks).status,'BLOCKED');
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  }
});


test('TASK-016/TEST-025/026: Arabic and left/right direction marks cannot disguise shared selectors',()=>{
  // U+061C ARABIC LETTER MARK and U+200E/U+200F LRM/RLM are
  // bidirectional formatting controls, not visible selector characters.
  // They must not enter active mappings or a future offline preview.
  const marks=['\u061c','\u200e','\u200f'];
  for(const mark of marks){
    const disguised='#new-submit'+mark;
    const active={...initial,bindings:[
      {...initial.bindings[0],selector:disguised},initial.bindings[1]
    ]};
    assert.throws(()=>new LimitedCompatibilityLayer(active),/INVALID_COMPAT_BINDING/,
      'an invisible direction mark cannot be included in active selector metadata');
    const layer=new LimitedCompatibilityLayer(initial);
    const rejected=layer.previewUpgrade({...newer,bindings:[
      {...newer.bindings[0],selector:disguised},newer.bindings[1]
    ]},checks);
    assert.equal(rejected.status,'BLOCKED',
      'a direction-controlled shared selector must not enter offline preview');
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit',
      'all current shared-script mappings must remain pinned');
  }
});


test('TASK-016/TEST-025/026: other invisible format marks cannot enter shared selector metadata',()=>{
  // Soft hyphen, combining grapheme joiner, Mongolian vowel separator and
  // invisible mathematical operators can hide selector differences in review.
  for(const mark of ['\u00ad','\u034f','\u180e','\u2061','\u2062','\u2063','\u2064','\u2065']){
    const selector='#new-submit'+mark;
    assert.throws(()=>new LimitedCompatibilityLayer({...initial,bindings:[
      {...initial.bindings[0],selector},initial.bindings[1]
    ]}),/INVALID_COMPAT_BINDING/);
    const layer=new LimitedCompatibilityLayer(initial);
    const result=layer.previewUpgrade({...newer,bindings:[
      {...newer.bindings[0],selector},newer.bindings[1]
    ]},checks);
    assert.equal(result.status,'BLOCKED');
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  }
});


test('TASK-016/TEST-025/026: C1 and deprecated bidi controls cannot mask shared selector edits',()=>{
  // C1 (U+0080..009F) and deprecated directional controls (U+206A..206F)
  // must be rejected in both active metadata and proposed offline upgrades.
  // No claim about real Tampermonkey, GM APIs or business recovery is made.
  const marks=['\u0080','\u0085','\u009b','\u009f',
    '\u206a','\u206b','\u206c','\u206d','\u206e','\u206f'];
  for(const mark of marks){
    const selector='#new-submit'+mark;
    assert.throws(()=>new LimitedCompatibilityLayer({...initial,bindings:[
      {...initial.bindings[0],selector},initial.bindings[1]
    ]}),/INVALID_COMPAT_BINDING/);
    const layer=new LimitedCompatibilityLayer(initial);
    assert.equal(layer.previewUpgrade({...newer,bindings:[
      {...newer.bindings[0],selector},newer.bindings[1]
    ]},checks).status,'BLOCKED');
    assert.equal(layer.snapshot().preview,null);
    assert.equal(layer.snapshot().active.version,'1.0.0');
    assert.equal(layer.resolve('submit')?.selector,'#old-submit');
  }
});

test('TASK-016/TEST-025/026: compatibility copy never invokes mutable Array.prototype.push',()=>{
 const original=Array.prototype.push;
 let intercepted=0;
 let layer:LimitedCompatibilityLayer|undefined;
 let preview:ReturnType<LimitedCompatibilityLayer['previewUpgrade']>|undefined;
 try{
  Array.prototype.push=function(){
   intercepted++;
   throw Error('UNTRUSTED_ARRAY_PUSH_CALLED');
  };
  layer=new LimitedCompatibilityLayer(initial);
  preview=layer.previewUpgrade(newer,checks);
 }finally{
  Array.prototype.push=original;
 }
 assert.equal(intercepted,0,'untrusted array cloning cannot call Array.prototype.push');
 assert.ok(layer);
 assert.equal(preview?.status,'OFFLINE_PREVIEW_ONLY');
 assert.equal(layer.resolve('submit')?.selector,'#old-submit');
 assert.equal(layer.snapshot().automaticActivationAllowed,false);
});

test('TASK-016/TEST-025/026: compatibility copy defines own array slots without inherited index setters',()=>{
 const previous=Object.getOwnPropertyDescriptor(Array.prototype,'0');
 let intercepted=0;
 let layer:LimitedCompatibilityLayer|undefined;
 let preview:ReturnType<LimitedCompatibilityLayer['previewUpgrade']>|undefined;
 try{
  Object.defineProperty(Array.prototype,'0',{
   configurable:true,
   set(){intercepted++;throw Error('UNTRUSTED_ARRAY_INDEX_SETTER_CALLED');}
  });
  layer=new LimitedCompatibilityLayer(initial);
  preview=layer.previewUpgrade(newer,checks);
 }finally{
  if(previous)Object.defineProperty(Array.prototype,'0',previous);
  else Reflect.deleteProperty(Array.prototype,'0');
 }
 assert.equal(intercepted,0,'compatibility cloning must never call an inherited numeric setter');
 assert.ok(layer);
 assert.equal(preview?.status,'OFFLINE_PREVIEW_ONLY');
 assert.equal(layer.resolve('status')?.selector,'.status');
 assert.equal(layer.snapshot().automaticActivationAllowed,false);
});
