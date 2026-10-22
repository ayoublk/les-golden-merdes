import {imageLabels} from './core.mjs';
const ink=[30,34,29],muted=[99,105,95],orange=[173,77,34],paper=[246,244,237];
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\u2011-\u2015]/g,'-');
// Shared with the Node render tests; all image and font IO is injected.
export async function createRecapPdf(report,{jsPDF,fonts,loadImage,onProgress=()=>{}}){
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
 doc.addFileToVFS('Vera.ttf',fonts.regular);doc.addFont('Vera.ttf','Vera','normal');
 doc.addFileToVFS('VeraBd.ttf',fonts.bold);doc.addFont('VeraBd.ttf','Vera','bold');
 doc.setProperties({title:`Les Golden Merdes - salon ${clean(report.code)}`,subject:'Films, questionnaires et palmarès de la soirée Halloween',author:'Le Septième Stream',creator:'Les Golden Merdes'});
 let y=30,section='LES ARCHIVES DE LA SÉANCE',missingImages=0;
 const margin=18,width=174,bottom=276;
 function font(size=10,bold=false,color=ink){doc.setFont('Vera',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);}
 function page(label=section,first=false){section=label;if(!first)doc.addPage();doc.setFillColor(...orange);doc.rect(margin,15,12,1.2,'F');font(7,false,muted);doc.text(clean(label),margin+17,17);y=31;}
 function ensure(height){if(y+height>bottom)page();}
 function text(value,{size=10,bold=false,color=ink,gap=4,line=size*.5,w=width,x=margin}={}){
  font(size,bold,color);const lines=doc.splitTextToSize(clean(value),w);
  for(const value of lines){ensure(line);font(size,bold,color);doc.text(value,x,y);y+=line;}
  y+=gap;
 }
 async function image(url,x,top,w,h,label){
  doc.setFillColor(...paper);doc.rect(x,top,w,h,'F');let value;
  try{value=url?await loadImage(url):null;if(value){const ratio=Math.min(w/value.width,h/value.height),dw=value.width*ratio,dh=value.height*ratio;doc.addImage(value.data,'JPEG',x+(w-dw)/2,top+(h-dh)/2,dw,dh,undefined,'FAST');return;}}catch{/* A missing image must not prevent the rest of the report. */}
  missingImages++;font(9,false,muted);doc.text(label+' indisponible',x+w/2,top+h/2,{align:'center'});
 }
 page('LE SEPTIÈME STREAM / SPÉCIALE HALLOWEEN',true);
 y=65;text('LES\nGOLDEN\nMERDES.',{size:34,bold:true,line:17,gap:15});
 text('LE RÉCAPITULATIF DE LA SOIRÉE',{size:12,bold:true,color:orange,gap:9});
 text(`${report.films.length} films imaginés entre amis.\nLes idées, les images et le palmarès.`,{size:12,line:7,gap:14});
 text(`Salon ${report.code}\nExport du ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(report.exportedAt))}`,{size:9,color:muted,line:5});
 for(let index=0;index<report.films.length;index++){
  const film=report.films[index],label=`FILM ${String(index+1).padStart(2,'0')} / ${report.films.length} - ${film.author}`;
  onProgress(`Préparation du PDF : film ${index+1} / ${report.films.length}…`);
  page(label);text(film.title,{size:21,bold:true,line:10,gap:5});
  text(`Imaginé par ${film.author}  /  ${film.points} point${film.points>1?'s':''}`,{size:10,color:orange,gap:10});
  ensure(135);const top=y;
  await image(film.images[0],margin,top,83,124,'Affiche');
  y=top+4;text('LE SYNOPSIS',{size:9,bold:true,color:orange,w:79,x:113,gap:5});
  text(film.synopsis||'Le synopsis n’a pas été généré pour ce film.',{size:10,line:5.5,w:79,x:113,gap:8});
  text(film.answers[3]||'',{size:9,bold:true,color:muted,w:79,x:113});
  y=Math.max(y,top+132);
  page(label+' / LES RÉPONSES');text('LES NEUF MAUVAISES IDÉES',{size:17,bold:true,gap:9});
  for(let q=0;q<report.questions.length;q++){
   font(9,true);const question=doc.splitTextToSize(`${String(q+1).padStart(2,'0')}. ${clean(report.questions[q])}`,width);
   ensure(question.length*4.5+14);
   text(question.join('\n'),{size:9,bold:true,color:orange,line:4.5,gap:2});
   text(film.answers[q]||'Réponse indisponible',{size:10,line:5.3,gap:7});
  }
  const labels=imageLabels(film);
  page(label+' / LES SCÈNES');text(`${labels.length-1} SCÈNES DU DÉSASTRE`,{size:17,bold:true,gap:6});
  for(let i=1;i<labels.length;i++){
   ensure(113);text(`SCÈNE ${i} / ${labels[i].toUpperCase()}`,{size:8,bold:true,color:orange,gap:3,line:4});
   await image(film.images[i],margin,y,width,100,labels[i]);y+=106;
  }
 }
 const winners=report.films.filter(f=>report.winners.includes(f.id));
 // The winner is deliberately revealed only after all film dossiers.
 for(const film of winners){
  onProgress('Préparation du palmarès…');page('LE PALMARÈS / FIN DE SÉANCE');
  text('ET LE GOLDEN MERDE\nREVIENT À…',{size:23,bold:true,line:11,gap:10});
  text(film.author,{size:24,bold:true,color:orange,line:12,gap:4});
  text(`${film.points} points${winners.length>1?' / Vainqueur ex æquo':' / Vainqueur de la soirée'}`,{size:11,bold:true,gap:8});
  text(film.title,{size:14,bold:true,line:7,gap:8});
  ensure(111);await image(film.images[0],margin,y,74,111,'Affiche du film vainqueur');
 }
 if(!winners.length){page('LE PALMARÈS / FIN DE SÉANCE');text('Aucun vainqueur désigné.',{size:22,bold:true});}
 const pages=doc.getNumberOfPages();
 for(let n=1;n<=pages;n++){doc.setPage(n);doc.setDrawColor(220,220,211);doc.line(margin,284,192,284);font(7,false,muted);doc.text(`Les Golden Merdes / ${clean(report.code)}`,margin,289);doc.text(`${n} / ${pages}`,192,289,{align:'right'});}
 return {doc,missingImages,pages};
}

let libraryPromise,fontsPromise;
function library(){if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('vendor/jspdf-4.2.1.umd.min.js',document.baseURI).href;s.onload=()=>resolve(window.jspdf.jsPDF);s.onerror=()=>{libraryPromise=null;s.remove();reject(Error('Impossible de charger l’export PDF. Réessayez.'));};document.head.append(s);});return libraryPromise;}
function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
async function fonts(){if(!fontsPromise)fontsPromise=Promise.all(['Vera.ttf','VeraBd.ttf'].map(async name=>{const r=await fetch(new URL('fonts/'+name,document.baseURI),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Impossible de charger les polices du PDF.');return base64(new Uint8Array(await r.arrayBuffer()));})).then(([regular,bold])=>({regular,bold})).catch(e=>{fontsPromise=null;throw e;});return fontsPromise;}
export async function loadPdfImage(url){
 const parsed=new URL(url,document.baseURI);
 if(parsed.origin!==location.origin&&!(parsed.protocol==='https:'&&parsed.hostname==='firebasestorage.googleapis.com'))throw Error('Image hors du stockage du jeu.');
 const response=await fetch(parsed,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Image indisponible.');
 const blob=await response.blob();if(blob.size>20*1024*1024||!blob.type.startsWith('image/'))throw Error('Format d’image invalide.');
 const bitmap=await createImageBitmap(blob);
 try{const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);return {data:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height};}finally{bitmap.close();}
}
export async function downloadRecapPdf(report,onProgress){
 const [jsPDF,fontData]=await Promise.all([library(),fonts()]);
 // Reuse the winner's poster rather than fetching its pixels a second time.
 const cache=new Map();const loadImage=url=>{if(!cache.has(url))cache.set(url,loadPdfImage(url));return cache.get(url);};
 const result=await createRecapPdf(report,{jsPDF,fonts:fontData,loadImage,onProgress});
 const url=URL.createObjectURL(result.doc.output('blob')),a=document.createElement('a');a.href=url;a.download=`les-golden-merdes-${String(report.code).replace(/[^A-Z0-9]/gi,'')}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return result;
}
