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
 const host=await signup(),a=await signup(),b=await signup();
 roomCode=(await call(host,'create')).code;
 await call(a,'join',{name:'TEST Arrêt Alice'});await call(b,'join',{name:'TEST Arrêt Bob'});
 await call(host,'start');
 await call(a,'stop',{},true);
 assert.equal((await read(a,`rooms/${roomCode}`)).phase,'writing');
 await call(host,'stop',{expected:{phase:'lobby'}});
 const stopped=await read(a,`rooms/${roomCode}`);
 assert.equal(stopped.phase,'stopped');assert.equal(stopped.voteOpen,false);assert.deepEqual(stopped.winners,[]);
 await call(host,'start',{},true);await call(host,'retry',{},true);await call(a,'vote',{target:b.localId},true);
 console.log('Live stop: host only, stale screen accepted, synchronized stop, later actions rejected. No image generation requested.');
}finally{
 for(const user of users){await json(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:user.idToken})});}
 console.log('Temporary authentication accounts cleaned up');
 if(roomCode)console.log(`Disposable test room: rooms/${roomCode}`);
}
