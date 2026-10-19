/**
 * TASK-007/017 / TEST-017/022/026: a single owned Chrome browser may have
 * only one in-flight, explicitly consented fixture or scenario CDP journey.
 * A reservation begins BEFORE the asynchronous native consent dialog and
 * lasts through CDP verification; checking only each flow's private busy
 * boolean would allow a different flow to start concurrently.
 *
 * This is an in-memory scheduling guard, NOT a Chrome ownership claim,
 * extension authentication, script execution grant or user consent.
 */
export function createExclusiveOwnedDiagnosticGate(){
 let active:symbol|null=null;
 return Object.freeze({
  reserve():symbol|null{
   if(active!==null)return null;
   const lease=Symbol('owned-browser-diagnostic');
   active=lease;
   return lease;
  },
  release(lease:symbol):void{
   // A stale completion or unrelated caller must not unlock a newer owner.
   if(active===lease)active=null;
  },
  busy():boolean{return active!==null;}
 });
}
