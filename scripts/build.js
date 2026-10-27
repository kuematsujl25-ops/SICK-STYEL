import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(config.assets?.directory!=='./public')throw Error('静的ファイルの出力先を確認してください');
for(const file of ['public/index.html','public/amazon-insights.js','public/app.js','public/ai-csv.js','public/ai-team.js','public/notifications.js','public/overdue.js','public/ai-catalog.js','public/integration-status.js','public/style.css','public/manifest.webmanifest','public/icon-192.png','public/icon-512.png','public/sw.js','public/offline.html','api/index.js'])if(!existsSync(file))throw Error('不足ファイル: '+file);
for(const file of ['api/index.js','lib/ai-team.js','lib/ai-team-storage.js','lib/ai-team-errors.js','lib/store.js','lib/domain.js','lib/security.js','lib/site.js','lib/notifications.js','lib/web-push.js','integrations/instagram.js','integrations/amazon.js','public/amazon-insights.js','public/app.js','public/ai-csv.js','public/ai-team.js','public/ai-catalog.js','public/integration-status.js','public/notifications.js','public/overdue.js','public/sw.js']){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status);}
const {validate,empty}=await import('../lib/domain.js');validate(empty());await import('../api/index.js');
console.log('Build checks passed: static assets, manifest, API imports, syntax, domain validation. No database is touched at build time.');
