const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');const names=['schedule','schedule-view','plans-view','core','store','journal','reflection','dashboard','codex-client','generation','assistant','journal-view','home-summary','xftj-bridge','share-reader','documents','lesson','local-course','course','course-view','views','global-theme','file-order','explorer-drag','explorer-order-sync','explorer-order','easyscholar','publication-lookup','literature','literature-view','literature-pdf','literature-reader','plugin'];
const parts=names.map(n=>{const code=fs.readFileSync(path.join(root,'src',n+'.cjs'),'utf8');new vm.Script(code,{filename:n+'.cjs'});return `${JSON.stringify('./'+n+'.cjs')}:function(module,exports,require){\n${code}\n}`;});
const sceneryDir=path.join(root,'assets','scenery');
const scenery=JSON.parse(fs.readFileSync(path.join(sceneryDir,'credits.json'),'utf8')).map(photo=>({
 ...photo,src:'data:image/webp;base64,'+fs.readFileSync(path.join(sceneryDir,photo.file)).toString('base64')
}));
parts.push(`"../assets/scenery/credits.json":function(module){module.exports=${JSON.stringify(scenery)};}`);
const out=`/* Todo 工作台 · MIT */\nconst nativeRequire=require;const factories={${parts.join(',\n')}};const cache={};function localRequire(id){if(!factories[id])return nativeRequire(id);if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,localRequire);}return cache[id].exports;}module.exports=localRequire('./plugin.cjs');\n`;
new vm.Script(out);fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','main.js'),out);
fs.copyFileSync(path.join(root,'manifest.json'),path.join(root,'dist','manifest.json'));fs.writeFileSync(path.join(root,'dist','styles.css'),['styles.css','styles-layout.css','styles-v3.css','styles-compact.css','styles-planning.css','styles-mobile.css','styles-theme.css','styles-congrong.css','styles-bright.css','styles-literature.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n'));
const themeDir=path.join(root,'theme');
const theme=JSON.parse(fs.readFileSync(path.join(themeDir,'manifest.json'),'utf8'));
const themeOut=path.join(root,'dist','themes',theme.name);
fs.mkdirSync(themeOut,{recursive:true});
for(const name of ['manifest.json','theme.css'])fs.copyFileSync(path.join(themeDir,name),path.join(themeOut,name));
console.log('Built dist/main.js, manifest.json, styles.css and dist/themes/'+theme.name);
