// Isolated Firebase integration test. Seed completed submissions directly: no paid generation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {firebaseConfig as config,region} from '../dist/config.js';
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project:config.projectId,...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js')),api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base=`/projects/${config.projectId}/databases/(default)/documents`,users=[];let code;
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
const decode=v=>v.stringValue!==undefined?v.stringValue:v.integerValue!==undefined?+v.integerValue:v.doubleValue!==undefined?v.doubleValue:v.booleanValue!==undefined?v.booleanValue:v.nullValue!==undefined?null:v.arrayValue?(v.arrayValue.values||[]).map(decode):Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,x])=>[k,decode(x)]));
async function request(url,init={}){const r=await fetch(url,{...init,signal:AbortSignal.timeout(90000)});const body=await r.text();let data;try{data=JSON.parse(body);}catch{throw Error(`HTTP ${r.status} from ${new URL(url).hostname}: ${body.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,180)}`);}return {status:r.status,data};}
async function call(user,action,extra={},reject=false){const {data}=await request(`https://${region}-${config.projectId}.cloudfunctions.net/gameAction`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.idToken}`},body:JSON.stringify({data:{action,code,...extra}})});if(reject){assert.ok(data.error,`Expected rejection: ${action}`);return;}assert.ok(!data.error,data.error?.message);return data.result??data.data;}
async function room(user){const r=await request(`https://firestore.googleapis.com/v1${base}/rooms/${code}`,{headers:{Authorization:`Bearer ${user.idToken}`}});assert.equal(r.status,200);return decode({mapValue:{fields:r.data.fields}});}
try{
 for(let i=0;i<4;i++){const {status,data}=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});assert.equal(status,200);users.push(data);}
 const [host,a,b,absent]=users;code=(await call(host,'create')).code;
 for(const [i,u] of [a,b,absent].entries())await call(u,'join',{name:['TEST Alice','TEST Bob','TEST Absent'][i]});
 await call(host,'start');await call(host,'beginReveal',{skipMissing:true},true);
 const r=await room(host),answers=['', 'Casting fictif', '', '', 'Une citrouille timide', '', 'Un fantôme en papier', '', ''];
 for(const u of [a,b]){const p=r.players.find(p=>p.id===u.localId);p.submitted=true;p.generation='error';await api.patch(`${base}/rooms/${code}/submissions/${u.localId}`,encode({answers,images:[],imagePlanVersion:3,revision:1,attempt:1}).mapValue);}
 await api.patch(`${base}/rooms/${code}`,encode(r).mapValue);
 // Same-answer submission is idempotent: exercises validation without creating paid image jobs.
 await call(a,'submit',{answers});await call(b,'submit',{answers});
 await call(host,'beginReveal',{skipMissing:true});
 await call(absent,'submit',{answers},true);
 for(let question=0;question<9;question++){
  await call(host,'revealNext');await call(host,'revealNext');
  const current=await room(host);assert.equal(current.question,question);
  assert.equal(current.revealed[0].answer,answers[question]||(question===8?'Film sans titre':'Non renseigné'));
  if(question!==3){
   await call(host,'openVote');await call(a,'vote',{target:b.localId});
   const restored=await call(a,'resume');assert.equal(restored.selected[String(question)],b.localId);
   assert.equal((await call(absent,'resume')).room.phase,'reveal');
   await call(host,'closeVote'); // Incomplete turnout must never block the host.
  }
  await call(host,'nextQuestion');
 }
 const movies=await room(host);assert.equal(movies.phase,'films');assert.equal(movies.films[0].title,'Film sans titre');
 await call(host,'nextFilm');await call(host,'openVote');await call(a,'vote',{target:b.localId});
 assert.equal((await call(a,'resume')).selected.final,b.localId);
 await call(host,'closeVote');await call(host,'finish');
 const final=await call(a,'resume');assert.equal(final.room.phase,'finished');assert.equal(final.room.scores[b.localId],13);assert.deepEqual(final.room.winners,[b.localId]);
 const report=await call(a,'exportPdf');assert.equal(report.films.length,2);assert.equal(report.films[0].answers[0],'Réponse indisponible');
 console.log('LIVE OK: partial questionnaires, blank disclosures, missing spectators, absent voters, complete game, server vote recovery, final score and report. No image jobs or paid calls.');
}finally{
 if(code){const paths=[`${base}/rooms/${code}`,...users.slice(1).flatMap(u=>[`${base}/rooms/${code}/submissions/${u.localId}`,...['0','1','2','4','5','6','7','8','final'].map(round=>`${base}/rooms/${code}/votes/${round}_${u.localId}`)]),`${base}/hostQuotas/${users[0].localId}`];for(const path of paths)try{await api.delete(path);}catch(e){if(e.status!==404&&e.context?.response?.statusCode!==404)console.log('Cleanup item skipped (may not exist)');}}
 for(const u of users)await request(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:u.idToken})});
 console.log('Temporary test documents and anonymous accounts cleaned up.');
}
