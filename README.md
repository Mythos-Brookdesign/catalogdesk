# CatalogDesk

Ein lokales Desktop-Werkzeug, das Lieferanten-CSV-Dateien prueft, bereinigt und als WooCommerce-Import vorbereitet. Ein Portfolio-Projekt von Marco Hinkelmann.

## Starten

Voraussetzung: Node.js 22.12 oder neuer und npm. Electron wird bei der Installation heruntergeladen.

```bash
npm ci
npm run dev
```

Startet Vite und Electron. Nur die Browseransicht: `npm run dev:web`, erreichbar unter http://127.0.0.1:5178. Der Port ist bewusst fest und darf nicht bereits belegt sein.

## Funktionen

- CSV- und TSV-Import per Dateidialog oder Drag-and-drop mit automatischer Trennzeichenerkennung.
- Spaltenzuordnung mit Vorschlaegen fuer gaengige deutsche und englische Feldnamen.
- Pruefung auf fehlende Pflichtwerte, doppelte Artikelnummern, ungueltige Preise und negative oder nicht ganzzahlige Bestaende.
- Explizite deutsche oder englische Preisformate; optionale Preisnormalisierung und Entfernung von Rand-Leerzeichen.
- Originalwerte bleiben erhalten; Aenderungen werden im Produkteditor angezeigt.
- Suche, Statusfilter, Sortierung und paginierte Produktliste.
- Manuelle Korrekturen und ausdrueckliche Ausschluesse; Export wird bei aktiven Fehlern oder fehlenden Pflichtzuordnungen blockiert.
- Bis zu 20 lokal gespeicherte Zuordnungsprofile inklusive Aufbereitungsoptionen.
- SQLite-Projektbibliothek: komplette Importarbeitsstaende speichern, aktualisieren, kopieren, wieder oeffnen und bestaetigt loeschen.
- WooCommerce-CSV fuer einfache Produkte als Entwuerfe (`Published = -1`) und separater Pruefbericht.
- Mitgelieferter Beispielkatalog mit 12 Produkten und 5 fehlerhaften Datensaetzen.

## Kurze Demo

1. **Beispieldaten laden** auswaehlen und nach **Fehlern** filtern.
2. Datensatz 3: Preis auf `129,00` setzen.
3. Datensatz 5: Bestand auf `2` setzen.
4. Datensatz 9: Artikelnummer `NL-1009` vergeben.
5. Datensatz 8 ausschliessen; damit ist die Artikelnummer von Datensatz 6 wieder eindeutig.
6. Im **Export** die CSV und den Pruefbericht speichern.

Das Ergebnis sind elf exportierbare Produkte. Die Beispieldaten sind fiktiv; Produktfotos illustrieren das Sortiment und werden nicht mitexportiert.

## Architektur

```text
React-Oberflaeche
  |-- Web Worker: Papa Parse, Validierung, Aufbereitung, CSV-Ausgabe
  |-- localStorage: versionierte und validierte Zuordnungsprofile
  `-- isolierter Preload: Datei-, Projekt- und Shopmethoden
       `-- Electron Main: native Dialoge und lesender HTTPS-API-Test
            `-- Node Worker Thread: SQLite-Projektbibliothek
```

Die fachliche Logik liegt in `src/domain/catalog.ts` und ist unabhaengig von React und Electron testbar. Der Worker verarbeitet auch Exporte ausserhalb des UI-Threads. Veraltete Analyseergebnisse werden ignoriert.

Die Browseransicht verwendet File APIs und Downloads statt Electron-IPC. Sie dient als Vorschau und ist kein Cloud-Dienst.

## Sicherheit und Daten

- Renderer mit `contextIsolation: true`, `sandbox: true` und `nodeIntegration: false`.
- Keine generische IPC- oder Dateisystem-API im Renderer. IPC prueft Fenster, Hauptframe, genaue Seiten-URL und Speichernutzlast.
- Ausgabepfade werden ausschliesslich ueber native Speicherdialoge gewaehlt.
- Produktionsassets werden ueber `catalog://app` innerhalb des App-Verzeichnisses geladen; kein privilegiertes `file://`-Frontend.
- Restriktive Produktions-CSP, keine externen Inhalte, verweigerte Berechtigungen und blockierte Navigation, Popups und Webviews.
- Spreadsheet-Formeln werden beim CSV-Export neutralisiert. Textwerte mit fuehrendem `=`, `+`, `-` oder `@` koennen deshalb einen Apostroph erhalten. Das verhindert Formelausfuehrung, kann aber solche Sonder-SKUs veraendern; vor dem Shopimport pruefen.
- Keine Telemetrie oder Produktdaten-Uploads. Schriften und Fotos werden lokal ausgeliefert. Der optionale Shop-Verbindungstest sendet API-Schluessel nur als Authorization-Header an die eingegebene HTTPS-Shopadresse.
- Gespeicherte Importprojekte bleiben in der lokalen SQLite-Datei erhalten. Nicht gespeicherte Aenderungen gehen beim Schliessen oder Neuladen verloren. Zuordnungsprofile werden weiterhin separat in localStorage gespeichert.
- Die Quelldatei wird niemals ueberschrieben. Ersatzimports und geaenderte Zuordnungen fragen vor dem Verwerfen manueller Korrekturen nach.

## Grenzen des MVP

UTF-8, maximal 10 MB und 50.000 Datensaetze pro Import. Fehlende oder doppelte Spaltenueberschriften und uneinheitliche Spaltenzahlen werden abgelehnt. Preise sind nichtnegativ, auf zwei Dezimalstellen und 999.999.999 begrenzt. Artikelnummern werden fuer die Duplikatpruefung ohne Rand-Leerzeichen und ohne Beachtung der Gross-/Kleinschreibung verglichen.

Nur einfache Produkte: keine Varianten, Bilderimporte, schreibende Shop-API, XLSX, automatische Synchronisation oder KI-Korrekturen. Kategorien koennen bereits im WooCommerce-Format (`Wohnen > Licht, Accessoires`) uebergeben werden. Eigene Steuer-, Versand- und Importregeln des Shops werden nicht geprueft.

## Lokale SQLite-Projekte

SQLite wird mit der Electron-/Node-Laufzeit ausgeliefert. Kein Datenbankserver und keine Treiberinstallation beim Endnutzer: Beim Start wird `data/catalogdesk.sqlite` im Electron-`userData`-Verzeichnis automatisch angelegt. Die Projektbibliothek zeigt den tatsaechlichen Pfad an. Das App-Paket enthaelt nur Code und Schema, niemals die persoenlichen Datenbanken anderer Nutzer. App-Updates ersetzen diese Datei nicht.

1. CSV importieren und optional korrigieren.
2. **Projekt speichern** oeffnen, einen Namen vergeben und speichern.
3. Spaetere Aenderungen mit **Projekt aktualisieren** sichern oder mit **Kopie speichern** einen getrennten Arbeitsstand anlegen.
4. Nach dem Neustart oben **Importprojekte** oeffnen und das Projekt auswaehlen.

Gespeichert werden Quelldatensaetze, Dateiname, Demo-Kennzeichen, Spaltenzuordnung, Aufbereitungsoptionen, manuelle Korrekturen und ausgeschlossene Zeilen. Beim Oeffnen wird die Analyse neu berechnet. Die Quelldatei muss dafuer nicht mehr vorhanden sein. Bis zu 100 Projekte mit jeweils 40 MB, 50.000 Zeilen und 1.000 Spalten sind moeglich. Die Speicherung erfolgt ausdruecklich per Schaltflaeche, nicht automatisch. Vor dem Ersetzen eines ungespeicherten Imports wird nachgefragt. Loeschen entfernt den gespeicherten Stand nach Bestaetigung; der aktuell geoeffnete Arbeitsstand bleibt im Speicher.

SQL-Zugriffe laufen in einem Hintergrund-Thread. Der Renderer hat nur konkrete Projektmethoden, keine freie SQL- oder Dateipfad-API. Eingaben werden validiert, Werte ueber Prepared Statements gebunden und Updates transaktional gespeichert. Eine Revisionsnummer verhindert verlorene Updates bei mehreren Fenstern; bei Konflikten erneut oeffnen oder als Kopie speichern. Das Schema ist ueber `PRAGMA user_version` versioniert; neuere unbekannte Schemata werden nicht ueberschrieben. Bei Datenbankfehlern bleibt der CSV-Workflow nutzbar, die Projektbibliothek zeigt einen Fehler.

Die Datenbank ist nicht verschluesselt und enthaelt keine Shop-Zugangsdaten. Fuer vertrauliche Produktdaten die Festplattenverschluesselung des Betriebssystems verwenden. Fuer eine Dateisicherung die App vollstaendig beenden und das gesamte `data`-Verzeichnis sichern, einschliesslich eventuell vorhandener SQLite-WAL-Dateien. Ein integrierter Backup-Export und eine Exporthistorie sind noch nicht enthalten. Die Browser-Vorschau hat keinen SQLite-Zugriff.

## WooCommerce-Verbindung

In der Electron-App oben **Shopverbindung** oeffnen. HTTPS-Adresse (vorbelegt: `https://catalogdesk.local`), Consumer Key und Consumer Secret eingeben; in WooCommerce einen API-Schluessel mit ausschliesslich **Lesen** verwenden. **Verbindung pruefen** fragt `GET /wp-json/wc/v3/products?per_page=1&status=any` ab und zeigt die von der API gemeldete Produktanzahl inklusive lesbarer Entwuerfe. Auch Shops in WordPress-Unterverzeichnissen werden unterstuetzt.

HTTPS-Zertifikate muessen regulaer vertrauenswuerdig sein; fuer Local das eigene Zertifikat im macOS-Systemschluesselbund vertrauen. Die Zertifikatspruefung wird nicht umgangen. Weiterleitungen werden abgewiesen, Cookies nicht verwendet, Antworten begrenzt und Anfragen nach 15 Sekunden abgebrochen. Schluessel werden weder als URL-Parameter noch in Fehlermeldungen ausgegeben.

Die Eingaben bleiben nur waehrend des offenen Dialogs im Arbeitsspeicher; nach erfolgreicher Pruefung oder Schliessen werden sie verworfen. Keine Speicherung in localStorage, Dateien oder Keychain. Nur das Pruefergebnis bleibt bis zum Neuladen sichtbar; es ist keine dauerhafte Verbindung. Im Browser ist die Maske gesperrt. Ein Produktvergleich und Schreibzugriffe sind noch nicht implementiert.

Der CSV-Vertrag richtet sich nach dem [offiziellen WooCommerce-Schema](https://woocommerce.com/document/product-csv-importer-exporter/). Eine echte WooCommerce-Staging-Instanz wurde nicht angebunden; vor einem produktiven Import eine kleine Testdatei auf Staging pruefen.

## Pruefen und Bauen

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run dist:dir
```

Die End-to-End-Tests pruefen Desktop- und Mobilansicht sowie den echten Electron-Produktionsprozess. Im nativen Test wird nur die Dateiauswahl des OS-Dialogs ersetzt; Preload, IPC, Worker und Dateizugriffe laufen tatsaechlich. Unter Linux braucht der Electron-Test ein Display, z. B. `xvfb-run -a npm run test:e2e -- --project=electron`. Nur Browser: `npm run test:e2e -- --project=desktop --project=mobile`.

`npm run dist:dir` erzeugt eine entpackte Anwendung unter `release/`. `npm run dist` erstellt Installer fuer das aktuelle System: DMG/ZIP auf macOS, NSIS auf Windows, AppImage auf Linux. Windows- und Linux-Pakete sind konfiguriert, aber lokal auf diesem Mac nicht getestet. Fuer oeffentliche Distribution fehlen bewusst Codesignierung, macOS-Notarisierung und ein Updatekanal; ein unsignierter Build ist nur ein Testartefakt.

GitHub Actions prueft Typen, Lint, Format, Domain- und Browser-Tests auf Linux sowie Electron und einen unsignierten App-Build auf macOS. Der Workflow wird erst nach Veroeffentlichung des Repositorys ausgefuehrt.

Im Build-Werkzeug `electron-builder` besteht derzeit eine transitive moderate `sprintf-js`-Warnung. Es wurde kein erzwungener Toolchain-Downgrade vorgenommen. Das Laufzeitpaket ist mit `npm audit --omit=dev` separat pruefbar.

## Assets

Lokale Beispielbilder von [Unsplash](https://unsplash.com/license): [Armbanduhr](https://images.unsplash.com/photo-1523275335684-37898b6baf30), [Sneaker](https://images.unsplash.com/photo-1542291026-7eec264c27ff), [Kamera](https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f).

App-Icon: eigenes Motiv, reproduzierbar mit `node scripts/generate-icon.mjs`. Schriften: Manrope und IBM Plex Sans ueber Fontsource, jeweils mit den in den npm-Paketen enthaltenen Lizenzbedingungen.
