const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');let n=0;
for(const name of fs.readdirSync(root)){
 const p=path.join(root,name);if(name.endsWith('.html')){const text=fs.readFileSync(p,'utf8');for(const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){if(m[1].trim()){new vm.Script(m[1],{filename:name});n++;}}
 for(const m of text.matchAll(/(?:src|href)=["'](\.\/)?(shared\/[^"'?]+)(?:\?[^"']*)?["']/g))assert(fs.existsSync(path.join(root,m[2])),name+' '+m[2]);
 }else if(name.endsWith('.gs')){new vm.Script(fs.readFileSync(p,'utf8'),{filename:name});n++;}}
for(const name of fs.readdirSync(path.join(root,'shared'))){if(name.endsWith('.js')){new vm.Script(fs.readFileSync(path.join(root,'shared',name),'utf8'),{filename:name});n++;}}
console.log('PASS: syntax and local asset references ('+n+' scripts)');
