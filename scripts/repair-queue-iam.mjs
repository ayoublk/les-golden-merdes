// Work around Firebase CLI 14's empty Cloud Tasks IAM policy bug.
// Preserve existing bindings and grant this game's runtime enqueue access to this queue only.
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
const account=require(join(root,'auth.js')).getGlobalDefaultAccount();
await require(join(root,'requireAuth.js')).requireAuth({project:'emestreamhalloween',...account,nonInteractive:true});
const {Client}=require(join(root,'apiv2.js'));
const api=new Client({urlPrefix:'https://cloudtasks.googleapis.com',apiVersion:'v2'});
const name='/projects/emestreamhalloween/locations/europe-west1/queues/processFilmStep';
const member='serviceAccount:478334155470-compute@developer.gserviceaccount.com',role='roles/cloudtasks.enqueuer';
const policy=(await api.post(name+':getIamPolicy',{})).body;
const bindings=policy.bindings||[];
let binding=bindings.find(b=>b.role===role&&!b.condition);
if(!binding){binding={role,members:[]};bindings.push(binding);}
if(!binding.members.includes(member)){
 binding.members.push(member);
 await api.post(name+':setIamPolicy',{policy:{...policy,bindings}});
 console.log('Runtime enqueue access configured on the film queue only.');
}else console.log('Runtime enqueue access already present.');
