// Infrastructure smoke test: a stopped fixture exercises dispatch and worker without any paid API call.
// Uses the Firebase CLI's authenticated API client; never accesses the IA secret.
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import * as game from '../functions/core.mjs';
const require=createRequire(import.meta.url);
const root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project:'emestreamhalloween',...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js'));
const api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base='/projects/emestreamhalloween/databases/(default)/documents';
const code='QU'+randomBytes(2).toString('hex').toUpperCase(),uid='queue-test-'+randomUUID(),jobId='queue-test-'+randomUUID();
const roomPath=`${base}/rooms/${code}`,subPath=`${roomPath}/submissions/${uid}`,jobPath=`${base}/generationJobs/${jobId}`;
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
const decode=v=>v.stringValue!==undefined?v.stringValue:v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:v.nullValue!==undefined?null:v.arrayValue?(v.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,x])=>[k,decode(x)]));
const doc=v=>encode(v).mapValue;
const read=async path=>decode({mapValue:{fields:(await api.get(path)).body.fields}});

const room=game.newRoom('host-'+uid);game.join(room,uid,'Test file');room.memberIds=[uid];game.stop(room);
await api.patch(roomPath,doc(room));await api.patch(subPath,doc({answers:Array(9).fill('Test'),images:[],revision:1,attempt:1}));
await api.patch(jobPath,doc({code,uid,revision:1,attempt:1,status:'queued',pipelineVersion:2,createdAt:Date.now()}));
console.log('Stopped fixture created: no image or text generation can run.');
let done=false;
for(let i=0;i<70;i++){
 const job=await read(jobPath);
 if(job.status==='cancelled'){assert.equal((await read(subPath)).images.length,0);console.log('Firestore outbox → Cloud Tasks → authenticated worker → stop guard: OK');done=true;break;}
 if(job.status==='error')throw Error('Queue test failed: '+job.errorCode);
 if(i%10===0)console.log('Waiting for queue dispatch: '+job.status);
 await new Promise(resolve=>setTimeout(resolve,3000));
}
if(!done)throw Error('Queue dispatch did not complete. Inert stopped fixture: '+jobId);
await api.delete(jobPath);await api.delete(subPath);await api.delete(roomPath);
console.log('Fixture documents removed. No paid generation performed.');
