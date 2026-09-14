const fs=require('fs'),path=require('path'),vm=require('vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
async function load(name){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented: (HTMLCanvasElement|navigation)/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(fs.readFileSync(path.join(root,name),'utf8'),{url:'https://offline.test/'+name,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.confirm=()=>true;w.alert=()=>{};w.fetch=async()=>{throw Error('Network disabled in regression tests');};
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:()=>({width:20}),canvas:{width:800,height:300}},{get:(o,k)=>k in o?o[k]:()=>{}});
 w.Chart=class{constructor(){this.data={};this.options={}}destroy(){}update(){}resize(){}};w.Chart.register=()=>{};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}};
 w.addEventListener('error',e=>errors.push(e.error&&e.error.stack||e.message));
 for(const script of w.document.querySelectorAll('script')){
  if(script.src){const url=new URL(script.src);if(url.hostname==='offline.test'){
    const file=path.join(root,url.pathname);
    if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),dom.getInternalVMContext(),{filename:url.pathname});
  }}else try{vm.runInContext(script.textContent,dom.getInternalVMContext(),{filename:name});}catch(e){errors.push(e.stack);}
 }
 await new Promise(r=>setTimeout(r,30));return {dom,w,errors};
}
module.exports={load};
