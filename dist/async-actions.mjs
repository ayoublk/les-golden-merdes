// One request at a time per browser; always restore UI, including on rejection.
export function createActionRunner({onStart=()=>{},onEnd=()=>{},onError=()=>{}}={}){
 let running=false;
 return {wrap(action){return async(...args)=>{
  if(args[0]?.type==='submit')args[0].preventDefault();
  if(running)return;
  running=true;
  try{onStart(args[0]);return await action(...args);}
  catch(error){onError(error);}
  finally{running=false;onEnd();}
 };}};
}
