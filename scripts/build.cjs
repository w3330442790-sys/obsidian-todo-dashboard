const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');const names=['core','store','journal','reflection','dashboard','codex-client','generation','assistant','journal-view','home-summary','xftj-bridge','share-reader','documents','course','course-view','views','plugin'];
const parts=names.map(n=>{const code=fs.readFileSync(path.join(root,'src',n+'.cjs'),'utf8');new vm.Script(code,{filename:n+'.cjs'});return `${JSON.stringify('./'+n+'.cjs')}:function(module,exports,require){\n${code}\n}`;});
const out=`/* Todo 工作台 · MIT */\nconst nativeRequire=require;const factories={${parts.join(',\n')}};const cache={};function localRequire(id){if(!factories[id])return nativeRequire(id);if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,localRequire);}return cache[id].exports;}module.exports=localRequire('./plugin.cjs');\n`;
new vm.Script(out);fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','main.js'),out);
fs.copyFileSync(path.join(root,'manifest.json'),path.join(root,'dist','manifest.json'));fs.writeFileSync(path.join(root,'dist','styles.css'),['styles.css','styles-layout.css','styles-v3.css','styles-compact.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n'));
console.log('Built dist/main.js, manifest.json, styles.css');
