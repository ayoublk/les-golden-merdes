// Publish source-only changes on the validated full Google runtime, without a Firebase rebuild.
// Intentionally refuses dependency changes: those require a fresh full-image build and validation.
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const project='emestreamhalloween',region='europe-west1';
const registry=`${region}-docker.pkg.dev/${project}/gcf-artifacts/`;
const bases={game:registry+'emestreamhalloween__europe--west1__game_action@sha256:6bb7974cf20acb08c52c0f794be5701e59677b9cb58769952f6dbe47b61b4a10',worker:registry+'emestreamhalloween__europe--west1__process_film_step@sha256:705fb74e97e2cc426788b3b1393a529d0480c959f1138264cefa136869c6b47d'};
if(process.argv.slice(2).some(arg=>arg!=='--apply'&&!/^--resume=artifacts\/releases\/\d+\.json$/.test(arg)))throw Error('Usage: node scripts/deploy-stable-backend.mjs [--apply]');
const apply=process.argv.includes('--apply'),stamp=Date.now(),images=[],steps=[];
const commands=['mkdir -p /workspace/source-game /workspace/source-worker'];
for(const [kind,dir] of [['game','functions'],['worker','image-functions']]){
 for(const file of ['package.json','package-lock.json']){
  const stable=execFileSync('git',['show',`576c1e2:${dir}/${file}`],{encoding:'utf8'});
  if(JSON.stringify(JSON.parse(stable))!==JSON.stringify(JSON.parse(readFileSync(`${dir}/${file}`,'utf8'))))throw Error('Dependencies changed: '+dir+'/'+file);
 }
 const files=readdirSync(dir).filter(file=>/^[a-z-]+\.mjs$/.test(file));
 for(const file of files){const bytes=readFileSync(`${dir}/${file}`);for(let offset=0;offset<bytes.length;offset+=4500)commands.push(`printf %s '${bytes.subarray(offset,offset+4500).toString('base64')}' | base64 -d ${offset?'>>':'>'} /workspace/source-${kind}/${file}`);}
 const dockerfile=`FROM ${bases[kind]}\nCOPY source-${kind}/ /workspace/\nCOPY source-${kind}/ /app/\n`;
 commands.push(`printf %s '${Buffer.from(dockerfile).toString('base64')}' | base64 -d > /workspace/Dockerfile-${kind}`);
 const image=registry+`golden-merdes-${kind}:stable-runtime-${stamp}`;images.push(image);
 steps.push({id:kind,name:'gcr.io/cloud-builders/docker',args:['build','-f',`Dockerfile-${kind}`,'-t',image,'.'],waitFor:['source']});
 console.log(`${kind}: ${files.join(', ')}`);
}
if(!apply){console.log('READ ONLY. Source-only deployment prepared. --apply builds full images and updates the four services.');process.exit(0);}
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project,...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js')),opts=()=>({headers:{'x-goog-user-project':project}});
const build=new Client({urlPrefix:'https://cloudbuild.googleapis.com',apiVersion:'v1'}),run=new Client({urlPrefix:'https://run.googleapis.com',apiVersion:'v2'});
const resumePath=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9);
const resumed=resumePath?JSON.parse(readFileSync(resumePath,'utf8')):null;
const operation=resumed?{metadata:{build:{id:resumed.buildId}}}:(await build.post(`/projects/${project}/locations/${region}/builds`,{steps:[...commands.map((command,index)=>({id:index===commands.length-1?'source':'source-'+index,name:'gcr.io/cloud-builders/docker',entrypoint:'bash',args:['-ec',command]})),...steps],images,timeout:'1200s',serviceAccount:`projects/${project}/serviceAccounts/478334155470-compute@developer.gserviceaccount.com`,options:{logging:'CLOUD_LOGGING_ONLY'}},opts())).body;
const buildId=operation.metadata?.build?.id;if(!buildId)throw Error('Missing build ID');
const artifact=resumePath||`artifacts/releases/${stamp}.json`;mkdirSync('artifacts/releases',{recursive:true});
const release=resumed||{buildId,images,previous:[],deployed:[]};const save=()=>writeFileSync(artifact,JSON.stringify(release,null,2));save();
console.log('Cloud Build:',buildId);
let built;
for(let i=0;i<120;i++){
 built=(await build.get(`/projects/${project}/locations/${region}/builds/${buildId}`,opts())).body;
 if(built.status==='SUCCESS')break;
 if(!['QUEUED','WORKING'].includes(built.status))throw Error('Build failed: '+built.status);
 if(i%3===0)console.log('Building source over validated full runtime…');
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(built.status!=='SUCCESS')throw Error('Build still running; inspect '+artifact);
const fullImages=release.images.map(image=>{const found=built.results?.images?.find(item=>item.name===image);if(!found?.digest)throw Error('Missing digest');return image.slice(0,image.lastIndexOf(':'))+'@'+found.digest;});
release.fullImages=fullImages;save();
const services=[['gameaction','gameAction',fullImages[0],'http'],['processfilmstep','processFilmStep',fullImages[1],'http'],['generatefilm','generateFilm',fullImages[1],'cloudevent'],['recoverfilmqueue','recoverFilmQueue',fullImages[1],'http']];
const pending=[];
for(const [service,target,image,signature] of services){
 const name=`projects/${project}/locations/${region}/services/${service}`,current=(await run.get('/'+name,opts())).body;
 if(current.template?.containers?.length!==1||current.template.containers[0].env?.find(e=>e.name==='FUNCTION_TARGET')?.value!==target)throw Error('Unexpected service: '+service);
 release.previous.push({service,template:current.template,traffic:current.traffic});save();
 const container=current.template.containers[0];
 const template={...current.template,containers:[{...container,image,baseImageUri:'',env:[...(container.env||[]).filter(e=>e.name!=='FUNCTION_SIGNATURE_TYPE'),{name:'FUNCTION_SIGNATURE_TYPE',value:signature}]}]};delete template.revision;
 const op=(await run.patch('/'+name,{name,etag:current.etag,template,traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}]},{...opts(),queryParams:{updateMask:'template,traffic'}})).body;
 pending.push({service,operation:op.name,image});console.log(service+': starting new revision');
}
release.deployed=pending;save();
for(const item of pending){
 let ready=false;
 for(let i=0;i<60;i++){
  const op=(await run.get('/'+item.operation,opts())).body;
  if(op.error)throw Error(item.service+': '+op.error.message);
  if(op.done){if(op.response?.terminalCondition?.state!=='CONDITION_SUCCEEDED')throw Error('Not ready: '+item.service);ready=true;console.log(item.service+': READY');break;}
  if(i%3===0)console.log(item.service+': waiting for startup');
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(!ready)throw Error('Startup deadline: '+item.service);
}
console.log('All four services ready. Validate live API and queue before declaring success. Release record:',artifact);
