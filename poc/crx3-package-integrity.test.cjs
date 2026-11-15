'use strict';
/** TASK-007 / TEST-017/026: CRX3 proofs must bind ZIP bytes to the key ID. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync,createHash,sign,constants}=require('node:crypto');
const {verifyCrx3PackageIntegrity,writeVerifiedCrx3Outputs}=require('./crx3-package-integrity.cjs');
const {spawnSync}=require('node:child_process');
const {readFileSync,mkdtempSync,writeFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
function varint(n){
 const b=[];do{let byte=n%128;n=Math.floor(n/128);if(n)byte|=128;b.push(byte);}while(n);
 return Buffer.from(b);
}
function field(id,b){return Buffer.concat([varint(id*8+2),varint(b.length),b]);}
function fixture(){
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const publicDer=publicKey.export({type:'spki',format:'der'});
 const crxId=createHash('sha256').update(publicDer).digest().subarray(0,16);
 const signed=field(1,crxId);
 // Header signature is over exact bytes, including the ZIP. This tiny
 // ZIP magic fixture is intentionally not extracted by the production
 // Windows archive boundary checks (which independently validate entries).
 const zip=Buffer.from('504b030400000000000000000000','hex');
 const size=Buffer.alloc(4);size.writeUInt32LE(signed.length);
 const message=Buffer.concat([Buffer.from('CRX3 SignedData\0'),size,signed,zip]);
 const signature=sign('sha256',message,{
  key:privateKey,padding:constants.RSA_PKCS1_PADDING
 });
 const proof=Buffer.concat([field(1,publicDer),field(2,signature)]);
 const header=Buffer.concat([field(2,proof),field(10000,signed)]);
 const prefix=Buffer.alloc(12);
 prefix.write('Cr24');prefix.writeUInt32LE(3,4);prefix.writeUInt32LE(header.length,8);
 let id='';
 for(const b of crxId)id+=String.fromCharCode(97+(b>>4),97+(b&15));
 return {bytes:Buffer.concat([prefix,header,zip]),zip,id,publicDer};
}
test('TEST-017: a signed CRX3 developer proof authenticates its exact ZIP and key-derived ID',()=>{
 const {bytes,zip,id,publicDer}=fixture();
 const checked=verifyCrx3PackageIntegrity(bytes,id);
 assert.equal(checked.extensionId,id);
 assert.equal(checked.publicKeyBase64,publicDer.toString('base64'),
  'verified signing key must be exposed only after the key ID and signatures pass');
 assert.equal(checked.algorithm,'RSA-PKCS1-SHA256');
 assert.deepEqual(checked.zip,zip);
 bytes[bytes.length-1]^=1;
 assert.deepEqual(checked.zip,zip,
  'returned ZIP must not change when caller mutates its CRX3 input');
});

test('TASK-007/TEST-017/026: verified CRX3 output helper writes the signing key for an ID-pinned unpacked runtime',()=>{
 const {bytes,id,publicDer}=fixture();
 const root=mkdtempSync(join(tmpdir(),'uah-crx3-key-output-'));
 try{
  const zip=join(root,'verified.zip');
  const key=join(root,'verified-public-key.b64');
  const checked=writeVerifiedCrx3Outputs(bytes,id,zip,key);
  assert.equal(checked.extensionId,id);
  assert.equal(existsSync(zip),true);
  assert.equal(readFileSync(key,'utf8'),publicDer.toString('base64'));
  const conflictZip=join(root,'must-not-remain.zip');
  const conflictKey=join(root,'existing-key.b64');
  writeFileSync(conflictKey,'preserve-existing-key');
  assert.throws(()=>writeVerifiedCrx3Outputs(bytes,id,conflictZip,conflictKey));
  assert.equal(existsSync(conflictZip),false,'failed paired output must remove only its newly created ZIP');
  assert.equal(readFileSync(conflictKey,'utf8'),'preserve-existing-key',
   'an existing public-key output must never be overwritten');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('TEST-017/026: content replacement and forged store identity never pass',()=>{
 const {bytes,id}=fixture();
 const forgedZip=Buffer.from(bytes);
 forgedZip[forgedZip.length-1]^=1;
 assert.throws(()=>verifyCrx3PackageIntegrity(forgedZip,id),
  /CRX3_SIGNATURE_OR_FORMAT_INVALID/);
 assert.throws(()=>verifyCrx3PackageIntegrity(bytes,'a'.repeat(32)),
  /CRX3_SIGNATURE_OR_FORMAT_INVALID/);
 assert.deepEqual(verifyCrx3PackageIntegrity(bytes).extensionId,id);
});
test('TEST-017/026: forged proof, malformed protobuf and archive offsets fail closed',()=>{
 const {bytes}=fixture();
 const cases=[];
 const wrongMagic=Buffer.from(bytes);wrongMagic.write('ZZZZ');cases.push(wrongMagic);
 const wrongVersion=Buffer.from(bytes);wrongVersion.writeUInt32LE(2,4);cases.push(wrongVersion);
 const truncated=bytes.subarray(0,15);cases.push(truncated);
 const hugeHeader=Buffer.from(bytes);hugeHeader.writeUInt32LE(1048577,8);cases.push(hugeHeader);
 const wrongHeader=Buffer.from(bytes);
 wrongHeader[12]=0xff;cases.push(wrongHeader);
 const wrongZip=Buffer.from(bytes);
 wrongZip[wrongZip.readUInt32LE(8)+12]=0;cases.push(wrongZip);
 const badProof=Buffer.from(bytes);
 badProof[badProof.readUInt32LE(8)+11]^=1;cases.push(badProof);
 for(const input of cases)
  assert.throws(()=>verifyCrx3PackageIntegrity(input),
   /CRX3_SIGNATURE_OR_FORMAT_INVALID/);
 assert.throws(()=>verifyCrx3PackageIntegrity({}),/CRX3_SIGNATURE_OR_FORMAT_INVALID/);
 assert.throws(()=>verifyCrx3PackageIntegrity(Buffer.alloc(16_000_000)),
  /CRX3_SIGNATURE_OR_FORMAT_INVALID/);
});

// Negative regression: a self-signed CRX from an unrelated developer is a
// cryptographically correct CRX3. The Tampermonkey-specific command MUST
// reject it before writing any ZIP, even though generic proof validation
// (correctly) accepts the key-derived ID. This also tests the real CLI used
// by the Windows experiment, not just an optional verifier argument.
test('TASK-007/TEST-017/026: Tampermonkey CLI rejects a foreign signed CRX without extracting ZIP',()=>{
 const {bytes,id}=fixture();
 assert.notEqual(id,'dhdgffkkebhmkfjojejmpbldmpobfkfo');
 assert.equal(verifyCrx3PackageIntegrity(bytes,id).extensionId,id);
 const root=mkdtempSync(join(tmpdir(),'uah-crx3-foreign-key-'));
 try{
  const crx=join(root,'foreign.crx');
  const zip=join(root,'must-not-exist.zip');
  const key=join(root,'must-not-exist-key.b64');
  writeFileSync(crx,bytes);
  const attempt=spawnSync(process.execPath,[require.resolve('./crx3-package-integrity.cjs'),crx,zip,key],{
   encoding:'utf8',timeout:10000,windowsHide:true
  });
  assert.equal(attempt.status,1,'foreign developer-signed CRX must not load');
  assert.equal(existsSync(zip),false,'foreign package must not create a ZIP');
  assert.equal(existsSync(key),false,'foreign package must not publish a signing key');
 }finally{rmSync(root,{recursive:true,force:true});}
});
