import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {importDroppedBytes} from '../../src/import/import-service';
import {previewImportedScriptAnalysis} from '../../src/analyze/import-preview';

const header='// ==UserScript==\n// @name preview-test\n// @match https://example.org/*\n// ==/UserScript==\n';
function imported(code:string){
 const result=importDroppedBytes('preview.user.js',new TextEncoder().encode(code));
 assert.equal('code' in result,false);
 if('code' in result)throw Error(result.code);
 return result;
}

test('TEST-004/011: imports provide read-only selector position counts, not sensitive selector source',()=>{
 const source=header+
   'function run(){document.querySelector("#private-node");'+
   'document.querySelectorAll(dynamicSelector);}\n'+
   'document.getElementById("private-item");\n';
 const analyzed=previewImportedScriptAnalysis(imported(source));
 assert.equal(analyzed.status,'STATIC_ANALYSIS_ONLY');
 assert.equal(analyzed.metadataStatus,'OK');
 assert.equal(analyzed.totalSites,3);
 assert.equal(analyzed.literalSites,2);
 assert.equal(analyzed.runtimeConfirmationSites,1);
 assert.deepEqual(analyzed.sites.map(x=>x.method),
   ['querySelector','querySelectorAll','getElementById']);
 assert.equal(analyzed.automaticPatchAllowed,false);
 assert.equal(analyzed.tampermonkeyVerified,false);
 assert.equal(analyzed.businessVerified,false);
 const data=JSON.stringify(analyzed);
 assert.equal(data.includes('private-node'),false);
 assert.equal(data.includes('private-item'),false);
 assert.equal(data.includes('https://'),false);
});

test('TEST-004: incomplete metadata and invalid JS never produce verified selector evidence',()=>{
 const badMetadata=previewImportedScriptAnalysis(imported('document.querySelector("#secret");'));
 assert.equal(badMetadata.status,'INVALID_METADATA');
 assert.equal(badMetadata.totalSites,0);
 const badSource=previewImportedScriptAnalysis(imported(header+'function broken( {'));
 assert.equal(badSource.status,'PARSE_ERROR');
 assert.equal(badSource.totalSites,0);
 assert.equal(badSource.automaticPatchAllowed,false);
});

test('TEST-011: large imports remain readable but synchronous AST preview is bounded',()=>{
 const large=imported(header+'x'.repeat(256*1024));
 const analyzed=previewImportedScriptAnalysis(large);
 assert.equal(analyzed.status,'SKIPPED_TOO_LARGE');
 assert.equal(analyzed.metadataStatus,'NOT_CHECKED');
 assert.deepEqual(analyzed.sites,[]);
 assert.equal(analyzed.automaticPatchAllowed,false);
});
