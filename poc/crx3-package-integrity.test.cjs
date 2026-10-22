'use strict';
/** TASK-007 / TEST-017/026: CRX3 proofs must bind ZIP bytes to the key ID. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync,createHash,sign,constants}=require('node:crypto');
const {verifyCrx3PackageIntegrity}=require('./crx3-package-integrity.cjs');
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
 return {bytes:Buffer.concat([prefix,header,zip]),zip,id};
}
test('TEST-017: a signed CRX3 developer proof authenticates its exact ZIP and key-derived ID',()=>{
 const {bytes,zip,id}=fixture();
 const checked=verifyCrx3PackageIntegrity(bytes,id);
 assert.equal(checked.extensionId,id);
 assert.equal(checked.algorithm,'RSA-PKCS1-SHA256');
 assert.deepEqual(checked.zip,zip);
 bytes[bytes.length-1]^=1;
 assert.deepEqual(checked.zip,zip,
  'returned ZIP must not change when caller mutates its CRX3 input');
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
