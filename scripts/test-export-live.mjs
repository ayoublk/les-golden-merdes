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
import {createRequire} from 'node:module';
import {join} from 'node:path';
import * as game from '../functions/core.mjs';
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project:config.projectId,...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js'));
const api=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const documentBase='/projects/'+config.projectId+'/databases/(default)/documents';
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
let subPath;
try{
 const host=await signup(),player=await signup(),outsider=await signup();
 roomCode=(await call(host,'create')).code;await call(player,'join',{name:'TEST PDF'});
 await call(host,'exportPdf',{},true);await call(player,'exportPdf',{},true);
 const answers=['Réalisatrice PDF','Casting PDF','Victime PDF','épouvante','Menace PDF','Sursaut PDF','Effet PDF','Scène PDF','Le film PDF'];
 const sub={answers,images:[],synopsis:'Un synopsis de test.',artDirection:{secret:'internal'},revision:1,attempt:1};
 subPath=documentBase+`/rooms/${roomCode}/submissions/${player.localId}`;
 await api.patch(subPath,encode(sub).mapValue);
 const room={...game.newRoom(host.localId),code:roomCode};game.join(room,player.localId,'TEST PDF');room.phase='films';room.voteClosed=true;room.memberIds=[player.localId];room.scores[player.localId]=8;room.winners=[];
 await api.patch(documentBase+'/rooms/'+roomCode,encode(room).mapValue);
 await call(player,'finish',{},true);const final=await call(host,'finish');assert.equal(final.room.phase,'finished');assert.deepEqual(final.room.winners,[player.localId]);assert.equal(final.room.scores[player.localId],8);
 for(const user of [host,player]){const report=await call(user,'exportPdf');assert.equal(report.films.length,1);assert.deepEqual(report.films[0].answers,answers);assert.equal(report.films[0].artDirection,undefined);assert.deepEqual(report.winners,[player.localId]);}
 await call(outsider,'exportPdf',{},true);
 console.log('Live PDF report: members only, finished phase only, all nine answers and winner returned; internal data excluded. No generation requested.');
}finally{
 if(subPath)await api.delete(subPath);
 if(roomCode)await api.delete(documentBase+'/rooms/'+roomCode);
 for(const user of users)await json(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:user.idToken})});
 console.log('Disposable PDF fixture and anonymous accounts cleaned up.');
}
