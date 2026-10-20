// Pure queue policy, shared by the worker and the concurrency/recovery tests.
export const MAX_STEP_ATTEMPTS=5;
export const LEASE_MS=10*60*1000;
export const TERMINAL=new Set(['done','error','cancelled','superseded']);
export function nextStep(sub){
 if(!sub.synopsis||!sub.artDirection)return 'brief';
 const count=(sub.images||[]).length;
 return ['poster','scene1','scene2'][count]||null;
}
export function eligible(job,sub,room,step,now){
 if(!job||TERMINAL.has(job.status))return 'skip';
 if(!room||room.phase==='stopped')return 'cancelled';
 if(!sub||sub.revision!==job.revision||sub.attempt!==job.attempt)return 'superseded';
 if(job.leaseUntil>now||job.nextRunAt>now)return 'skip';
 if(nextStep(sub)!==step)return 'skip';
 return 'claim';
}
export function classifyError(error){
 const code=error.providerCode||'generation_failed',status=error.providerStatus||0;
 const permanent=['moderation_blocked','content_policy_violation','insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','model_not_found','permission_denied','refusal'];
 const retryable=!permanent.includes(code)&&(status===408||status===429||status>=500||['AbortError','TimeoutError','TypeError'].includes(error.name)||['invalid_output','ETIMEDOUT','ECONNRESET',4,10,13,14,'unavailable','aborted'].includes(error.code));
 return {code,status,retryable,requestId:error.requestId||null};
}
export function retryDelay(attempt,retryAfter=0,random=Math.random){return Math.max(retryAfter,Math.min(900,Math.round(20*2**(attempt-1)+random()*10)));}
export async function runStep({jobId,step,store,provider,enqueue,now=Date.now,random=Math.random}){
 const work=await store.claim(jobId,step,now());
 if(!work)return;
 if(work.defer){await enqueue(jobId,step,work.defer);return;}
 let result;
 try{result=step==='brief'?await provider.brief(work):await provider.image(work,step);}
 catch(error){
  const info=classifyError(error),retry=info.retryable&&work.stepAttempts<MAX_STEP_ATTEMPTS;
  const delay=retryDelay(work.stepAttempts,error.retryAfter,random);
  const saved=await store.fail(work,info,retry,now()+delay*1000);
  if(saved&&retry)await enqueue(jobId,step,delay);
  return;
 }
 const next=await store.complete(work,result,now());
 if(next)await enqueue(jobId,next,0);
}
