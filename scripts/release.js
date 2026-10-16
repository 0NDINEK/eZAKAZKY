'use strict';
// Vydání nové verze (npm run release): sestaví instalátor a nahraje ho na GitHub Releases,
// odkud si ho nainstalované programy samy stáhnou. Vyžaduje přihlášené `gh` (gh auth login).
//
// Postup: 1) zvýšit "version" v package.json  2) commit + push  3) npm run release
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const tag = `v${pkg.version}`;
const out = path.join(root, 'dist-setup');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, shell: process.platform === 'win32' }).toString().trim();

if (read('git', ['status', '--porcelain'])) {
  console.error('Jsou neuložené změny. Nejdřív je commitněte a pushněte (git commit, git push).');
  process.exit(1);
}
let exists = true;
try { read('gh', ['release', 'view', tag]); } catch { exists = false; }
if (exists) {
  console.error(`Vydání ${tag} už existuje. Zvyšte "version" v package.json.`);
  process.exit(1);
}

run('npm', ['run', 'setup']);

const files = [`Evidence-zakazek-Setup-${pkg.version}.exe`, `Evidence-zakazek-Setup-${pkg.version}.exe.blockmap`, 'latest.yml'].map((f) => path.join(out, f));
for (const f of files) if (!fs.existsSync(f)) { console.error('Chybí soubor ' + f); process.exit(1); }

run('gh', ['release', 'create', tag, ...files.map((f) => `"${f}"`), '--title', `"Evidence zakázek ${pkg.version}"`, '--generate-notes']);
console.log(`Hotovo: vydání ${tag} je zveřejněno, programy se samy nabídnou k aktualizaci.`);
