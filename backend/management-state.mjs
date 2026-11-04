// Older journals predate an explicit management flag. Preserve bots that were
// already started or held positions, while fresh/copy drafts stay inactive.
export function managementWasEnabled(runtime={}){
 if(typeof runtime.managementEnabled==='boolean')return runtime.managementEnabled;
 return !!(runtime.runEnabled||runtime.quantity>0||runtime.lastEntryAt||runtime.lastEvaluation);
}
