# Evidence zakázek

Víceuživatelská evidence zakázek a faktur pro firemní síť. Je to samostatný program pro Windows (okno aplikace, ne prohlížeč); všechny počítače sdílejí jednu databázi ve sdílené složce. Návrh zavedení: [NAVRH-ZAVEDENI.md](NAVRH-ZAVEDENI.md).

## Spuštění

```bash
npm install          # jednou (stáhne Electron)
npm start            # okno aplikace, data ve složce data\
npm run demo         # totéž + ukázková data do prázdné databáze
npm run build        # přenosný program: dist\Evidence zakazek-win32-x64\Evidence zakazek.exe
npm run setup        # instalační program: dist-setup\Evidence-zakazek-Setup-*.exe
```

Kde je databáze, určuje `dataDir` v `app\config.json` (u nainstalovaného programu v `%APPDATA%\EvidenceZakazek\config.json`). Pro sdílenou složku např. `"//server/firma/Zakazky/data"`. Zálohy se ukládají do sousední složky `backup`.

## Instalační program pro ostatní počítače

Sestavení (na vývojovém PC; před sestavením zavřete běžící aplikaci z `dist`):

```powershell
cd C:\Users\ondra\Documents\eZAKAZKY
npm install
npm run setup
```

Vznikne **`dist-setup\Evidence-zakazek-Setup-<verze>.exe`** (cca 100 MB) – tento jediný soubor dáte kolegům.

Instalace na každém PC (bez práv správce):

1. Spustit `Evidence-zakazek-Setup-*.exe`, dvakrát `Další`.
2. Na stránce **Umístění dat** vybrat (tlačítko Procházet) nebo napsat **sdílenou složku**, kde budou informace o zakázkách, např. `\\server\firma\Zakazky`. Instalátor ověří zápis a vytvoří v ní `data` (databáze) a `backup` (zálohy). Na všech PC se zadává stejná složka.
3. `Instalovat` – program se nainstaluje do `%LOCALAPPDATA%\Programs`, vznikne zástupce na ploše a v nabídce Start. Odinstalovat jde standardně přes Nastavení → Aplikace (data ve sdílené složce zůstanou).

Žádný server se nespouští ani nerestartuje ručně – databázový modul je součástí programu.

* **Aktualizace:** program se sám podívá na novou verzi (po startu a pak každé 4 hodiny) a v horní liště nabídne tlačítko **Nová verze … – stáhnout**; po stažení **Restartovat a aktualizovat**. Ruční kontrola: tlačítko s kruhovou šipkou (jeho popisek ukazuje nainstalovanou verzi). Data a nastavení zůstanou. Ruční cesta: nový Setup spustit přes stávající instalaci a pole se složkou nechat prázdné.
* **Tichá instalace** (správce, skript): `Evidence-zakazek-Setup-<verze>.exe /S /DATADIR=\\server\firma\Zakazky`
* **Nastavení** je v `%APPDATA%\EvidenceZakazek\config.json` (položka `dataDir`). Když složka chybí nebo není dostupná, program nabídne „Vybrat jinou složku…“; při spuštění bez nastavení se zeptá na složku sám.
* **Přenosná varianta** bez instalátoru: `npm run build` vytvoří složku `dist\Evidence zakazek-win32-x64`, kterou stačí zkopírovat a spustit `Evidence zakazek.exe` (při prvním spuštění se zeptá na složku s daty).
* Instalátor není digitálně podepsaný, Windows může zobrazit upozornění „Neznámý vydavatel“.

## Vydání nové verze (pro vývojáře)

Aktualizace se berou z GitHub Releases repozitáře [0NDINEK/eZAKAZKY](https://github.com/0NDINEK/eZAKAZKY).

1. Zvýšit `version` v `package.json` (např. 0.4.0 → 0.4.1).
2. `git commit` + `git push`.
3. `npm run release` – sestaví instalátor a vytvoří vydání `v<verze>` s `Setup.exe`, `.blockmap` a `latest.yml` (vyžaduje přihlášené `gh`).

Nainstalované programy si novou verzi nabídnou samy. Pozor: všechny počítače sdílejí jednu databázi, proto po vydání aktualizujte všechny včas, zvlášť pokud nová verze mění strukturu databáze.

## Co umí

* Zakázky `xx/rrrr` (další číslo se nabídne samo), odběratel, lokalita.
* Faktury `Fx/rrrr` (číslo zadáváte ručně) s volitelným datem zaevidování, víc faktur k jedné zakázce.
* **Detail zakázky** (klik na řádek): údaje, faktury a poznámky s autorem a časem. Poznámku může upravit/smazat jen její autor.
* **Záložky s roky**: přepínání mezi roky; starý rok jde **schovat** (nesmaže se, schová se pro všechny uživatele) a kdykoli znovu zobrazit na záložce „Skryté roky“.
* Hledání (i v poznámkách), filtry, řazení, stránkování, export do CSV pro Excel.
* Souběžná práce více lidí: kontrola duplicit, upozornění na změnu kolegou, živé obnovování.
* Klávesy: `Ctrl+N` nová zakázka, `Ctrl+F` hledat, `Esc` zavřít detail, `Ctrl +/-/0` velikost.

## Struktura

```
app\main.js        okno aplikace (Electron)
app\server.js      databázový modul (Node.js, SQLite je součástí, bez dalších balíčků)
app\public\        uživatelské rozhraní
app\config.json    nastavení pro vývoj
scripts\build.js   sestavení programu;  scripts\make-icon.js  vygenerování ikony
```

Bez Electronu jde jádro spustit i z příkazové řádky: `node app/server.js --demo --data ./tmp --port 3100` (otevře se v prohlížeči na `http://127.0.0.1:3100`); používá se pro vývoj a zkoušky.

## Autor

Ondřej Frolík
