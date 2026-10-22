'use strict';
/**
 * TASK-007 / TEST-017/026: authenticate the CRX3 developer proof over the
 * exact downloaded ZIP bytes BEFORE extracting or loading an extension.
 * The bound key ID proves content integrity for a signing key, NOT Chrome
 * Web Store provenance, vendor ownership, installed extension identity,
 * user consent, or actual Tampermonkey/GM/business success.
 *
 * Wire format: Chromium components/crx_file/crx3.proto (CRX3).
 * No third-party dependencies. Only the isolated CI vendor download uses
 * this parser; it never sees the user's Chrome profile or scripts.
 */
const {createHash,createPublicKey,verify,constants}=require('node:crypto');
const {readFileSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const MAX_CRX_BYTES=15_000_000;
const MAX_HEADER_BYTES=1_048_576;
const DOMAIN=Buffer.from('CRX3 SignedData\0','utf8');

function fail(){throw Error('CRX3_SIGNATURE_OR_FORMAT_INVALID');}

function wireFields(bytes){
 const fields=[];
 let pos=0;
 function varint(){
  let value=0n;
  for(let i=0;i<10;i++){
   if(pos>=bytes.length)fail();
   const octet=bytes[pos++];
   value|=BigInt(octet&0x7f)<<BigInt(i*7);
   if((octet&0x80)===0){
    if(value>BigInt(Number.MAX_SAFE_INTEGER))fail();
    return Number(value);
   }
  }
  fail();
 }
 while(pos<bytes.length){
  const tag=varint(),number=Math.floor(tag/8),kind=tag%8;
  if(number<1||number>536870911)fail();
  if(kind===2){
   const length=varint();
   if(length>bytes.length-pos)fail();
   fields.push({number,kind,value:bytes.subarray(pos,pos+length)});
   pos+=length;
  }else if(kind===0){
   varint();
   fields.push({number,kind,value:null});
  }else if(kind===1||kind===5){
   const length=kind===1?8:4;
   if(bytes.length-pos<length)fail();
   pos+=length;
   fields.push({number,kind,value:null});
  }else fail();
  if(fields.length>4096)fail();
 }
 return fields;
}
function oneBytes(fields,number){
 const found=fields.filter(f=>f.number===number);
 if(found.length!==1||found[0].kind!==2)fail();
 return found[0].value;
}
function extensionId(bytes){
 if(bytes.length!==16)fail();
 let id='';
 for(const b of bytes)id+=String.fromCharCode(97+(b>>4),97+(b&15));
 return id;
}
/** Reject unverifiable, malformed and modified CRX3 data; return only
 * already-signature-checked ZIP bytes. Optional expected ID is a key
 * binding, NOT independent proof of vendor/store identity.
 */
function verifyCrx3PackageIntegrity(input,expectedId){
 if(!Buffer.isBuffer(input)||input.length<64||input.length>MAX_CRX_BYTES)
  fail();
 if(input.toString('ascii',0,4)!=='Cr24'||input.readUInt32LE(4)!==3)
  fail();
 const headerSize=input.readUInt32LE(8);
 const zipOffset=12+headerSize;
 if(headerSize<16||headerSize>MAX_HEADER_BYTES||
    zipOffset+4>=input.length)fail();
 const zip=input.subarray(zipOffset);
 if(zip[0]!==0x50||zip[1]!==0x4b||zip[2]!==3||zip[3]!==4)fail();
 const header=wireFields(input.subarray(12,zipOffset));
 const signed=oneBytes(header,10000);
 if(signed.length<3||signed.length>MAX_HEADER_BYTES)fail();
 const idBytes=oneBytes(wireFields(signed),1);
 const id=extensionId(idBytes);
 if(expectedId!==undefined&&
    (typeof expectedId!=='string'||!/^[a-p]{32}$/.test(expectedId)||
     id!==expectedId))fail();
 const signedSize=Buffer.alloc(4);
 signedSize.writeUInt32LE(signed.length);
 const message=Buffer.concat([DOMAIN,signedSize,signed,zip]);
 let algorithm=null,matchedKeyId=0,parsedKeys=0,validSignatures=0;
 const proofs=header.filter(x=>x.number===2||x.number===3);
 for(const proof of proofs){
  if(proof.kind!==2)fail();
  const values=wireFields(proof.value);
  const keyBytes=oneBytes(values,1),signature=oneBytes(values,2);
  if(keyBytes.length<60||keyBytes.length>8192||
     signature.length<32||signature.length>8192)continue;
  if(!createHash('sha256').update(keyBytes).digest().subarray(0,16).equals(idBytes))
   continue;
  matchedKeyId++;
  try{
   const key=createPublicKey({key:keyBytes,format:'der',type:'spki'});
   parsedKeys++;
   if(proof.number===2&&key.asymmetricKeyType==='rsa'&&
      verify('sha256',message,{
        key,padding:constants.RSA_PKCS1_PSS_PADDING,
        saltLength:constants.RSA_PSS_SALTLEN_DIGEST
      },signature)){algorithm='RSA-PSS-SHA256';validSignatures++;break;}
   if(proof.number===3&&key.asymmetricKeyType==='ec'&&
      key.asymmetricKeyDetails?.namedCurve==='prime256v1'&&
      verify('sha256',message,key,signature)){
     algorithm='ECDSA-P256-SHA256';validSignatures++;break;
   }
  }catch{/* An invalid proof must not authorize a package. */}
 }
 if(!algorithm)throw Error('CRX3_SIGNATURE_OR_FORMAT_INVALID '+
  'proofs='+proofs.length+' matchedKeyId='+matchedKeyId+
  ' parsedKeys='+parsedKeys+' validSignatures='+validSignatures);
 return Object.freeze({extensionId:id,algorithm,zip:Buffer.from(zip)});
}
if(require.main===module){
 try{
  if(process.argv.length!==4)fail();
  const [crxPath,zipPath]=process.argv.slice(2);
  const verified=verifyCrx3PackageIntegrity(readFileSync(resolve(crxPath)));
  // Exclusive creation prevents an invalid package from overwriting an
  // existing extracted archive or silently continuing with stale bytes.
  writeFileSync(resolve(zipPath),verified.zip,{flag:'wx'});
  process.stdout.write('CRX3 signed ZIP verified; algorithm='+verified.algorithm+
    '; developerKeyId='+verified.extensionId+
    '; storeAuthenticityVerified=false\n');
 }catch(e){
  const reason=String(e?.message||'UNKNOWN').replace(/[^a-zA-Z0-9 _=-]/g,'').slice(0,180);
  process.stderr.write('CRX3 signature/bounds validation failed; package NOT loaded: '+reason+'\n');
  process.exitCode=1;
 }
}
module.exports={verifyCrx3PackageIntegrity};
