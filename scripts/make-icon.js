'use strict';
// Vygeneruje build/icon.png a build/icon.ico (spuštění: npx electron scripts/make-icon.js)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 256;
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17a35a"/><stop offset="1" stop-color="#0b6a39"/></linearGradient></defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <g transform="translate(48 48) scale(6.67)" fill="#fff">
    <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: true, frame: false, transparent: true, useContentSize: true, resizable: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const png = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE }).toPNG();
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), png);
  // ICO s jedním PNG obrázkem 256×256
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(0, 6); head.writeUInt8(0, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, png]));
  console.log('Ikona vytvořena:', out);
  app.quit();
});
