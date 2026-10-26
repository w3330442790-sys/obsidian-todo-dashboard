const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');const names=['core','store','views','plugin'];
const parts=names.map(n=>{const code=fs.readFileSync(path.join(root,'src',n+'.cjs'),'utf8');new vm.Script(code,{filename:n+'.cjs'});return `${JSON.stringify('./'+n+'.cjs')}:function(module,exports,require){\n${code}\n}`;});
const out=`/* Todo 工作台 · MIT */\nconst nativeRequire=require;const factories={${parts.join(',\n')}};const cache={};function localRequire(id){if(!factories[id])return nativeRequire(id);if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,localRequire);}return cache[id].exports;}module.exports=localRequire('./plugin.cjs');\n`;
new vm.Script(out);fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','main.js'),out);
for(const f of ['manifest.json','styles.css'])fs.copyFileSync(path.join(root,f),path.join(root,'dist',f));
console.log('Built dist/main.js, manifest.json, styles.css');
