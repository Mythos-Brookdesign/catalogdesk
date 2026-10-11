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
- Direkter lesender WooCommerce-Import mit Pagination, Fortschrittsanzeige und Abbruch.
- Spaltenzuordnung mit Vorschlaegen fuer gaengige deutsche und englische Feldnamen.
- Pruefung auf fehlende Pflichtwerte, doppelte Artikelnummern, ungueltige Preise und negative oder nicht ganzzahlige Bestaende.
- Explizite deutsche oder englische Preisformate; optionale Preisnormalisierung und Entfernung von Rand-Leerzeichen.
- Originalwerte bleiben erhalten; Aenderungen werden im Produkteditor angezeigt.
- Suche, Statusfilter, Sortierung und paginierte Produktliste.
- Manuelle Korrekturen und ausdrueckliche Ausschluesse; Export wird bei aktiven Fehlern oder fehlenden Pflichtzuordnungen blockiert.
- Bis zu 20 lokal gespeicherte Zuordnungsprofile inklusive Aufbereitungsoptionen.
- SQLite-Projektbibliothek: komplette Importarbeitsstaende speichern, aktualisieren, kopieren, wieder oeffnen und bestaetigt loeschen.
- Hell-/Dunkelmodus mit in SQLite gespeicherter Auswahl und Wiederherstellung beim App-Start.
- WooCommerce-CSV fuer einfache Produkte als Entwuerfe (`Published = -1`) und separater Pruefbericht.
- Mitgelieferter Beispielkatalog mit 12 Produkten und 5 fehlerhaften Datensaetzen.
- Bestaetigte Preis-/Bestandsuebertragung an bestehende WooCommerce-Produkte mit Konfliktpruefung und dauerhafter SQLite-Historie.

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
       `-- Electron Main: native Dialoge und kontrollierte Shopanfragen
            `-- Node Worker Thread: SQLite-Projekte, Einstellungen und Historie
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
- Keine Telemetrie. Schriften und Fotos werden lokal ausgeliefert. Nur ausdruecklich bestaetigte Uebertragungen senden Preis-/Bestandswerte an den gespeicherten Shop; API-Schluessel bleiben im Authorization-Header und werden nie protokolliert.
- Gespeicherte Importprojekte bleiben in der lokalen SQLite-Datei erhalten. Nicht gespeicherte Aenderungen gehen beim Schliessen oder Neuladen verloren. Zuordnungsprofile werden weiterhin separat in localStorage gespeichert.
- Die Quelldatei wird niemals ueberschrieben. Ersatzimports und geaenderte Zuordnungen fragen vor dem Verwerfen manueller Korrekturen nach.

## Grenzen des MVP

UTF-8, maximal 10 MB und 50.000 Datensaetze pro Import. Fehlende oder doppelte Spaltenueberschriften und uneinheitliche Spaltenzahlen werden abgelehnt. Preise sind nichtnegativ, auf zwei Dezimalstellen und 999.999.999 begrenzt. Artikelnummern werden fuer die Duplikatpruefung ohne Rand-Leerzeichen und ohne Beachtung der Gross-/Kleinschreibung verglichen.

Nur einfache Produkte: keine Varianten, Bilderimporte, XLSX, automatische Synchronisation oder KI-Korrekturen. Schreibzugriffe sind auf bestaetigte Preis-/Bestandsaenderungen an bestehenden einfachen Shopprodukten begrenzt. Kategorien koennen fuer CSV-Exporte bereits im WooCommerce-Format (`Wohnen > Licht, Accessoires`) uebergeben werden. Eigene Steuer-, Versand- und Importregeln des Shops werden nicht geprueft.

## Lokale SQLite-Projekte

Der Sonnen-/Mond-Umschalter oben wechselt das Farbschema. In Electron wird die Wahl automatisch in der SQLite-Tabelle `settings` gespeichert und vor dem ersten Rendern beim naechsten Start geladen. Standard ist Hellmodus. Schema-Version 2 ergaenzt die Einstellungstabelle und migriert bestehende Projekte ohne Datenverlust. Die Browser-Vorschau unterstuetzt den Wechsel nur fuer die aktuelle Sitzung, ohne SQLite-Persistenz. Falls die Datenbank nicht verfuegbar ist, startet die App im Hellmodus; fehlgeschlagene Speicherung wird am Umschalter angezeigt.

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

Mit **Verbindung speichern** werden Shopadresse und Schluessel dauerhaft gespeichert. Beim naechsten Oeffnen oder App-Neustart ist die Adresse vorbelegt; **Verbindung pruefen** und **Produkte importieren** verwenden die gespeicherten Schluessel, ohne sie in der Oberflaeche anzuzeigen. Die Speicherung validiert die Eingaben, prueft aber nicht die Erreichbarkeit oder Leseberechtigung des Shops. Zum Ersetzen neue Schluessel eingeben und erneut speichern. Zum Entfernen das Papierkorb-Symbol neben der gespeicherten Adresse verwenden und bestaetigen. Eine andere Shopadresse verwendet niemals automatisch die alten Schluessel.

Mit **Produkte importieren** lassen sich Produkte direkt aus WooCommerce laden, ohne CSV-Zwischenschritt. Es ist kein vorheriger Verbindungstest erforderlich. Nicht gespeicherte Schluessel werden nach erfolgreicher Anfrage aus der Eingabemaske entfernt; gespeicherte Verbindungen bleiben erhalten. Der Import fragt ausschliesslich `GET /wp-json/wc/v3/products` ab, mit 100 Produkten pro Seite, `status=any` und aufsteigender Produkt-ID. Lesbare Entwuerfe werden eingeschlossen. Uebernommen werden ausschliesslich einfache Produkte; andere Typen werden gezaehlt und in einer sichtbaren Zusammenfassung gemeldet.

SKU, Produktname, regulaerer Preis, Bestand bei aktivierter Bestandsverwaltung, Kategorienamen und Beschreibung werden in den Katalog uebernommen. Preise verwenden automatisch das englische Zahlenformat mit Dezimalpunkt; ein fehlender Preis oder eine fehlende SKU wird durch die vorhandene Katalogpruefung sichtbar. HTML-Beschreibungen werden als Textwerte erhalten, nicht ausgefuehrt. Kategorienamen mit Kommas werden fuer das WooCommerce-CSV-Format escaped. Kategorie-IDs und Elternhierarchien, Produkt-IDs, Veroeffentlichungsstatus, Bilder, Varianten, virtuelle/downloadbare Eigenschaften und weitere Shopfelder werden nicht in das einfache Zielmodell uebernommen. Der Import ist kein vollstaendiges Shopbackup. Ein anschliessender CSV-Export legt weiterhin einfache Produkte als Entwuerfe an.

Der gesamte Katalog wird erst nach erfolgreichem Laden uebernommen. Bei ungespeichertem Arbeitsstand wird zuvor nachgefragt. Leere Shops, fehlende einfache Produkte, API-Fehler, Abbruch oder unvollstaendige Seiten lassen den alten Katalog unveraendert. Fortschritt und Abbruch sind im Dialog verfuegbar. Importierte Arbeitsstaende lassen sich anschliessend ausdruecklich als SQLite-Projekt speichern.

Grenzen: 50.000 gelesene Produkte, 500 Seiten, 5 MB pro Seite, 30 MB Rohdaten insgesamt und 30 MB fuer den aufbereiteten Datensatz. Zeitlimit: 15 Sekunden pro Seite und zwei Minuten insgesamt. Anzahl und Seitenzahl muessen ueber alle Seiten stabil bleiben; doppelte oder nicht aufsteigende IDs werden abgewiesen. Gleichzeitige Aenderungen einzelner Werte bei unveraenderter Produktanzahl koennen damit nicht erkannt werden: WooCommerce liefert keinen transaktionalen Gesamtsnapshot. Fuer einen konsistenten Import den Shopkatalog waehrenddessen nicht bearbeiten.

HTTPS-Zertifikate muessen regulaer vertrauenswuerdig sein; fuer Local das eigene Zertifikat im macOS-Systemschluesselbund vertrauen. Die Zertifikatspruefung wird nicht umgangen. Weiterleitungen werden abgewiesen, Cookies nicht verwendet und Antworten begrenzt. Schluessel werden weder als URL-Parameter noch in Fehlermeldungen ausgegeben.

Genau eine Shopverbindung wird bei ausdruecklichem Speichern mit Electron `safeStorage` verschluesselt, atomar in `credentials/shop-connection.enc` unter `userData` abgelegt und nur im Hauptprozess entschluesselt. Der Verschluesselungsschluessel wird durch macOS-Keychain, Windows-DPAPI oder einen unterstuetzten Linux-Geheimnisspeicher geschuetzt. Linux `basic_text`, unbekannte Backends und fehlende Verschluesselung werden abgewiesen: kein Klartext-Fallback. Weder SQLite noch localStorage enthalten API-Schluessel. Die Lade-API gibt nur die Shopadresse zurueck; entschluesselte Schluessel werden nicht an den Renderer ausgeliefert. Unter Windows schuetzt DPAPI vor anderen Benutzern, nicht grundsaetzlich vor Anwendungen desselben Benutzers. Auf macOS kann der Keychain-Zugriff eine Betriebssystemabfrage ausloesen; konsistente Codesignierung ist fuer zuverlaessigen Zugriff nach Updates notwendig. Dieser lokale Build ist weiterhin unsigniert. Die verschluesselte Datei ist nicht als portables Zugangsdatenbackup geeignet.

Nicht gespeicherte Eingaben bleiben nur waehrend des offenen Dialogs im Arbeitsspeicher; nach erfolgreicher Anfrage oder Schliessen werden sie verworfen. Das Pruefergebnis bleibt bis zum Neuladen sichtbar, ohne eine dauerhafte Netzwerkverbindung aufzubauen. Im Browser ist die Maske gesperrt. Import- und Uebertragungstests simulieren die HTTPS-Shopantworten; Electron-IPC, Mapping, Analyse und SQLite laufen tatsaechlich. Der Persistenztest nutzt echte Systemspeicher-Verschluesselung und prueft Wiederverwendung nach einem Neustart. Authentifizierter Import und Schreibzugriffe auf deinen echten Shop muessen noch mit deinen lokal eingegebenen Schluesseln auf Staging geprueft werden.

## Shopuebertragung und Historie

1. Fuer Schreibzugriffe in WooCommerce einen separaten API-Schluessel mit **Lesen/Schreiben** erzeugen und lokal als Shopverbindung speichern. Keine Schluessel in Chat oder Repository eingeben.
2. CSV/Shopdaten importieren oder gespeichertes Projekt oeffnen und korrigieren.
3. Im **Export** auf **An WooCommerce uebertragen** klicken. Gueltige, nicht ausgeschlossene Datensaetze werden beruecksichtigt; Suche und Tabellenfilter begrenzen diese Auswahl nicht. Pro Lauf maximal 100 aktive gueltige Produkte, bei groesseren Katalogen weitere Datensaetze ausschliessen.
4. **Preis** und/oder **Bestand** auswaehlen und **Shopvorschau laden**. Nur bestehende eindeutige SKUs und einfache Produkttypen werden freigegeben. Bei Bestand muss die Bestandsverwaltung bereits aktiv sein; leere Bestandsfelder werden nicht geschrieben.
5. Gewuenschte Produkte einzeln ankreuzen, **Produkte freigeben** und **Bestaetigen und uebertragen**. Vor dieser letzten Bestaetigung erfolgen keinerlei PUT-Anfragen. Die Vorschau ist zehn Minuten gueltig und wird nach einem Schreibauftrag verbraucht.

Nur veraenderte `regular_price`- und `stock_quantity`-Werte werden per `PUT /wc/v3/products/{id}` geschrieben. Keine neuen Produkte, keine Aenderung von Name, Beschreibung, Kategorien, Veroeffentlichung, Sonderpreis oder Bestandsverwaltungsmodus. Vor jedem PUT werden Produktidentitaet und die in der Vorschau betroffenen Shopwerte erneut gelesen. Abweichungen ergeben einen Konflikt ohne Schreibzugriff. Die WooCommerce-API bietet hier kein atomisches Compare-and-Swap: Zwischen Lesen und Schreiben bleibt ein kleines Konfliktfenster. Deshalb auf Staging testen und parallele Shopbearbeitung fuer diese Produkte vermeiden. Laufende Aktionen lassen sich abbrechen; bereits geschriebene Produkte werden nicht automatisch zurueckgesetzt.

Schema-Version 3 ergaenzt `transfer_runs` und append-only `transfer_events`, ohne Projekte oder Theme-Einstellungen zu veraendern. Nach Freigabe wird der Lauf mit Shopadresse, Zeitpunkt, Produkt-ID/SKU, vorherigen Werten und gewuenschten Werten gespeichert. Jeder Schreibversuch wird vor dem Netzwerkanruf dauerhaft als `sending` protokolliert. Kann die Historie nicht gespeichert werden, erfolgt kein weiterer PUT. Ergebnisse und beobachtete Shopwerte werden als neue Ereignisse angehaengt; vorhandene Ereignisse werden nicht ueberschrieben. Die Historie ist eine lokale Betriebshistorie, kein manipulationssicheres Compliance-Audit.

Erfolgreiche Antworten werden durch erneutes GET bestaetigt. Nach Netzwerkfehlern, Timeouts oder unklaren Serverantworten wird ebenfalls nur gelesen, niemals blind erneut geschrieben. Stimmen die Zielwerte, wird das Ergebnis als bestaetigt dokumentiert. Andernfalls bleibt es **Unklar**, und weitere Produkte dieses Laufs werden nicht geschrieben. In der **Historie** lassen sich unklare beziehungsweise beim App-Absturz unbestaetigt gebliebene Schreibversuche erneut lesend pruefen. Die Nachpruefung bestaetigt den aktuellen Wert, nicht zwingend dessen Verursacher. Noch laufend markierte oder nicht abgeschlossene Laeufe werden sichtbar erhalten, nicht automatisch wiederholt. Rechtefehler, Konflikte, Abbrueche und Lesefehler vor dem Schreiben werden ebenfalls dokumentiert.

Die Historie bleibt nach Neustarts erhalten, ist seitenweise durchsuchbar ueber die Lauf-Liste und zeigt die Details jedes Produkts samt Ereigniszeitpunkten. Sie protokolliert aktuell nur bestaetigte Shopuebertragungen, nicht jede Eingabe, CSV-Ausgabe, Vorschau oder jeden Import. Es gibt keinen automatischen Rollback und keinen Loesch-/Exportbefehl fuer die Historie. Einzelne API-Anfragen haben ein Zeitlimit von 15 Sekunden und ein Antwortlimit von 256 KB. Ein Abbruch waehrend eines Schreibversuchs fuehrt zuerst zu einer lesenden Ergebnispruefung; das Schliessen der App wartet auf deren Abschluss, bevor die Datenbank geschlossen wird.

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
