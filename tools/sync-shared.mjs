// js/logic.js の <shared-match> 部分を、写真の受け口（Edge Function）へ写す
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const re = /\/\/ <shared-match>\n([\s\S]*?)\/\/ <\/shared-match>/;
const src = readFileSync(root + 'js/logic.js', 'utf8').match(re)[1];
const fp = root + 'supabase/functions/ingest-photo/index.ts';
const fn = readFileSync(fp, 'utf8').replace(re, () => `// <shared-match>\n${src}// </shared-match>`);
writeFileSync(fp, fn);
console.log('synced', src.split('\n').length, 'lines');
