// Restore the validated 2026-10-23 backend release, not the current working tree.
// Default: read-only inspection. --apply restores these exact images and polls readiness.
import {createRequire} from 'node:module';
import {join} from 'node:path';
const project='emestreamhalloween',region='europe-west1';
const game="europe-west1-docker.pkg.dev/emestreamhalloween/gcf-artifacts/golden-merdes-game@sha256:88268cf52040c06c068a8eea9319445a0ce664f6fe35348278195566eba588fc";
const worker="europe-west1-docker.pkg.dev/emestreamhalloween/gcf-artifacts/golden-merdes-worker@sha256:09205c2b992d28e63f24134be642345fe90bcea3743630c29b715187ea3901a1";
const services=[['gameaction','gameAction',game,'http'],['processfilmstep','processFilmStep',worker,'http'],['generatefilm','generateFilm',worker,'cloudevent'],['recoverfilmqueue','recoverFilmQueue',worker,'http']];
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: node scripts/restore-stable-backend.mjs [--apply]');
if(!process.env.APPDATA)throw Error('This recovery script uses the Firebase CLI installed in Windows APPDATA.');
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project,...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js')),api=new Client({urlPrefix:'https://run.googleapis.com',apiVersion:'v2'});
const opts=()=>({headers:{'x-goog-user-project':project}}),operations=[];
console.log(`Validated release: 2026-10-23 failsafe, Google Node 22.23.2, project ${project}. ${apply?'RESTORE MODE':'READ ONLY'}`);
for(const [service,target,image,signature] of services){
 const name=`projects/${project}/locations/${region}/services/${service}`,current=(await api.get('/'+name,opts())).body;
 if(current.template?.containers?.length!==1||current.template.containers[0].env?.find(e=>e.name==='FUNCTION_TARGET')?.value!==target)throw Error('Unexpected service configuration: '+service);
 const container=current.template.containers[0];
 const stable=container.image===image&&!container.baseImageUri&&container.env?.find(e=>e.name==='FUNCTION_SIGNATURE_TYPE')?.value===signature&&current.traffic?.length===1&&current.traffic[0].type==='TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'&&current.traffic[0].percent===100;
 console.log(`${service}: ${current.terminalCondition?.state||'unknown'}; ${stable?'validated image already configured':'different image or runtime configuration'}`);
 if(!apply||(stable&&current.terminalCondition?.state==='CONDITION_SUCCEEDED'))continue;
 const template={...current.template,containers:[{...container,image,baseImageUri:'',env:[...(container.env||[]).filter(e=>e.name!=='FUNCTION_SIGNATURE_TYPE'),{name:'FUNCTION_SIGNATURE_TYPE',value:signature}]}]};
 delete template.revision;
 const result=await api.patch('/'+name,{name,etag:current.etag,template,traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}]},{...opts(),queryParams:{updateMask:'template,traffic'}});
 operations.push({service,name:result.body.name});console.log(`${service}: recovery requested`);
}
for(const op of operations){
 let done=false;
 for(let i=0;i<60;i++){
  const result=(await api.get('/'+op.name,opts())).body;
  if(result.error)throw Error(`${op.service}: ${result.error.message}`);
  if(result.done){if(result.response?.terminalCondition?.state!=='CONDITION_SUCCEEDED')throw Error('Service not ready: '+op.service);console.log(`${op.service}: READY`);done=true;break;}
  if(i%3===0)console.log(`${op.service}: waiting for startup`);
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(!done)throw Error('Startup deadline reached: '+op.service);
}
if(!apply)console.log('No changes made. Add --apply only to restore the validated backend release; this does not deploy new source code.');
