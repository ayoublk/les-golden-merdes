import {randomUUID} from 'node:crypto';
import {eligible,nextStep,LEASE_MS,MAX_STEP_ATTEMPTS} from './pipeline.mjs';
import {imageSteps} from './safety.mjs';
function saveRoom(tx,ref,room){room.memberIds=[...room.players,...(room.spectators||[])].map(p=>p.id);tx.set(ref,room);}
function updateFilm(room,sub){const film=room.films?.find(f=>f.id===sub.uid);if(film){film.imagePlanVersion=sub.imagePlanVersion||2;film.images=[...(sub.images||[])];film.synopsis=sub.synopsis||'';film.synopsisStatus=sub.synopsis?'ready':'error';}}
export function createStore(db){
 const controlRef=db.doc('generationControl/provider');
 const refs=job=>({roomRef:db.doc(`rooms/${job.code}`),subRef:db.doc(`rooms/${job.code}/submissions/${job.uid}`)});
 return {
  async claim(jobId,step,now){return db.runTransaction(async tx=>{
   const jobRef=db.doc(`generationJobs/${jobId}`),j=await tx.get(jobRef),job=j.data();if(!job)return null;
   const {roomRef,subRef}=refs(job),[r,s,c]=await Promise.all([tx.get(roomRef),tx.get(subRef),tx.get(controlRef)]),room=r.data(),sub=s.data();
   const decision=eligible(job,sub,room,step,now);
   if(['cancelled','superseded'].includes(decision)){tx.update(jobRef,{status:decision,finishedAt:now,leaseUntil:0});return null;}
   if(decision!=='claim')return null;
   if(c.data()?.cooldownUntil>now)return {defer:Math.ceil((c.data().cooldownUntil-now)/1000)};
   const p=room.players.find(p=>p.id===job.uid);if(!p)return null;
   const stepAttempts=(job.stepAttempts?.[step]||0)+1;
   if(stepAttempts>MAX_STEP_ATTEMPTS+2){p.generation='error';p.generationError='retry_exhausted';p.generationAt=now;saveRoom(tx,roomRef,room);tx.update(jobRef,{status:'error',errorCode:'retry_exhausted',leaseUntil:0,finishedAt:now});return null;}
   const owner=randomUUID();
   tx.update(jobRef,{pipelineVersion:2,status:'running',step,stepAttempts:{...job.stepAttempts,[step]:stepAttempts},owner,leaseUntil:now+LEASE_MS,updatedAt:now});
   p.generation='generating';p.generationStage=step;p.generationError=null;p.generationAt=now;saveRoom(tx,roomRef,room);
   return {jobId,job:{...job,step},sub,room,step,owner,stepAttempts};
  });},
  async complete(work,result,now){return db.runTransaction(async tx=>{
   const jobRef=db.doc(`generationJobs/${work.jobId}`),{roomRef,subRef}=refs(work.job);
   const [j,r,s]=await Promise.all([tx.get(jobRef),tx.get(roomRef),tx.get(subRef)]),job=j.data(),room=r.data(),sub=s.data();
   if(!job||job.status!=='running'||job.step!==work.step||job.owner!==work.owner||sub?.revision!==job.revision||sub?.attempt!==job.attempt)return null;
   if(!room||room.phase==='stopped'){tx.update(jobRef,{status:'cancelled',leaseUntil:0,finishedAt:now});return null;}
   if(result.safetyPlan){sub.safePlans={...sub.safePlans,[work.step]:result.safetyPlan};}
   else if(result.brief){if(!(sub.images||[]).length)sub.imagePlanVersion=3;sub.synopsis=result.brief.synopsis;sub.artDirection=result.brief;sub.safeFilm=!!result.safeFilm;sub.briefFallback=!!result.briefFallback;}
   else{const images=[...(sub.images||[])];while(images.length<imageSteps(sub).indexOf(work.step))images.push(null);images[imageSteps(sub).indexOf(work.step)]=result.image;sub.images=images;}
   const next=nextStep(sub),p=room.players.find(p=>p.id===job.uid);
   tx.update(subRef,{imagePlanVersion:sub.imagePlanVersion||2,images:sub.images||[],synopsis:sub.synopsis||'',artDirection:sub.artDirection||null,safeFilm:!!sub.safeFilm,briefFallback:!!sub.briefFallback,safePlans:sub.safePlans||{}});
   const incomplete=Object.keys(sub.failedSteps||{}).length>0;
   if(p){p.imagePlanVersion=sub.imagePlanVersion||2;p.generation=next?'queued':incomplete?'error':'ready';p.generationStage=next||'done';p.generationCount=(sub.images||[]).filter(Boolean).length;p.generationError=!next&&incomplete?'partial_images':null;p.generationFallback=!!sub.safeFilm||!!sub.briefFallback||Object.keys(sub.safetyFallback||{}).length>0;p.generationAt=now;p.synopsisReady=!!sub.synopsis;}
   updateFilm(room,{...sub,uid:job.uid});saveRoom(tx,roomRef,room);
   tx.update(jobRef,{status:next?'queued':incomplete?'error':'done',step:next,leaseUntil:0,nextRunAt:0,lastEnqueuedAt:0,updatedAt:now,...(!next?{finishedAt:now}:{})});
   return next;
  });},
  async fail(work,info,retry,nextRunAt){return db.runTransaction(async tx=>{
   const jobRef=db.doc(`generationJobs/${work.jobId}`),{roomRef,subRef}=refs(work.job);
   const [j,r,s,c]=await Promise.all([tx.get(jobRef),tx.get(roomRef),tx.get(subRef),tx.get(controlRef)]),job=j.data(),room=r.data(),sub=s.data();
   if(!job||job.status!=='running'||job.step!==work.step||job.owner!==work.owner||sub?.revision!==job.revision||sub?.attempt!==job.attempt)return false;
   if(!room||room.phase==='stopped'){tx.update(jobRef,{status:'cancelled',leaseUntil:0,finishedAt:Date.now()});return false;}
   if(info.safetyFallback){sub.safetyFallback={...sub.safetyFallback,[work.step]:true};tx.update(subRef,{safetyFallback:sub.safetyFallback});}
   if(info.skipStep){
    sub.failedSteps={...sub.failedSteps,[work.step]:info.code};tx.update(subRef,{failedSteps:sub.failedSteps});
    const next=nextStep(sub),p=room.players.find(p=>p.id===job.uid);
    if(p){p.generation=next?'queued':'error';p.generationError='partial_images';p.generationAt=Date.now();p.generationStage=next||'done';}
    saveRoom(tx,roomRef,room);
    tx.update(jobRef,{status:next?'queued':'error',step:next,leaseUntil:0,nextRunAt:0,lastEnqueuedAt:0,errorCode:info.code,updatedAt:Date.now()});
    return next||true;
   }
   const p=room.players.find(p=>p.id===job.uid);if(p){p.generation=retry?'retrying':'error';p.generationError=info.code;p.generationStage=work.step;p.generationAt=Date.now();p.generationRetryAt=retry?nextRunAt:null;}
   updateFilm(room,{...sub,uid:job.uid});saveRoom(tx,roomRef,room);
   tx.update(jobRef,{status:retry?'retrying':'error',errorCode:info.code,errorStatus:info.status,requestId:info.requestId,leaseUntil:0,nextRunAt:retry?nextRunAt:0,lastEnqueuedAt:0,updatedAt:Date.now(),...(!retry?{finishedAt:Date.now()}:{})});
   if(info.status===429&&retry)tx.set(controlRef,{cooldownUntil:Math.max(c.data()?.cooldownUntil||0,nextRunAt)});
   console.warn('Film step failed',{jobId:work.jobId,step:work.step,attempt:work.stepAttempts,retry,...info});
   return true;
  });},
  async pending(now){
   const docs=await db.collection('generationJobs').where('status','in',['queued','running','retrying']).limit(100).get();
   return docs.docs.filter(d=>{const j=d.data();return j.pipelineVersion===2&&(j.leaseUntil||0)<=now&&(j.nextRunAt||0)<=now&&(j.status==='running'||!j.lastEnqueuedAt||now-j.lastEnqueuedAt>=15*60*1000);}).map(d=>({jobId:d.id,...d.data()}));
  }
 };
}
