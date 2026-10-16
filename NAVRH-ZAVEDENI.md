# Evidence zakázek – návrh zavedení ve firmě

Cíl: jedna společná evidence zakázek (číslo `xx/rrrr`, odběratel, lokalita, faktury `Fx/rrrr` s volitelným datem zaevidování a poznámky), se kterou pracuje více lidí z různých počítačů ve firemní síti. Bez internetu, bez cloudu.

**Rozhodnutí:** databáze je ve složce na sdíleném disku, na každém počítači běží samostatné okno aplikace (Windows program, ne webový prohlížeč).

## 1. Architektura

```
  PC 1                  PC 2                  PC 3
  Evidence zakazek.exe  Evidence zakazek.exe  Evidence zakazek.exe
  (okno aplikace +      (okno aplikace +      (okno aplikace +
   malý lokální          malý lokální          malý lokální
   databázový modul)     databázový modul)     databázový modul)
        \                    |                   /
         \_________ sdílený disk ________________/
          \\server\firma\Zakazky\
            ├─ data\     zakazky.db                – společná databáze
            └─ backup\   zakazky-RRRR-MM-DD.db     – automatické denní zálohy (30 dní)
```

* **Klient je samostatný program** `Evidence zakazek.exe` (Electron – vlastní okno, ikona na hlavním panelu, tmavý/světlý vzhled podle Windows). Nepotřebuje Node.js, prohlížeč ani internet. Uvnitř je zabudovaný databázový modul, který na tomto PC naslouchá jen na `127.0.0.1` a je chráněný náhodným klíčem platným pro dané okno, takže se k němu nedostane jiný program ani jiný počítač.
* **Konfigurace** je v `%APPDATA%\EvidenceZakazek\config.json` (zapisuje ji instalátor); jediné, co se nastavuje, je `dataDir` (cesta ke sdílené složce s databází). Přežije aktualizaci programu.
* **Uživatel** se pozná podle přihlášeného Windows účtu; zapisuje se do historie změn a k poznámkám. Nikdo nic nezadává.
* **Aktualizace** = nová verze programu se rozkopíruje na PC (viz 4. Postup zavedení). Databáze se při novém spuštění upraví sama.

Vytvoření instalačního programu z tohoto projektu:

```powershell
npm install
npm run setup     # vznikne dist-setup\Evidence-zakazek-Setup-*.exe (cca 100 MB)
```

## 2. Souběžná práce více lidí nad jedním souborem

Databázový soubor otevřený přes síťový disk je u SQLite podporovaný jen s omezeními. Aplikace je proto navržená tak, aby je dodržela:

* **Krátké transakce** – každé uložení trvá milisekundy a běží pod zámkem databáze; při souběhu druhý zápis krátce počká (až 10 s) a pak proběhne.
* **Číslo zakázky se přiděluje uvnitř transakce** (další volné v daném roce) a databáze hlídá unikátnost (`UNIQUE(rok, pořadí)`). Dva lidé nikdy nedostanou stejné číslo.
* **Režim žurnálu `DELETE`, ne `WAL`** – WAL nefunguje přes síťové disky, proto se nepoužívá.
* **Verze záznamů** – pokud kolega zakázku nebo fakturu mezitím změnil, uložení se nepřepíše potichu; uživatel dostane upozornění a aktuální data.
* **Živé obnovování** – aplikace každé 4 s kontroluje čítač změn v databázi a načte novinky; otevřený detail zakázky se aktualizuje sám (rozepsaná poznámka se nepřepíše).
* **Automatická záloha** – při prvním spuštění každého dne se vytvoří konzistentní kopie databáze do `backup\` a starší než 30 dní se mažou.

### Rizika (upřímně)

Zámky souborů přes SMB nejsou spolehlivé stoprocentně. Pro malý tým (do cca 5–10 lidí, zápisy jednotky za minutu) to v praxi funguje, ale platí:

| Riziko | Opatření |
|---|---|
| PC se odpojí od sítě uprostřed zápisu (Wi-Fi, uspání) | Pracovat na kabelu; databáze má `synchronous=FULL`, neúplný zápis se zahodí |
| Poškození souboru | Denní automatické zálohy + týdenní kopie mimo disk; obnova = zkopírovat soubor zpět |
| Sdílená složka synchronizovaná cloudem (OneDrive, Dropbox, Google Drive) | **Nepoužívat** – synchronizace soubor poškozuje. Musí to být běžný síťový disk (Windows server/NAS přes SMB) |
| Antivir/SmartScreen blokuje neznámý `.exe` | Program není digitálně podepsaný; IT povolí výjimku pro složku programu (nebo se pořídí podpisový certifikát) |
| Pomalá síť (VPN, vzdálená pobočka) | Pro vzdálené pobočky nevhodné → varianta s centrálním serverem |

**Cesta ven, kdyby se sdílený soubor neosvědčil:** databázový modul se spustí jen na jednom stále zapnutém PC (`node app\server.js --host 0.0.0.0`) a v `config.json` ostatních počítačů se místo `dataDir` nastaví `"serverUrl": "http://jmeno-pc:3000"`. Okna aplikace se pak jen připojí. Databázový soubor otevírá jediný proces, takže odpadají rizika sdílení souboru. Data ani vzhled se nemění (v tomto režimu se uživatel při prvním spuštění představí jménem).

## 3. Pravidla, která systém hlídá

* **Číslo zakázky** `xx/rrrr` – při založení se nabídne další volné v roce, je unikátní; ruční zadání (zpětné doplnění) je možné, duplicita se odmítne.
* **Číslo faktury** `Fx/rrrr` – zadává se ručně (x = pořadí, rrrr = rok), unikátní napříč všemi zakázkami. Při duplicitě systém řekne, u které zakázky už existuje.
* **Datum zaevidování** je u každé faktury volitelné.
* **Detail zakázky** – kliknutím na řádek se otevře panel s údaji, fakturami a poznámkami.
* **Poznámky** – u zakázky může být libovolně mnoho poznámek s autorem a časem (nejnovější nahoře). Přidávat může každý, **upravit nebo smazat jen autor**. Poznámky jdou prohledávat a jsou součástí exportu do CSV.
* **Roky** – nad seznamem jsou záložky s roky. Starý rok jde **schovat** tlačítkem „Schovat rok“ (nic se nemaže): zmizí ze seznamu, přehledů i hledání, ale zůstane na záložce „Skryté roky“, odkud ho lze kdykoli znovu zobrazit. Skrytí platí pro všechny uživatele a zapisuje se do historie změn. Do skrytého roku nejde založit novou zakázku.
* **Vzhled** – tlačítko v horní liště přepíná automaticky (podle Windows) / světlý / tmavý; volba se pamatuje pro daného uživatele Windows.
* **Historie změn** – tabulka `audit` (kdo, kdy, co) v databázi; obrazovka s historií může přibýt později.

## 4. Postup zavedení

| Fáze | Délka | Co se děje |
|---|---|---|
| 0. Příprava | 1–2 dny | Vybrat a založit sdílenou složku `Zakazky` (běžný síťový disk, přístup jen pro určené lidi, oprávnění „změnit“ na podsložky `data` a `backup`). Určit správce systému. |
| 1. Instalace | 0,5 dne | Na jednom PC `npm run setup` → soubor `Evidence-zakazek-Setup-*.exe`. Na každém PC ho spustit (bez práv správce), na stránce „Umístění dat“ vybrat sdílenou složku; program se nainstaluje se zástupcem na ploše. Vyzkoušet práci z více PC najednou. |
| 2. Import stávající evidence | 1–2 dny | Pokud se zakázky vedou v Excelu: jednorázový import z CSV (číslo, odběratel, lokalita, faktury). Zkontrolovat duplicity a překlepy v číslech. |
| 3. Pilot | 2 týdny | 2–3 uživatelé pracují v novém systému souběžně se starou evidencí. Sbírat připomínky (chybějící sloupce, filtry, export). |
| 4. Ostrý provoz | 1 den | Program na všechna PC, 30 min školení, stará evidence jen pro čtení. |
| 5. Provoz | trvale | Kontrola záloh, občasná zkouška obnovy, aktualizace, drobné úpravy. |

Program je nejlepší mít na každém PC lokálně (rychlý start). Spouštět ho ze sdílené složky jde také, ale je pomalejší (320 MB).

## 5. Provoz

* **Zálohy** dělá aplikace sama do `backup\`. Doplnit je o zálohu celé složky `Zakazky` v rámci běžné firemní zálohy (nebo týdenní kopie na externí disk).
* **Obnova**: všichni zavřou aplikaci, zkopíruje se vybraná záloha jako `data\zakazky.db`, aplikace se spustí.
* **Aktualizace programu**: zkopírovat novou složku přes starou (ponechat `config.json`). Nové verze umí otevřít starší databázi a doplní si chybějící tabulky.
* **Oprávnění**: čtení/zápis do složek `data\` a `backup\` mají všichni uživatelé aplikace.

## 6. Bezpečnost a oprávnění

* Přístup k datům = přístup do sdílené složky (řídí se oprávněními disku). Kdo složku nevidí, evidenci neotevře.
* Role uvnitř aplikace (čtenář / zapisovatel / správce) zatím nejsou. Případně přibudou; vyžaduje to rozhodnutí, kdo smí mazat a exportovat.
* Mazání zakázek a faktur je zatím natrvalo, ale zůstává záznam v historii. Lze změnit na „měkké mazání“ s možností obnovy.

## 7. Co potřebuji vědět (rozhodnutí na vaší straně)

1. Kolik lidí bude systém používat a kolik z nich zapisuje? (Hranice pro sdílený soubor je cca 5–10 zapisujících.)
2. Je sdílený disk běžný síťový disk Windows/NAS, nebo synchronizovaná složka (OneDrive apod.)? Druhá možnost nejde.
3. Kde je dnes evidence (Excel? papír?) a kolik zakázek je potřeba převést?
4. Potřebujete další údaje u zakázky (stav, částka, termín, přílohy)? Je lepší je znát před importem dat.
5. Má se číslování zakázek každý rok začínat od `01`? (Koncept tak počítá.)
6. Chcete digitálně podepsat program (certifikát), aby ho Windows a antivir neoznačovaly jako neznámý?
