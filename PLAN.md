# CatalogDesk Produkt- und Umsetzungsplan

Stand: 13. Oktober 2026

## Produktziel

CatalogDesk wird eine schnelle, lokale Arbeitsoberflaeche fuer WooCommerce-Shops. Katalogdaten und freigegebene Arbeitsstaende bleiben auf dem Computer verfuegbar, sodass Suche, Pruefung und Vorbereitung nicht bei jedem Schritt von der Geschwindigkeit des Webhostings abhaengen.

Der erste Produktschnitt ist eine einzelne installierte App auf einem Computer mit mehreren CatalogDesk-Benutzerkonten und gemeinsamem lokalem Shop-Arbeitsbestand. Die App wird kein vollstaendiger Ersatz fuer WordPress, WooCommerce-Erweiterungen oder das Hosting-Backend.

## Produktprinzipien

- Lokale Daten fuer schnelle Suche, Sortierung, Massenbearbeitung und Offline-Lektuere.
- Offline-Aenderungen sind Entwuerfe; der Shop wird ausschliesslich bei vorhandener Verbindung und ausdruecklicher Freigabe veraendert.
- Vor Schreibzugriffen Shopstand, Identitaet und Konflikte erneut pruefen. Keine automatischen Wiederholungen unklarer Schreibversuche.
- Kritische Aktionen muessen eine Vorschau, eine klare Bestaetigung und einen nachvollziehbaren Verlauf haben.
- Personenbezogene Daten sparsam speichern, Zugriffe rollenbasiert beschraenken und Aufbewahrung und Loeschung dokumentieren.
- CSV- und Shopimport bleiben fuer schreibgeschuetzte API-Schluessel nutzbar; Schreibfunktionen verlangen passende Rechte.
- Erweiterungsdaten wie Hersteller, Marken, Lieferanten und eigene Taxonomien werden als eigener Integrationsbereich modelliert; nicht als zufaellige Produktfelder behandelt.

## Nutzer und Betriebsmodell

### Erste Version: lokal, ein Rechner, mehrere Nutzer

- Eine installierte Electron-App und eine lokale SQLite-Datenbank je Betriebssystemkonto.
- Mehrere CatalogDesk-Konten im selben App-Arbeitsbereich teilen den Shopkatalog und die Historie.
- Jeder angemeldete Nutzer erhaelt eine unverwechselbare Benutzer-ID. Aenderungen, Freigaben und Uebertragungen referenzieren diese ID statt eines frei eingegebenen Anzeigenamens.
- Sitzungen, Kontosperren und Berechtigungspruefungen werden im Electron-Hauptprozess erzwungen, nicht nur durch ausgeblendete UI-Schaltflaechen.
- Kein Cloudkonto, keine zentrale API und keine Synchronisation zwischen Rechnern in dieser Version.

### Spaetere Edition: mehrere Rechner

Eine eigenstaendige Netzwerk-/Team-Edition kann spaeter einen zentralen Synchronisationsdienst oder Backenddienst erhalten. Datenbankschema und Ereignismodell sollen die spaetere Synchronisation nicht verbauen; ein zentraler Dienst ist ausdruecklich nicht Teil des lokalen MVP.

## Sicherheitskonzept vor Implementierung

1. **Bedrohungsmodell festhalten.** Schutz vor Shop-Schluesseln im Klartext, versehentlicher Freigabe, falscher Rollenberechtigung, verlorenen Updates, Plugin-/API-Fehlern und lokal gespeicherten Kundendaten.
2. **App-Login planen.** Individuelle Konten, rollenbasierte Berechtigungen, sichere Passwortableitung (Argon2id oder scrypt), Rate-Limits fuer Loginversuche, Sitzungsablauf, Sperren und Wiederherstellung beschreiben.
3. **Lokale Grenze ehrlich definieren.** App-Konten trennen Benutzeraktionen innerhalb der App. Gegen einen anderen OS-Benutzer schuetzt das Betriebssystemprofil. Gegen andere Prozesse desselben OS-Benutzers bietet ein lokaler App-Login allein keine starke Isolation; Vertraulichkeitsanforderungen, SQLite-Verschluesselung und Schluesselableitung muessen vor Kundendaten entschieden werden.
4. **Rollen und Mindestberechtigungen.** Mindestens Administrator, Bearbeiter und Leser. Shopverbindung verwalten, Produktdaten bearbeiten, Bestellungen/Kunden einsehen und Shopaenderungen freigeben sind getrennte Berechtigungen.
5. **Geheimnisse und Datenschutz.** WooCommerce-Schluessel im Betriebssystemspeicher, niemals in SQLite, Exportdateien, Logs oder Historien. Kunden-/Bestelldaten nur soweit fuer den definierten Arbeitsablauf erforderlich und mit konfigurierbarer Aufbewahrung und nachvollziehbarer Loeschung.
6. **Audit und Recovery.** Actor-ID, Aktion, Zeitpunkt, Ziel, Vorher-/Zielwerte, Ergebnis und Verifikationsstatus protokollieren. Backup, Wiederherstellung, Schema-Migrationen und Folgen eines App- oder Rechnerausfalls testen.
7. **Sicherheitsreview.** IPC-Validierung, Main/Renderer-Grenze, Rechtepruefungen, Abhaengigkeiten, Produktionssignierung und Updatekette vor einer oeffentlichen Teamnutzung ueberpruefen.

## Umsetzungsphasen

### Phase 0: Anforderungen und Architektur

- Zielszenarien mit Shopbetreibern und Agenturen erfassen: Kataloggroesse, Varianten, haeufige Aenderungen, Nutzerrollen und Hosting-Engpaesse.
- Lokales Mehrbenutzermodell, Datenzugriff, Sicherheitsgrenzen und Datenaufbewahrung festlegen.
- WooCommerce-Datenmodell fuer einfache Produkte und Varianten sowie Konflikt- und Synchronisationsregeln spezifizieren.
- Aktiven Shop mit einer read-only REST-Entdeckung untersuchen: sichtbare CPTs, Taxonomien, Namespaces und WooCommerce-Produktrouten dynamisch auflisten.
- Pro Erweiterung festhalten, woher Daten kommen (CPT, Taxonomie, `meta_data` oder Plugin-API), ob sie im REST API sichtbar und beschreibbar sind und ob Beziehungen am Elternprodukt oder an Varianten haengen. REST-Sichtbarkeit allein gilt nicht als WooCommerce-Zuordnung.
- Schnittstellen-, Fehler- und Bedrohungsmodell dokumentieren.

**Ergebnis:** Abgenommener Scope, Rollenmatrix, Datenmodell, Sicherheitsanforderungen und messbare Akzeptanzkriterien.

### Phase 1: Lokale Accounts und sichere Grundlagen

- Mehrere lokale CatalogDesk-Konten, Login/Logout, Rollen und Main-Process-Rechtepruefungen.
- Audit-Ereignisse erhalten die angemeldete Actor-ID.
- Shopverbindung und vorhandene Shop-Schluessel bleiben an ein Betriebssystemkonto gebunden. Rechte geteilter App-Konten fuer die Shopverbindung bewusst definieren.
- Mehrbenutzerzugriff auf SQLite, Datenbanktransaktionen, Backup-/Restore und Migrationen testen.
- Administratoren koennen konsistente SQLite-Sicherungen erstellen und wiederherstellen. Restore prueft Integritaet und Schema, stellt den alten Datenbankstand bei Fehlern wieder her und meldet alle Nutzer ab.
- Sicherungen enthalten lokale Konten samt Passwort-Hashes, Projekte und Verlauf; Shop-Schluessel liegen weiterhin getrennt. Sicherungsdateien sind nicht verschluesselt und muessen entsprechend geschuetzt aufbewahrt werden.

**Abnahmekriterien:** Nutzer koennen sich getrennt anmelden; Leser koennen nichts aendern; Bearbeiter koennen Entwuerfe vorbereiten; nur berechtigte Rollen koennen Uebertragungen freigeben; jede relevante Aktion hat einen Actor.

### Phase 2: Produktverwaltung mit Varianten (erster funktionaler MVP)

- Lokaler Katalog fuer einfache und variable Produkte sowie Varianten mit Elternbeziehung.
- Variantenattribute (z. B. Groesse und Farbe), Attributwerte, SKU, Preis und Bestand pro Variante korrekt abbilden.
- Zugeordnete Hersteller-/Markenreferenzen mit stabiler Shop-ID, Slug und Anzeigename erhalten. Herstellerdaten nicht aus Produktnamen erraten.
- CPTs und Taxonomien nur ueber eine explizit konfigurierte Erweiterungsintegration importieren; nicht unterstuetzte oder nicht REST-faehige Daten in Vorschau und Synchronisationsbericht klar als nicht bearbeitbar kennzeichnen.
- Import, Suche, Filter, Sortierung, Massenbearbeitung und gespeicherte Arbeitsstaende fuer Produktfamilien.
- Vorhandene API-Felder erhalten; nicht unterstuetzte Shopfelder in der Vorschau als bewusst unveraendert anzeigen.
- Konflikte auf Produkt- und Variantenebene erkennen; Eltern-/Variantenstrukturen vor jedem Schreiben validieren.
- Vorschau und ausdrueckliche Freigabe vor jedem Shop-Schreibvorgang.

**Abnahmekriterien:** Keine verwaisten Varianten, keine doppelten Varianten-SKUs, valide Elternbeziehungen; grosse lokale Kataloge bleiben ohne Serverroundtrip durchsuchbar; Shopkonflikte verhindern den betroffenen Schreibzugriff; importierter Arbeitsstand ueberlebt Neustarts. Hersteller-/Markenbeziehungen eines unterstuetzten CPT-/Plugin-Adapters bleiben beim Offline-Bearbeiten, Variantenimport und Produktsync referenziell intakt.

### Phase 2a: CPTs und Shop-Erweiterungen

- Einen Integrationskatalog aus einer read-only REST-Entdeckung aufbauen: WordPress-Namespaces, REST-faehige CPTs, Taxonomien und WooCommerce-Produktrouten getrennt erfassen.
- Den `edit`-Kontext zuerst versuchen und bei fehlender Berechtigung auf `view` zurueckfallen. Teilweise sichtbare Ergebnisse als solche markieren; nicht ueber die REST-API exponierte Typen nicht als vollstaendig entdeckt ausgeben.
- WooCommerce-Kerntypen, Taxonomien mit Produktbezug und CPTs mit einer geteilten Produkttaxonomie technisch klassifizieren. Namen oder Slugs allein sind kein Beweis fuer eine WooCommerce-Beziehung.
- Erweiterungs-Namespaces und moegliche Beziehungen als Vorschlaege anzeigen, die konkrete Zuordnung durch einen Administrator bestaetigen lassen. Unbekannte Typen bleiben lesend und werden niemals automatisch geschrieben.
- Hersteller getrennt vom WooCommerce-Produkt modellieren: stabile externe ID, Post-Typ oder Taxonomie, Name, Slug, Status und explizite Produkt-/Variantenbeziehungen.
- Hersteller in Produktdetail, Suche und Filtern anzeigen. Zunaechst bestehende Hersteller lesen und Produktzuordnungen bearbeiten, sofern die konkrete REST-Schnittstelle dies sicher erlaubt.
- Eigene CPT-Daten nur dann schreiben, wenn Route, Berechtigung und Feldvertrag ausdruecklich bekannt und getestet sind. Fremde Metafelder unveraendert durchreichen oder klar als nicht unterstuetzt ausweisen; niemals unbekannte Plugin-Daten beim Speichern entfernen.
- Adapter-Vertrag und Test-Fixtures pro unterstuetztem CPT/Plugin versionieren; bei deaktiviertem Plugin, fehlender REST-Freigabe oder geaendertem Schema Schreibzugriff fuer den Adapter blockieren.

**Abnahmekriterien:** Die Entdeckung trennt verfuegbare, teilweise verfuegbare und nicht verfuegbare Endpunkte; eine bestaetigte Herstellerbeziehung bleibt beim Produkt- und Variantenabgleich eindeutig verknuepft. Fehlende, geloeschte oder doppelte Hersteller werden als Konflikt ausgewiesen. Ein unbekanntes Plugin-Feld wird nicht stillschweigend ueberschrieben oder geloescht. Unterstuetzung gilt pro bestaetigtem Adapter/Schema, nicht pauschal fuer beliebige CPTs.

### Phase 3: Bestellungen

- Offline verfuegbare, gefilterte Auftragsliste mit Detailansicht.
- Definierte sichere Aktionen wie Statusaenderung und interne Notiz zuerst auf einem WooCommerce-Staging-Shop testen.
- Zahlungen, Rueckerstattungen, Versandlabels und Plugin-spezifische Aktionen gesondert bewerten; keine nicht idempotenten Aktionen automatisch wiederholen.
- Personenbezogene Informationen rollenbasiert anzeigen und Zugriffe protokollieren.

### Phase 4: Kundenverwaltung

- Kundensuche und klar begrenzte haeufige Arbeitsablaeufe.
- Datenminimierung, Rollen, Zugriffshistorie, Aufbewahrungsfristen, Export-/Loeschprozesse und Backup-Verschluesselung implementieren.
- Kundendaten erst nach abgeschlossenem Datenschutz- und Sicherheitsreview lokal cachen.

### Phase 5: Eigenstaendige Team-/Netzwerk-Edition (spaeter)

- Zentraler Dienst fuer Identitaeten, synchronisierte Arbeitsstaende, Rechte und Konflikte.
- Mehrgeraetefaehigkeit, sichere Team-Schluesselverwaltung, mandantenfaehige Datentrennung und verwaltete Updates.
- Lokale Desktop-App bleibt als Client erhalten; Betrieb und Ausfallszenarien des Dienstes separat planen.

### Integrationsstrategie fuer CPTs und Plugins

WordPress-CPTs sind nicht automatisch Bestandteil des WooCommerce-Produktendpunkts. Je nach Plugin liegen Hersteller als CPT, Taxonomie, Produkt-Metafeld oder Plugin-eigene Beziehung vor. Die WordPress REST API exponiert einen CPT nur, wenn er passend fuer `show_in_rest` registriert und fuer den aktuellen Kontext zugaenglich ist. Schreibrechte und Feldschema koennen zusaetzlich plugin- und benutzerabhaengig sein. CatalogDesk untersucht daher zuerst den REST-Index, `wp/v2/types`, `wp/v2/taxonomies` und einen minimalen WooCommerce-Produktsample. `edit` wird vor `view` versucht; ein Fallback wird als teilweise Sichtbarkeit markiert.

Technische Hinweise wie `product` als Core-Typ oder eine Taxonomie, die an `product` gebunden ist, sind Klassifikationen, keine semantischen Beweise. Ein CPT, der eine Produkttaxonomie teilt, wird als moeglicher Zusammenhang angezeigt; Administratoren bestaetigen die Beziehung. WooCommerce-Core-Daten und Erweiterungsdaten bleiben unterscheidbar, externe IDs und Herkunft werden mitgespeichert, und jeder spaetere Adapter deklariert lesbare/beschreibbare Felder. Eine generische automatische CPT-Schreibfunktion ist ausdruecklich kein MVP-Ziel.

## Messbare Produktziele

- Grosse lokale Kataloge lassen sich ohne Warten auf jeden einzelnen Serverrequest filtern und bearbeiten.
- Offline geoeffnete Daten und Entwuerfe sind eindeutig als nicht synchronisiert markiert.
- Keine Shopaenderung ohne benannte Vorschau und bestaetigte Freigabe durch einen berechtigten Nutzer.
- Konflikte und unbekannte Schreibresultate sind fuer Nutzer sichtbar und werden niemals stillschweigend wiederholt.
- Jede Shopaenderung ist im lokalen Verlauf einem Benutzer und einer Produkt-/Varianten-ID zuordenbar.
- App-Neustart, Update, Datenbankfehler und fehlende Shopverbindung verlieren weder gespeicherte Arbeitsstaende noch unklare Historieneintraege.

## Bewusste Nichtziele der ersten Version

- Kein vollstaendiger Ersatz fuer WordPress-Administration oder alle WooCommerce-Erweiterungen.
- Kein gleichzeitiger Betrieb derselben Datenbankdatei auf mehreren Rechnern oder ueber Netzlaufwerke.
- Noch keine automatische Bestandssynchronisierung oder Schreibwiederholung.
- Keine pauschale Kompatibilitaet mit allen Hersteller-, Marken-, ERP- oder anderen CPT-/WooCommerce-Plugins; Adapter werden einzeln aufgenommen und getestet.
- Bestellungen und Kunden sind eingeplante Phasen, aber kein Grund, die erste Produkt-/Variantenphase unnoetig zu vergroessern.
- Keine Speicherung von Shoppasswoertern oder API-Schluesseln in SQLite.
