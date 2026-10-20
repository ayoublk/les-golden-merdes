import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {getFunctions} from 'firebase-admin/functions';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {onTaskDispatched} from 'firebase-functions/v2/tasks';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {randomUUID} from 'node:crypto';
import {createStore} from './store.mjs';
import {runStep,nextStep,TERMINAL} from './pipeline.mjs';
import {createProvider,IMAGE_MODEL,TEXT_MODEL} from './provider.mjs';
initializeApp();
const db=getFirestore(),REGION='europe-west1',store=createStore(db);
const concurrency=Math.min(20,Math.max(1,Number(process.env.IMAGE_CONCURRENCY)||9));
const dispatchRate=Math.max(.01,Math.min(10,Number(process.env.IMAGE_DISPATCH_PER_SECOND)||.1));
const runtimeAccount=process.env.GENERATION_SERVICE_ACCOUNT||'478334155470-compute@developer.gserviceaccount.com';
async function enqueue(jobId,step,delay=0){await getFunctions().taskQueue(`locations/${REGION}/functions/processFilmStep`).enqueue({jobId,step},{scheduleDelaySeconds:Math.ceil(delay),dispatchDeadlineSeconds:540});}
const imageIndex={poster:0,scene1:1,scene2:2};
function fileFor(work,step){return getStorage().bucket().file(`films/${work.job.code}/${work.job.uid}/${work.job.revision}-${work.job.attempt}-${imageIndex[step]}.png`);}
function imageUrl(file,token){return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`;}
const artifacts={
 async read(work,step){const file=fileFor(work,step);const [exists]=await file.exists();if(!exists)return null;const [meta]=await file.getMetadata();const token=meta.metadata?.firebaseStorageDownloadTokens;return token?imageUrl(file,token):null;},
 async save(work,step,bytes){const file=fileFor(work,step),token=randomUUID();await file.save(bytes,{metadata:{contentType:'image/png',metadata:{firebaseStorageDownloadTokens:token}}});return imageUrl(file,token);}
};
// Outbox trigger: dispatch only. Paid calls run in the private task worker.
export const generateFilm=onDocumentCreated({document:'generationJobs/{jobId}',region:REGION,timeoutSeconds:60,maxInstances:3,retry:true},async event=>{
 const job=event.data.data();if(TERMINAL.has(job.status))return;
 const sub=(await db.doc(`rooms/${job.code}/submissions/${job.uid}`).get()).data();if(!sub)return;
 const step=nextStep(sub);if(step)await enqueue(event.params.jobId,step);
});
export const processFilmStep=onTaskDispatched({region:REGION,invoker:[runtimeAccount],secrets:['OPENAI_API_KEY'],timeoutSeconds:540,memory:'1GiB',maxInstances:concurrency,concurrency:1,
 rateLimits:{maxConcurrentDispatches:concurrency,maxDispatchesPerSecond:dispatchRate},
 retryConfig:{maxAttempts:8,minBackoffSeconds:30,maxBackoffSeconds:300,maxDoublings:4,maxRetrySeconds:7200}},async request=>{
 const {jobId,step}=request.data||{};
 if(typeof jobId!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(jobId)||!['brief','poster','scene1','scene2'].includes(step))return;
 const provider=createProvider({apiKey:process.env.OPENAI_API_KEY,model:process.env.IMAGE_MODEL||IMAGE_MODEL,textModel:process.env.TEXT_MODEL||TEXT_MODEL,posterQuality:process.env.POSTER_QUALITY||'high',sceneQuality:process.env.SCENE_QUALITY||'high',artifacts});
 await runStep({jobId,step,store,provider,enqueue});
});
// Repair lost dispatches and expired leases, including hard process termination.
export const recoverFilmQueue=onSchedule({schedule:'every 1 minutes',region:REGION,timeoutSeconds:60,maxInstances:1},async()=>{
 const jobs=await store.pending(Date.now());
 for(const job of jobs){const sub=(await db.doc(`rooms/${job.code}/submissions/${job.uid}`).get()).data();const step=sub&&nextStep(sub);if(step)await enqueue(job.jobId,step);}
});
