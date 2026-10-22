import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {LimitedHealthRegistry} from '../../src/health/health-registry';

const A = 'a'.repeat(64), B = 'b'.repeat(64), E = 'e'.repeat(64);
const hit = (scriptHash = A) =>
  ({scriptHash, kind:'LIMITED_DOM_OBSERVATION', evidenceHash:E});
const unknown = (scriptHash = A) =>
  ({scriptHash, kind:'INSUFFICIENT_EVIDENCE', evidenceHash:null});

test('TEST-024: untested to limited DOM and then unknown; no verified authority', () => {
  let clock = 1000;
  const registry = new LimitedHealthRegistry(() => clock);
  assert.equal(registry.snapshot(A).status, 'UNTESTED');
  const first = registry.record(hit());
  assert.equal(first.status, 'ELEMENT_FOUND_ONLY');
  assert.equal(first.history[0].observedAtMs, 1000);
  assert.equal(first.tampermonkeyVerified, false);
  assert.equal(first.businessVerified, false);
  assert.equal(first.automaticPatchAllowed, false);
  assert.equal(first.automaticRollbackAllowed, false);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.history));
  assert.ok(Object.isFrozen(first.history[0]));
  clock = 1001;
  const recent = registry.record(unknown());
  assert.equal(recent.status, 'INDETERMINATE');
  assert.deepEqual(recent.history.map(e => e.status),
    ['ELEMENT_FOUND_ONLY', 'INDETERMINATE']);
  assert.equal(JSON.stringify(recent).includes('RECOVERED_VERIFIED'), false);
});

test('TEST-024: aged evidence and clock rollback cannot inherit an old success', () => {
  let time = 5000;
  const registry = new LimitedHealthRegistry(() => time);
  registry.record(hit());
  time += 600001;
  const aged = registry.snapshot(A);
  assert.equal(aged.status, 'INDETERMINATE');
  assert.equal(aged.history[0].status, 'ELEMENT_FOUND_ONLY');
  time = 4999;
  assert.equal(registry.snapshot(A).status, 'INDETERMINATE');
  assert.throws(() => registry.record(hit()), /HEALTH_CLOCK_ROLLBACK/);
  assert.equal(registry.snapshot(A).history.length, 1);
});

test('TEST-024: independent histories, bounded retention and no raw user content', () => {
  let time = 10;
  const registry = new LimitedHealthRegistry(() => ++time);
  for (let i = 0; i < 36; i++) registry.record(i % 2 ? unknown() : hit());
  const first = registry.snapshot(A);
  assert.equal(first.history.length, 32);
  assert.equal(first.history[0].observedAtMs, 15);
  assert.equal(first.history[31].observedAtMs, 46);
  assert.equal(registry.snapshot(B).status, 'UNTESTED');
  registry.record(unknown(B));
  assert.equal(registry.snapshot(A).history.length, 32);
  assert.equal(registry.snapshot(B).history.length, 1);
  assert.equal(JSON.stringify(first).includes('http'), false);
});

test('TEST-024: reject malicious accessors, forbidden verified claims and malformed IDs', () => {
  const registry = new LimitedHealthRegistry(() => 15);
  let invoked = false;
  const malicious = {scriptHash:A, kind:'LIMITED_DOM_OBSERVATION'};
  Object.defineProperty(malicious,'evidenceHash',{enumerable:true,get(){
    invoked = true; throw Error('SHOULD_NOT_RUN');
  }});
  assert.throws(() => registry.record(malicious), /INVALID_HEALTH_OBSERVATION/);
  assert.equal(invoked, false);
  for (const data of [
    {...hit(), status:'RECOVERED_VERIFIED'},
    {...hit(), businessVerified:true},
    {...hit(), extra:'https://private.invalid'},
    {...hit(), evidenceHash:null},
    {...unknown(), evidenceHash:E},
    {...hit(), scriptHash:'../../private.user.js'},
    {...hit(), kind:'RECOVERED_VERIFIED'},
    {...hit(), evidenceHash:'not-a-digest'},
    Object.assign(Object.create({scriptHash:A}), hit())
  ]) assert.throws(() => registry.record(data));
  const withSymbol = {...hit(), [Symbol('secret')]:true};
  assert.throws(() => registry.record(withSymbol));
  assert.equal(registry.snapshot(A).status, 'UNTESTED');
});

test('TEST-024: reject invalid time, do not mutate historical events', () => {
  const registry = new LimitedHealthRegistry(() => NaN);
  assert.throws(() => registry.record(hit()), /INVALID_HEALTH_CLOCK/);
  assert.throws(() => registry.snapshot(A), /INVALID_HEALTH_CLOCK/);
  const limited = new LimitedHealthRegistry(() => 42);
  const one = limited.record(hit());
  assert.throws(() => { (one.history as unknown as unknown[]).push('fake'); });
  assert.equal(limited.snapshot(A).history.length, 1);
});

test('TEST-024/NFR-002: hostile Proxy errors never escape the health input boundary', () => {
  const registry = new LimitedHealthRegistry(() => 15);
  const secret = 'PRIVATE_HEALTH_PROXY_ERROR_MUST_NOT_ESCAPE';
  const observation = unknown();
  const hostile = [
    new Proxy(observation, {getPrototypeOf() {throw Error(secret);}}),
    new Proxy(observation, {ownKeys() {throw Error(secret);}}),
    new Proxy(observation, {getOwnPropertyDescriptor() {throw Error(secret);}})
  ];
  for (const input of hostile) {
    assert.throws(() => registry.record(input), (error: unknown) =>
      error instanceof Error && error.message === 'INVALID_HEALTH_OBSERVATION');
  }
  assert.equal(registry.snapshot(A).status, 'UNTESTED');
});

test('TEST-024/026: reject live and revoked Proxy observations before any reflection', () => {
  const registry = new LimitedHealthRegistry(() => 15);
  let traps = 0;
  const observation = unknown();
  const hostile = new Proxy(observation, {
    getPrototypeOf() { traps++; throw Error('PRIVATE_REFLECTION_TRAP'); },
    ownKeys() { traps++; throw Error('PRIVATE_REFLECTION_TRAP'); },
    getOwnPropertyDescriptor() { traps++; throw Error('PRIVATE_REFLECTION_TRAP'); }
  });
  assert.throws(() => registry.record(hostile), /INVALID_HEALTH_OBSERVATION/);
  assert.equal(traps, 0, 'reject live Proxy before running reflection traps');
  const revocable = Proxy.revocable(observation, {
    getPrototypeOf() { traps++; throw Error('PRIVATE_REVOKED_REFLECTION'); }
  });
  revocable.revoke();
  assert.throws(() => registry.record(revocable.proxy),
    /INVALID_HEALTH_OBSERVATION/);
  assert.equal(traps, 0);
  assert.equal(registry.snapshot(A).status, 'UNTESTED');
});
