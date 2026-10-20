import {copyFileSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
copyFileSync('functions/core.mjs','dist/core.mjs');
copyFileSync('functions/core.mjs','image-functions/core.mjs');
const modules=['app.js','core.mjs','async-actions.mjs','config.js','pdf-export.mjs','ui-feedback.mjs'];
mkdirSync('dist/vendor',{recursive:true});
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js','dist/vendor/jspdf-4.2.1.umd.min.js');
copyFileSync('node_modules/jspdf/LICENSE','dist/vendor/jspdf-LICENSE.txt');
const hash=createHash('sha256');
for(const file of [...modules,'style.css','resilience.css'])hash.update(file).update(readFileSync(`dist/${file}`));
const version=hash.digest('hex').slice(0,12);
const assets=`dist/assets/${version}`;
mkdirSync(assets,{recursive:true});
for(const file of modules)copyFileSync(`dist/${file}`,`${assets}/${file}`);
const html=readFileSync('dist/index.html','utf8')
 .replace(/src="[^"]*app\.js(?:\?[^"]*)?"/,`src="./assets/${version}/app.js"`)
 .replace(/href="\.\/style\.css(?:\?[^"]*)?"/,`href="./style.css?v=${version}"`)
 .replace(/href="\.\/resilience\.css(?:\?[^"]*)?"/,`href="./resilience.css?v=${version}"`);
writeFileSync('dist/index.html',html);
console.log('Site statique prêt dans dist/');
