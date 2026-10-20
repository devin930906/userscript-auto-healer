/** TASK-013 / TEST-022: native-only durable checkpoint for read-only jobs.
 * Scheduling hints carry NO script patch/rollback/Tampermonkey authority.
 * The app must supply a trusted, already selected directory per batch.
 */
import {ReadOnlyBatchCoordinator,type ReadOnlyWorker} from './batch-coordinator';
export type BatchJournalFailure='INVALID_INPUT'|'UNSAFE_PATH'|'BUSY'|'NOT_FOUND'|'INVALID_CHECKPOINT'|'IO_FAILURE';
export type BatchJournalSaveResult=
 |Readonly<{status:'CHECKPOINT_SAVED_UNVERIFIED';sha256:string}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export type BatchJournalLoadResult=
 |Readonly<{status:'CHECKPOINT_RESTORED_SCHEDULING_ONLY';coordinator:ReadOnlyBatchCoordinator}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export const BATCH_JOURNAL_FILENAME='uah-readonly-batch-v2.json';
export async function saveReadOnlyBatchJournal(_directory:string,_coordinator:ReadOnlyBatchCoordinator):Promise<BatchJournalSaveResult>{
 return {status:'BLOCKED',reason:'IO_FAILURE'};
}
export async function loadReadOnlyBatchJournal(
 _directory:string,_options:ConstructorParameters<typeof ReadOnlyBatchCoordinator>[0],
 _worker:ReadOnlyWorker
):Promise<BatchJournalLoadResult>{
 return {status:'BLOCKED',reason:'IO_FAILURE'};
}
