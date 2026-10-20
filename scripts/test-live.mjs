// Explicit integration test against the configured Firebase project.
// Creates an isolated test room and temporary anonymous accounts; never logs tokens.
import assert from 'node:assert/strict';
import {firebaseConfig as config,region} from '../dist/config.js';
const users=[];const durations=[];let roomCode,hostId;
const base=`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
async function json(url,init){const res=await fetch(url,{...init,signal:AbortSignal.timeout(90000)});const body=await res.text();let data;try{data=JSON.parse(body);}catch{throw Error(`HTTP ${res.status} from ${new URL(url).hostname}: ${body.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,220)}`);}return {status:res.status,ok:res.ok,data};}
async function signup(){const r=await json(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});assert.equal(r.status,200,r.data.error?.message);users.push(r.data);return r.data;}
async function call(user,action,extra={},expectError=false){const began=performance.now();const r=await json(`https://${region}-${config.projectId}.cloudfunctions.net/gameAction`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.idToken}`},body:JSON.stringify({data:{action,code:roomCode,...extra}})});durations.push({action,ms:performance.now()-began});if(expectError){assert.ok(r.data.error,`Expected rejection for ${action}`);return;}assert.ok(!r.data.error,r.data.error?.message||`HTTP ${r.status}`);return r.data.result??r.data.data;}
function decode(v){if(v.stringValue!==undefined)return v.stringValue;if(v.integerValue!==undefined)return +v.integerValue;if(v.doubleValue!==undefined)return v.doubleValue;if(v.booleanValue!==undefined)return v.booleanValue;if(v.nullValue!==undefined)return null;if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));}
async function read(user,path,expected=200){const r=await json(`${base}/${path}`,{headers:{Authorization:`Bearer ${user.idToken}`}});assert.equal(r.status,expected,`Read ${path}: ${r.data.error?.message}`);return r.data.fields?Object.fromEntries(Object.entries(r.data.fields).map(([k,v])=>[k,decode(v)])):r.data;}
try{
 const host=await signup(),a=await signup(),b=await signup();hostId=host.localId;console.log('Anonymous authentication: OK (3 temporary identities)');
 const room=await call(host,'create');roomCode=room.code;assert.match(roomCode,/^[A-Z0-9]{6}$/);
 await read(a,`rooms/${roomCode}`,403);
 await call(a,'join',{name:'TEST Alice'});await call(b,'join',{name:'TEST Bob'});
 await call(a,'start',{},true);await call(host,'start');
 const answers=['Réalisateur test','Casting test','Victime test','épouvante','Une courgette hantée','Un cri dans le noir','Un fantôme en carton','Une danse en apesanteur','Le nanar de test'];
 await call(a,'submit',{answers});await call(b,'submit',{answers:answers.map((x,i)=>i===8?'Le retour du nanar':x)});
 await call(a,'submit',{answers:answers.map((x,i)=>i===0?'Réalisatrice test corrigée':x)});
 await read(b,`rooms/${roomCode}/submissions/${a.localId}`,403);
 await read(a,`rooms/${roomCode}/submissions/${a.localId}`);
 const direct=await json(`${base}/rooms/${roomCode}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.idToken}`},body:JSON.stringify({fields:{phase:{stringValue:'finished'}}})});assert.equal(direct.status,403);
 await call(host,'beginReveal');await call(a,'submit',{answers},true);
 for(let q=0;q<9;q++){
  if(q===0){const before=await read(a,`rooms/${roomCode}`);const expected={phase:before.phase,question:before.question,filmIndex:before.filmIndex,voteOpen:before.voteOpen,voteClosed:before.voteClosed,revealedCount:before.revealed.length};await call(host,'revealNext',{expected});await call(host,'revealNext',{expected},true);}else await call(host,'revealNext');await call(host,'openVote',{},true);await call(host,'revealNext');await call(host,'openVote');
  if(q===0)await call(a,'vote',{target:a.localId},true);
  await call(a,'vote',{target:b.localId});await call(a,'vote',{target:b.localId});await call(b,'vote',{target:a.localId});
  const visible=await read(a,`rooms/${roomCode}`);assert.equal(visible.voteCount,2);assert.equal(visible.revealed.length,2);
  await call(host,'closeVote');await call(host,'closeVote',{},true);await call(host,'nextQuestion');
 }
 await call(host,'nextFilm');await call(host,'openVote');await call(a,'vote',{target:b.localId});await call(b,'vote',{target:a.localId});await call(host,'closeVote');await call(host,'finish');
 const final=await read(a,`rooms/${roomCode}`);assert.equal(final.phase,'finished');assert.equal(final.winners.length,2);assert.equal(final.scores[a.localId],14);assert.equal(final.scores[b.localId],14);
 console.log('Live game: lobby, submissions, corrections, 9 reveals/votes, final bonus and tied winners OK');
 console.log('Access rules: private answers, non-member room reads, direct writes and player admin commands rejected');
 for(const action of ['create','vote','revealNext']){const times=durations.filter(x=>x.action===action).map(x=>x.ms).sort((a,b)=>a-b);console.log(action+': median '+Math.round(times[Math.floor(times.length/2)])+' ms ('+times.length+' requests)');}console.log(JSON.stringify({testRoom:roomCode,testHost:hostId,status:'passed'}));
}finally{
 for(const user of users){const r=await json(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:user.idToken})});if(!r.ok)console.log('Temporary account cleanup failed');}
 console.log('Temporary authentication accounts cleaned up');
 if(roomCode)console.log(`Disposable test room: rooms/${roomCode}`);
}
