// Enable browser PDF pixel reads from the game's existing download URLs.
// This does not change object access, tokens or Firebase security rules.
import {createRequire} from 'node:module';import {join} from 'node:path';
const require=createRequire(import.meta.url),root=join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');const account=require(join(root,'auth.js')).getGlobalDefaultAccount();await require(join(root,'requireAuth.js')).requireAuth({project:'emestreamhalloween',...account,nonInteractive:true});const {Client}=require(join(root,'apiv2.js'));const api=new Client({urlPrefix:'https://storage.googleapis.com',apiVersion:'storage/v1'});
const path='/b/emestreamhalloween.firebasestorage.app';const meta=(await api.get(path,{queryParams:{fields:'cors,metageneration'}})).body;
const origins=['https://ayoublk.github.io','https://emestreamhalloween.web.app','https://emestreamhalloween.firebaseapp.com'];
const cors=[...(meta.cors||[])];
if(!cors.some(rule=>origins.every(origin=>rule.origin?.includes(origin))&&['GET','HEAD'].every(method=>rule.method?.includes(method)))){
 cors.push({origin:origins,method:['GET','HEAD'],responseHeader:['Content-Type','Content-Length'],maxAgeSeconds:3600});
 await api.patch(path,{cors},{queryParams:{ifMetagenerationMatch:meta.metageneration}});
 console.log('Read-only CORS enabled for the three game hosting origins. Existing rules retained.');
}else console.log('PDF CORS already configured.');
