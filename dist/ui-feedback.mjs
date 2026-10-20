// Give the browser a paint opportunity before starting a network action.
// A timer keeps background tabs from waiting indefinitely for animation frames.
export function waitForPaint(){return new Promise(resolve=>{const timer=setTimeout(resolve,80);if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));});}

export function preloadResultImage(url,signal){return new Promise((resolve,reject)=>{
 const image=new Image();let settled=false;
 function finish(error){if(settled)return;settled=true;image.onload=null;image.onerror=null;signal.removeEventListener('abort',abort);error?reject(error):resolve();}
 function abort(){image.src='';finish(Error('Image loading cancelled'));}
 signal.addEventListener('abort',abort,{once:true});
 image.onload=()=>{Promise.resolve(image.decode?.()).then(()=>finish(),()=>finish());};
 image.onerror=()=>finish(Error('Image unavailable'));
 if(signal.aborted){abort();return;}
 image.src=url;
});}

// Load only the winners' visuals, with bounded concurrency and a global deadline.
// Image failures never prevent the results page from being shown.
export async function prepareResultImages(urls,{load=preloadResultImage,onProgress=()=>{},timeoutMs=6000,concurrency=4}={}){
 const unique=[...new Set(urls.filter(url=>typeof url==='string'&&url))];
 const controller=new AbortController();let cursor=0,completed=0,loaded=0;
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 onProgress({completed,loaded,total:unique.length});
 try{
  await Promise.all(Array.from({length:Math.min(concurrency,unique.length)},async()=>{
   while(cursor<unique.length&&!controller.signal.aborted){
    const url=unique[cursor++];
    try{await load(url,controller.signal);loaded++;}catch{/* Render the page even if a visual is unavailable. */}
    completed++;onProgress({completed,loaded,total:unique.length});
   }
  }));
  return {completed,loaded,total:unique.length,timedOut:controller.signal.aborted};
 }finally{clearTimeout(timer);}
}
