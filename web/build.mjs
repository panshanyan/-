// 打包：node web/build.mjs  →  app/src/main/assets/index.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
const r = await build({ entryPoints: ['web/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2019' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('web/index.html', 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync('app/src/main/assets/index.html', html);
console.log('index.html', (html.length / 1024).toFixed(0), 'KB');
