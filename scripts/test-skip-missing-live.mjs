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
async function request(url,init={}){const r=await fetch(url,{...init,signal:AbortSignal.timeout(90000)});return {status:r.status,data:await r.json()};}
async function call(user,action,extra={},reject=false){const {data}=await request(`https://${region}-${config.projectId}.cloudfunctions.net/gameAction`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.idToken}`},body:JSON.stringify({data:{action,code,...extra}})});if(reject){assert.ok(data.error,`Expected rejection: ${action}`);return;}assert.ok(!data.error,data.error?.message);return data.result??data.data;}
async function room(user){const r=await request(`https://firestore.googleapis.com/v1${base}/rooms/${code}`,{headers:{Authorization:`Bearer ${user.idToken}`}});assert.equal(r.status,200);return decode({mapValue:{fields:r.data.fields}});}
try{
 for(let i=0;i<4;i++){const {status,data}=await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});assert.equal(status,200);users.push(data);}
 const [host,a,b,absent]=users;code=(await call(host,'create')).code;
 for(const [i,u] of [a,b,absent].entries())await call(u,'join',{name:['TEST Alice','TEST Bob','TEST Absent'][i]});
 await call(host,'start');await call(host,'beginReveal',{skipMissing:true},true);
 const r=await room(host),answers=['Réalisateur fictif','Casting fictif','Victime fictive','épouvante','Menace','Sursaut','Effet','WTF','Film de test sans IA'];
 for(const u of [a,b]){const p=r.players.find(p=>p.id===u.localId);p.submitted=true;p.generation='unavailable';await api.patch(`${base}/rooms/${code}/submissions/${u.localId}`,encode({answers,images:[],imagePlanVersion:3,revision:1,attempt:1}).mapValue);}
 await api.patch(`${base}/rooms/${code}`,encode(r).mapValue);
 await call(a,'beginReveal',{skipMissing:true},true);await call(host,'beginReveal',{},true);
 await call(host,'beginReveal',{skipMissing:true});
 const visible=await room(absent);assert.equal(visible.phase,'reveal');assert.equal(visible.players.length,2);assert.equal(visible.spectators[0].id,absent.localId);
 await call(absent,'submit',{answers},true);await call(absent,'join',{name:'TEST Absent'});assert.equal((await room(absent)).players.length,2);
 await call(host,'revealNext');await call(host,'revealNext');await call(host,'openVote');
 await call(absent,'vote',{target:a.localId},true);await call(a,'vote',{target:absent.localId},true);
 await call(a,'vote',{target:b.localId});await call(b,'vote',{target:a.localId});await call(host,'closeVote');
 const voted=await room(absent);assert.equal(voted.voteCount,2);assert.equal(voted.scores[a.localId],1);assert.equal(voted.scores[b.localId],1);
 await call(host,'nextQuestion');assert.equal((await room(absent)).question,1);await call(host,'stop');
 console.log('LIVE OK: host-only override, no-film rejection, spectator access/rejoin, late submission rejected, absent excluded from voting, two received films preserved. No image jobs or paid calls.');
}finally{
 if(code){const paths=[`${base}/rooms/${code}`,...users.slice(1).flatMap(u=>[`${base}/rooms/${code}/submissions/${u.localId}`,`${base}/rooms/${code}/votes/0_${u.localId}`]),`${base}/hostQuotas/${users[0].localId}`];for(const path of paths)try{await api.delete(path);}catch(e){if(e.status!==404&&e.context?.response?.statusCode!==404)console.log('Cleanup item skipped (may not exist)');}}
 for(const u of users)await request(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:u.idToken})});
 console.log('Temporary test documents and anonymous accounts cleaned up.');
}
