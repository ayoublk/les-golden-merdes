import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

import {onCall,HttpsError} from 'firebase-functions/v2/https';

import {defineBoolean} from 'firebase-functions/params';
import {randomBytes} from 'node:crypto';
import * as game from './core.mjs';
import {planRecovery} from './recovery.mjs';
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
  game.assertCursor(room,data.expected);
  if(action==='submit'){
   assert(player&&room.phase==='writing','Les révélations ont commencé ou vous n’êtes pas joueur.');
   const answers=game.validateAnswers(data.answers),subRef=ref.collection('submissions').doc(uid),previous=(await tx.get(subRef)).data();
   if(previous&&JSON.stringify(previous.answers)===JSON.stringify(answers)&&!(player.generation==='unavailable'&&imageGenerationEnabled.value()))return {ok:true};
   const revision=(previous?.revision||0)+1;
   player.submitted=true;player.generation=imageGenerationEnabled.value()?'queued':'unavailable';player.generationAt=Date.now();player.generationCount=0;player.generationError=null;
   tx.set(subRef,{answers,images:[],revision,attempt:1,submittedAt:Date.now()});
   if(imageGenerationEnabled.value())tx.create(db.collection('generationJobs').doc(),{code:data.code,uid,revision,attempt:1,status:'queued'});saveRoom(tx,ref,room);return {ok:true};
  }
  if(action==='vote'){
   game.validateVote(room,uid,data.target);const key=voteKey(room),voteRef=ref.collection('votes').doc(`${key}_${uid}`),previous=await tx.get(voteRef);
   if(previous.data()?.target===data.target)return {ok:true};
   tx.set(voteRef,{voter:uid,target:data.target,round:key});if(!previous.exists)tx.update(ref,{voteCount:(room.voteCount||0)+1});return {ok:true};
  }
  assert(host,'Seul l’animateur peut piloter la séance.');
  if(action==='retry'&&data.id!==undefined)assert(typeof data.id==='string'&&room.players.some(p=>p.id===data.id),'Joueur inconnu.');
  let submissions={};
  let ids=[];
  if(action==='revealNext'&&room.players[room.revealed.length])ids=[room.players[room.revealed.length].id];
  if(action==='nextQuestion'&&room.question===8)ids=room.players.map(p=>p.id);
  if(action==='retry')ids=data.id?[data.id]:room.players.filter(p=>p.submitted&&p.generation!=='ready').map(p=>p.id);
  if(ids.length){
   const docs=await tx.getAll(...ids.map(id=>ref.collection('submissions').doc(id)));
   submissions=Object.fromEntries(docs.map((s,i)=>[ids[i],s.data()]));
  }
  switch(action){
   case 'remove':assert(room.phase==='lobby','Le casting est fermé.');room.players=room.players.filter(p=>p.id!==data.id);break;
   case 'start':game.start(room);break;
   case 'beginReveal':game.beginReveal(room);break;
   case 'revealNext':game.revealNext(room,submissions);break;
   case 'openVote':game.openVote(room);break;
   case 'closeVote':{const votes=await tx.get(ref.collection('votes').where('round','==',voteKey(room)));game.closeVote(room,Object.fromEntries(votes.docs.map(d=>[d.data().voter,d.data().target])));break;}
   case 'nextQuestion':game.nextQuestion(room,submissions,{skipImages:data.skipImages===true});break;
   case 'nextFilm':assert(room.phase==='films'&&!room.voteOpen&&!room.voteClosed&&room.filmIndex<room.films.length-1,'Film suivant indisponible.');room.filmIndex++;break;
   case 'finish':game.finish(room);break;
   case 'retry':{
    assert(imageGenerationEnabled.value(),'La génération d’images n’est pas encore activée sur le serveur.');
    const plans=planRecovery(room,submissions,{id:data.id,force:data.force===true});
    for(const plan of plans){const p=room.players.find(p=>p.id===plan.id);p.generation='queued';p.generationAt=Date.now();p.generationCount=plan.images.length;p.generationError=null;tx.update(ref.collection('submissions').doc(plan.id),{attempt:plan.attempt,lastRetryAt:plan.lastRetryAt});tx.create(db.collection('generationJobs').doc(),{code:data.code,uid:plan.id,revision:plan.revision,attempt:plan.attempt,status:'queued'});}
    break;
   }
   default:throw new HttpsError('invalid-argument','Commande inconnue.');
  }
  saveRoom(tx,ref,room);return {ok:true};
 });}catch(e){if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',e.message||'Action impossible.');}
});
