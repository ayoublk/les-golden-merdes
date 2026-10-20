export const STALE_IMAGE_MS=10*60*1000;
export function planRecovery(room,submissions,{id,force=false,now=Date.now()}={}){
 if(room.phase==='stopped')throw Error('Cette partie a été arrêtée.');
 if(room.phase==='lobby')throw Error('Les films ne sont pas encore envoyés.');
 if(id&&!room.players.some(p=>p.id===id))throw Error('Joueur inconnu.');
 const plans=[];
 for(const p of room.players){
  if(id&&p.id!==id)continue;
  const sub=submissions[p.id];if(!p.submitted||!sub)continue;
  const active=['queued','generating'].includes(p.generation);
  const stale=active&&now-(p.generationAt||0)>=STALE_IMAGE_MS;
  if(p.generation==='ready')continue;
  if(active&&!stale&&!force){if(id)throw Error('Une génération est en cours. Confirme la relance de secours pour la remplacer.');continue;}
  if(!['error','unavailable'].includes(p.generation)&&!active)continue;
  if(sub.lastRetryAt&&now-sub.lastRetryAt<10000){if(id)throw Error('Une relance vient d’être envoyée. Attends quelques secondes.');continue;}
  plans.push({id:p.id,revision:sub.revision,attempt:(sub.attempt||0)+1,images:sub.images||[],lastRetryAt:now});
 }
 if(!plans.length)throw Error('Aucun film à relancer : les images sont prêtes ou leur génération est encore en cours.');
 return plans;
}
