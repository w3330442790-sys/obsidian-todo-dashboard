'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('the theme offers two native color schemes and the plugin uses the matching modes',()=>{
 const css=fs.readFileSync('theme/theme.css','utf8');
 const {selectScheme,usesThemeHome}=require('../src/global-theme.cjs');
 assert.match(css,/\.theme-light\s*\{[^}]*--background-primary:\s*#f8f4ec/i);
 assert.match(css,/\.theme-dark\s*\{[^}]*--background-primary:\s*#101821/i);
 const calls=[];
 const app={changeTheme:mode=>calls.push(mode)};
 assert.equal(selectScheme(app,'warm'),true);
 assert.equal(selectScheme(app,'night'),true);
 assert.equal(selectScheme(app,'invalid'),false);
 assert.equal(selectScheme({},'warm'),false);
 assert.deepEqual(calls,['moonstone','obsidian']);
 assert.equal(usesThemeHome(true,{}),true);
 assert.equal(usesThemeHome(true,{congrongHome:false}),false);
 assert.equal(usesThemeHome(false,{}),false);
});
