/** TASK-013: an isolated Node worker for static AST analysis only.
 * Data comes solely from the native importer's bounded, validated byte budget.
 * Do not execute script bytes, access filesystem paths, network or browser.
 */
import {parentPort,workerData} from 'node:worker_threads';
import {previewImportedBatch} from './import-preview';

if(!parentPort||!Array.isArray(workerData))
 throw Error('INVALID_ISOLATED_PREVIEW_REQUEST');

try{
 const results=previewImportedBatch(workerData);
 parentPort.postMessage(results);
}finally{
 // A finite worker cannot remain alive after delivering a bounded report.
 parentPort.close();
}
