'use strict';
// Sestaví přenosnou aplikaci pro Windows do složky dist\ (npm run build).
const { packager } = require('@electron/packager');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

(async () => {
  const [out] = await packager({
    dir: root,
    out: (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || path.join(root, 'dist'),
    name: 'Evidence zakazek',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, 'build', 'icon.ico'),
    appVersion: pkg.version,
    appCopyright: `© ${new Date().getFullYear()} ${pkg.author}`,
    win32metadata: { CompanyName: 'Ondřej Frolík', ProductName: 'Evidence zakázek', FileDescription: 'Evidence zakázek', InternalName: 'EvidenceZakazek', OriginalFilename: 'Evidence zakazek.exe' },
    // do balíčku patří jen program; data, zálohy, dokumentace a nástroje ne
    ignore: [/^\/(data|backup|dist|dist-setup|scripts|NAVRH-ZAVEDENI\.md|README\.md|package-lock\.json)(\/|$)/, /^\/\.claude/, /^\/app\/config\.json$/],
  });

  // z Chromia nechat jen české a anglické jazykové soubory (úspora místa)
  const loc = path.join(out, 'locales');
  for (const f of fs.readdirSync(loc)) if (!/^(cs|en-US).pak$/.test(f)) fs.unlinkSync(path.join(loc, f));

  console.log('Hotovo:', out);
})().catch((e) => { console.error(e); process.exit(1); });
