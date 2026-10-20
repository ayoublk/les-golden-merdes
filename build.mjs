import {copyFileSync} from 'node:fs';
copyFileSync('functions/core.mjs','dist/core.mjs');
copyFileSync('functions/core.mjs','image-functions/core.mjs');
console.log('Site statique prêt dans dist/');
