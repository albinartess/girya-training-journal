'use strict';
const {readdirSync,readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
for(const dir of ['server','dist'])for(const f of readdirSync(dir))if(/\.(cjs|js)$/.test(f))execFileSync(process.execPath,['--check',path.join(dir,f)]);
for(const file of ['index.html','sw.js','auth-ui.js','auth.css'])if(!readFileSync(path.join('dist',file)).length)throw Error('Missing public asset');
console.log('Server and public shell validated; no bundling required.');
