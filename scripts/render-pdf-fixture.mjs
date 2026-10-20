// Visual QA fixture only: no Firebase and no paid generation.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {jsPDF} from 'jspdf';
import * as game from '../functions/core.mjs';
import {createRecapPdf} from '../dist/pdf-export.mjs';
const room=game.newRoom('host');room.code='PDFQA9';room.phase='finished';room.winners=['p8'];
const submissions={};
for(let i=0;i<9;i++){
 const id=`p${i}`;room.players.push({id,name:['Mina','Docteur VHS','La Momie','Zuko','Azula','Comte Nanar','Béatrice','Fantôme','La Gagnante'][i]});room.scores[id]=i*3;
 submissions[id]={answers:['Guillermo del Toro','Alain Chabat et Adèle Exarchopoulos','Stéphane Bern','folklore','Le fantôme d’un maître-nageur municipal','Un sifflet retentit dans une piscine vide','Un monstre en mousse qui prend l’eau','Un exorcisme en aquagym synchronisée',`Le pédiluve de la mort ${i+1}`],synopsis:'Dans une piscine municipale abandonnée, un maître-nageur fantôme impose son règlement aux visiteurs. Un duo intrépide tente un exorcisme en aquagym, tandis qu’un monstre en mousse prend dangereusement l’eau. Pour quitter les lieux, chacun devra traverser le terrible pédiluve maudit.',images:['poster','scene1','scene2']};
}
submissions.p1.answers[7]=('Une scène qui n’en finit plus : éclairage étrange, costumes fluo et fantômes mal coiffés. ').repeat(5).slice(0,500);
submissions.p2.images[1]='missing';
const fonts={regular:readFileSync('dist/fonts/Vera.ttf').toString('base64'),bold:readFileSync('dist/fonts/VeraBd.ttf').toString('base64')};
const result=await createRecapPdf(game.exportReport(room,submissions),{jsPDF,fonts,loadImage:async name=>{if(name==='missing')throw Error('Unavailable fixture image');return {data:new Uint8Array(readFileSync(`artifacts/pdf-qa/${name}.jpg`)),width:name==='poster'?800:1200,height:name==='poster'?1200:800};}});
mkdirSync('artifacts/pdf-qa',{recursive:true});writeFileSync('artifacts/pdf-qa/recap.pdf',Buffer.from(result.doc.output('arraybuffer')));
console.log(JSON.stringify({pages:result.pages,missingImages:result.missingImages,file:'artifacts/pdf-qa/recap.pdf'}));
