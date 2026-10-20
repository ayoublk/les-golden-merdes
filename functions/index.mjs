import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

import {onCall,HttpsError} from 'firebase-functions/v2/https';

import {defineBoolean} from 'firebase-functions/params';
import {randomBytes} from 'node:crypto';
import * as game from './core.mjs';
initializeApp();
const db=getFirestore(),REGION='europe-west1';
const imageGenerationEnabled=defineBoolean('ENABLE_IMAGE_GENERATION',{default:false});

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>[...randomBytes(6)].map(n=>alphabet[n%alphabet.length]).join('');
const voteKey=room=>room.phase==='films'?'final':String(room.question);
function assert(ok,message){if(!ok)throw new HttpsError('failed-precondition',message);}
function saveRoom(tx,ref,room){room.memberIds=room.players.map(p=>p.id);tx.set(ref,room);}
export const gameAction=onCall({region:REGION,maxInstances:10,timeoutSeconds:60},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Une connexion anonyme est nécessaire.');
 const uid=request.auth.uid,data=request.data||{},action=data.action;
 if(action==='create'){
  const id=code(),ref=db.doc(`rooms/${id}`),quota=db.doc(`hostQuotas/${uid}`);
  await db.runTransaction(async tx=>{const [q,existing]=await Promise.all([tx.get(quota),tx.get(ref)]);assert(!existing.exists,'Réessayez de créer le salon.');assert(Date.now()-(q.data()?.lastCreatedAt||0)>60000,'Attendez une minute avant de créer un autre salon.');assert((q.data()?.count||0)<30,'Limite de 30 salons par animateur atteinte.');saveRoom(tx,ref,{...game.newRoom(uid),code:id});tx.set(quota,{lastCreatedAt:Date.now(),count:(q.data()?.count||0)+1});});
  return {code:id};
 }
 assert(typeof data.code==='string'&&/^[A-Z0-9]{6}$/.test(data.code),'Code de salon invalide.');
 const ref=db.doc(`rooms/${data.code}`);
 try{return await db.runTransaction(async tx=>{
  const snapshot=await tx.get(ref);assert(snapshot.exists,'Ce salon n’existe pas.');const room=snapshot.data();
  if(action==='join'){assert(uid!==room.hostId,'L’animateur ne participe pas au casting.');game.join(room,uid,data.name);saveRoom(tx,ref,room);return {ok:true};}
  const host=room.hostId===uid,player=room.players.find(p=>p.id===uid);
  assert(host||player,'Vous ne faites pas partie de ce salon.');
  if(action==='submit'){
   assert(player&&room.phase==='writing','Les révélations ont commencé ou vous n’êtes pas joueur.');
   const answers=game.validateAnswers(data.answers),subRef=ref.collection('submissions').doc(uid),previous=(await tx.get(subRef)).data();
   if(previous&&JSON.stringify(previous.answers)===JSON.stringify(answers)&&!(player.generation==='unavailable'&&imageGenerationEnabled.value()))return {ok:true};
   const revision=(previous?.revision||0)+1;
   player.submitted=true;player.generation=imageGenerationEnabled.value()?'queued':'unavailable';player.generationAt=Date.now();
   tx.set(subRef,{answers,images:[],revision,attempt:1,submittedAt:Date.now()});
   if(imageGenerationEnabled.value())tx.create(db.collection('generationJobs').doc(),{code:data.code,uid,revision,attempt:1,status:'queued'});saveRoom(tx,ref,room);return {ok:true};
  }
  if(action==='vote'){
   game.validateVote(room,uid,data.target);const key=voteKey(room),voteRef=ref.collection('votes').doc(`${key}_${uid}`),previous=await tx.get(voteRef);
   if(!previous.exists)room.voteCount++;tx.set(voteRef,{voter:uid,target:data.target,round:key});saveRoom(tx,ref,room);return {ok:true};
  }
  assert(host,'Seul l’animateur peut piloter la séance.');
  let submissions={};
  if(['revealNext','nextQuestion','retry'].includes(action)){
   const docs=await Promise.all(room.players.map(p=>tx.get(ref.collection('submissions').doc(p.id))));
   submissions=Object.fromEntries(docs.map((s,i)=>[room.players[i].id,s.data()]));
  }
  switch(action){
   case 'remove':assert(room.phase==='lobby','Le casting est fermé.');room.players=room.players.filter(p=>p.id!==data.id);break;
   case 'start':game.start(room);break;
   case 'beginReveal':game.beginReveal(room);break;
   case 'revealNext':game.revealNext(room,submissions);break;
   case 'openVote':game.openVote(room);break;
   case 'closeVote':{const votes=await tx.get(ref.collection('votes').where('round','==',voteKey(room)));game.closeVote(room,Object.fromEntries(votes.docs.map(d=>[d.data().voter,d.data().target])));break;}
   case 'nextQuestion':game.nextQuestion(room,submissions);break;
   case 'nextFilm':assert(room.phase==='films'&&!room.voteOpen&&!room.voteClosed&&room.filmIndex<room.films.length-1,'Film suivant indisponible.');room.filmIndex++;break;
   case 'finish':game.finish(room);break;
   case 'retry':{
    assert(imageGenerationEnabled.value(),'La génération d’images n’est pas encore activée sur le serveur.');
    assert(['writing','reveal'].includes(room.phase),'Les films ont déjà été dévoilés.');let count=0;
    for(const p of room.players){const sub=submissions[p.id];if(!sub)continue;const stalled=['queued','generating'].includes(p.generation)&&Date.now()-(p.generationAt||0)>20*60000;if(!['error','unavailable'].includes(p.generation)&&!stalled)continue;if(sub.attempt>=3)continue;const attempt=sub.attempt+1;p.generation='queued';p.generationAt=Date.now();tx.update(ref.collection('submissions').doc(p.id),{attempt});tx.create(db.collection('generationJobs').doc(),{code:data.code,uid:p.id,revision:sub.revision,attempt,status:'queued'});count++;}
    assert(count>0,'Aucun film relançable (trois tentatives maximum par version, ou attendez 20 minutes pour une génération bloquée).');break;
   }
   default:throw new HttpsError('invalid-argument','Commande inconnue.');
  }
  saveRoom(tx,ref,room);return {ok:true};
 });}catch(e){if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',e.message||'Action impossible.');}
});
