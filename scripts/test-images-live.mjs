// Explicit paid integration smoke test: generates exactly one poster and three scenes.
// Uses the Firebase CLI's authenticated API client; never accesses the IA secret.
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as game from '../functions/core.mjs';
const require=createRequire(import.meta.url);
const root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project:'emestreamhalloween',...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js'));
const api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base='/projects/emestreamhalloween/databases/(default)/documents';
const code='IA'+randomBytes(2).toString('hex').toUpperCase(),uid='image-test-'+randomUUID(),jobId='image-test-'+randomUUID();
const roomPath=`${base}/rooms/${code}`,subPath=`${roomPath}/submissions/${uid}`,jobPath=`${base}/generationJobs/${jobId}`;
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
const decode=v=>v.stringValue!==undefined?v.stringValue:v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:v.nullValue!==undefined?null:v.arrayValue?(v.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,x])=>[k,decode(x)]));
const doc=v=>encode(v).mapValue;
const read=async path=>decode({mapValue:{fields:(await api.get(path)).body.fields}});
const room=game.newRoom('host-'+uid);game.join(room,uid,'Test IA');room.memberIds=[uid];room.phase='writing';room.startedAt=Date.now();room.players[0].submitted=true;room.players[0].generation='queued';room.players[0].generationAt=Date.now();
const answers=['Un réalisateur fictif de films de série B','Deux acteurs fictifs, une bibliothécaire en imperméable jaune et un jardinier moustachu','Un vendeur de légumes fictif','monstres/zombies','Une courgette géante possédée, yeux orange et petites dents en carton','Une courgette saute hors d’un vieux téléviseur dans une cuisine abandonnée','Un monstre en mousse verte aux coutures visibles et de la fumée de théâtre','La courgette conduit un petit tracteur pendant que le jardinier danse pour l’exorciser','La Nuit des Courgettes Maudites'];
await api.patch(roomPath,doc(room));await api.patch(subPath,doc({imagePlanVersion:3,answers,images:[],revision:1,attempt:1,submittedAt:Date.now()}));await api.patch(jobPath,doc({code,uid,revision:1,attempt:1,status:'queued'}));
console.log(JSON.stringify({testRoom:code,testJob:jobId}));
let last='';let done=false;
for(let i=0;i<120;i++){
 const [r,s,j]=await Promise.all([read(roomPath),read(subPath),read(jobPath)]);const status=`${j.status}: ${s.images.length}/4 images`;
 if(status!==last){console.log(status);last=status;}
 if(j.status==='error')throw Error(`Image generation failed: ${j.errorCode||'unknown'} (HTTP ${j.errorStatus||'unknown'}); job ${jobId}`);
 if(j.status==='done'){
  assert.equal(s.images.length,4);assert.equal(r.players[0].generation,'ready');await mkdir('artifacts/image-test',{recursive:true});
  for(let n=0;n<4;n++){const response=await fetch(s.images[n]);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/png/);const data=Buffer.from(await response.arrayBuffer());assert.equal(data.toString('hex',0,8),'89504e470d0a1a0a');const width=data.readUInt32BE(16),height=data.readUInt32BE(20);assert.ok(n===0?height>width:width>height);await writeFile(`artifacts/image-test/${n===0?'poster':`scene-${n}`}.png`,data);console.log(`Image ${n+1}: ${width}x${height}, download verified`);}
  await api.delete(jobPath);await api.delete(subPath);await api.delete(roomPath);console.log('Test fixture documents removed. Generated test images retained in Storage and artifacts/image-test/.');done=true;break;
 }
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(!done)throw Error('Generation did not finish in the test window; no automatic retry was submitted.');
