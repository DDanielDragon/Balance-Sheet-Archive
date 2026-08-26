/**
 * Balance-Autoupdate — holt die Ground-Truth-JSONs aus Git, wenn sich dort
 * wirklich etwas geaendert hat.
 *
 * Daniels drei Anforderungen:
 *  1. EHRLICH   — echtes Commit-Datum + Commit-Kennung aus Git, nie "heute".
 *  2. VERSIONIERT — nach jedem Import wandert der Stand ins Archiv-Repo.
 *                   Die Git-Historie IST die Versionierung, kein Tab-Friedhof.
 *  3. AUTOMATISCH — Stunden-Trigger prueft nur die Commit-Kennung.
 *                   Gleich = nichts tun. Neu = importieren.
 */

const QUELLEN = [
  {
    name: 'Ascension',
    tab: 'Ascension',
    repo: 'Krarilotus/Ascension',
    branch: 'ucp3-ascension',
    pfad: 'extension-Ascension-Balance/resources/balance/ascension.json',
    archivDatei: 'ascension.json'
  },
  {
    name: 'Team Liga',
    tab: 'TL2',
    repo: 'Nevikov/Mod-KI-Team-Liga',
    branch: 'main',
    pfad: 'resources/balance/liga_ai.json',
    archivDatei: 'liga_ai.json'
  }
];

const ARCHIV_REPO = 'DDanielDragon/Balance-Sheet-Archive';
const LOG_TAB = 'Autoupdate-Log';
const PROP_PREFIX = 'lastSha_';

/* ---------- Einrichtung (einmalig von Hand aufrufen) ---------- */

function einrichten() {
  const alte = ScriptApp.getProjectTriggers();
  for (let i = 0; i < alte.length; i++) {
    if (alte[i].getHandlerFunction() === 'pruefeAufAenderung') {
      ScriptApp.deleteTrigger(alte[i]);
    }
  }
  ScriptApp.newTrigger('pruefeAufAenderung').timeBased().everyHours(1).create();
  logSchreiben('Einrichtung', '-', 'Stunden-Waechter aktiviert');
  return 'Waechter laeuft jetzt stuendlich.';
}

/* ---------- Der Waechter ---------- */

function pruefeAufAenderung() {
  const props = PropertiesService.getScriptProperties();
  const ergebnisse = [];

  for (let i = 0; i < QUELLEN.length; i++) {
    const q = QUELLEN[i];
    const commit = holeCommit_(q);
    if (!commit) {
      ergebnisse.push(q.name + ': Git nicht erreichbar');
      continue;
    }
    const bekannt = props.getProperty(PROP_PREFIX + q.name);
    if (bekannt === commit.sha) {
      ergebnisse.push(q.name + ': unveraendert');
      continue;
    }
    const bericht = importiere_(q, commit);
    props.setProperty(PROP_PREFIX + q.name, commit.sha);
    ergebnisse.push(q.name + ': aktualisiert (' + bericht + ')');
  }
  return ergebnisse.join(' | ');
}

/** Erzwingt einen Import, egal ob sich der Commit geaendert hat. */
function jetztImportieren() {
  const props = PropertiesService.getScriptProperties();
  for (let i = 0; i < QUELLEN.length; i++) {
    props.deleteProperty(PROP_PREFIX + QUELLEN[i].name);
  }
  return pruefeAufAenderung();
}

/* ---------- Git lesen ---------- */

/** Kopfzeilen mit Token, falls vorhanden — sonst laeuft man in GitHubs
 *  Limit fuer anonyme Abfragen (Google teilt sich Server-Adressen). */
function gitKopf_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const kopf = { Accept: 'application/vnd.github+json' };
  if (token) kopf.Authorization = 'Bearer ' + token;
  return kopf;
}

function holeCommit_(q) {
  const url = 'https://api.github.com/repos/' + q.repo + '/commits?sha=' +
              q.branch + '&path=' + encodeURIComponent(q.pfad) + '&per_page=1';
  const antwort = UrlFetchApp.fetch(url, {
    headers: gitKopf_(), muteHttpExceptions: true });
  if (antwort.getResponseCode() !== 200) {
    Logger.log('Git-Abfrage ' + q.name + ' -> HTTP ' +
               antwort.getResponseCode() + ': ' +
               antwort.getContentText().substring(0, 200));
    return null;
  }
  const daten = JSON.parse(antwort.getContentText());
  if (!daten.length) return null;
  const c = daten[0];
  return {
    sha: c.sha,
    kurz: c.sha.substring(0, 7),
    datum: c.commit.committer.date,
    nachricht: (c.commit.message || '').split('\n')[0]
  };
}

function holeJson_(q) {
  const url = 'https://raw.githubusercontent.com/' + q.repo + '/' + q.branch +
              '/' + q.pfad;
  const antwort = UrlFetchApp.fetch(url, {
    headers: gitKopf_(), muteHttpExceptions: true });
  if (antwort.getResponseCode() !== 200) return null;
  return JSON.parse(antwort.getContentText());
}


/* ---------- Feld-Zuordnung: Tabellen-Spaltenkopf -> JSON-Feld ---------- */
const FELDER = {
  'Health': 'health',
  'Arrow': 'arrowDamage',
  'Crossbow': 'xbowDamage',
  'Sling': 'stoneDamage',
  'Unit base': 'baseMeleeDamage',
  'Buildings': 'buildingDamage',
  'Towers and gates': 'fortificationDamage',
  'Walls': 'wallDamage'
};

const KOPF_ZEILEN = 10;   // Zeilen 1-10 sind Titel und Spaltenkoepfe
const NAMEN_TAB = 'UCP3 names';

/** Zuordnung Tabellenname -> UCP3-Name aus dem vorhandenen Namens-Tab. */
function namensTabelle_() {
  const ws = SpreadsheetApp.getActive().getSheetByName(NAMEN_TAB);
  const karte = {};
  if (!ws) return karte;
  const werte = ws.getDataRange().getValues();
  for (let r = 1; r < werte.length; r++) {
    const tab = String(werte[r][1] || '').trim();
    const ucp = String(werte[r][2] || '').trim();
    if (tab && ucp) karte[tab] = ucp;
  }
  return karte;
}

/** Liest das Raster eines Balance-Tabs: welche Spalte traegt welchen Kopf,
 *  welche Zeile welche Einheit. */
function rasterLesen_(tab) {
  const letzteSpalte = tab.getLastColumn();
  const letzteZeile = tab.getLastRow();
  const kopf = tab.getRange(3, 1, KOPF_ZEILEN - 2, letzteSpalte).getValues();

  // Nur die LINKESTE Spalte je Feldname nehmen. Nebentabellen weiter rechts
  // benutzen teils dieselben Koepfe (z.B. "Unit base" unter "Ranged damage to:"),
  // meinen aber etwas anderes.
  const spalten = {};
  const schonGesehen = {};
  for (let c = 0; c < letzteSpalte; c++) {
    let text = '';
    for (let r = 0; r < kopf.length; r++) {
      const v = String(kopf[r][c] || '').trim();
      if (v) text = v;
    }
    if (!text) continue;
    if (FELDER[text]) {
      if (schonGesehen[text]) continue;
      schonGesehen[text] = true;
    }
    spalten[c + 1] = text;
  }

  const zeilen = {};
  const namen = tab.getRange(KOPF_ZEILEN + 1, 1,
                             Math.max(1, letzteZeile - KOPF_ZEILEN), 1).getValues();
  for (let r = 0; r < namen.length; r++) {
    const v = String(namen[r][0] || '').trim();
    if (v) zeilen[v] = KOPF_ZEILEN + 1 + r;
  }
  return { spalten: spalten, zeilen: zeilen };
}

/** Ermittelt alle Aenderungen, ohne etwas zu schreiben. */
function planeImport_(q, json) {
  const tab = SpreadsheetApp.getActive().getSheetByName(q.tab);
  if (!tab) return { fehler: 'Tab "' + q.tab + '" fehlt' };

  const raster = rasterLesen_(tab);
  const n2u = namensTabelle_();
  const einheiten = json.units || {};

  const aenderungen = [];
  let geprueft = 0, ohneZuordnung = [];

  for (const tabname in raster.zeilen) {
    const ucp = n2u[tabname];
    if (!ucp) { ohneZuordnung.push(tabname); continue; }
    if (!einheiten[ucp]) { ohneZuordnung.push(tabname + '→' + ucp); continue; }
    const daten = einheiten[ucp];
    const zeile = raster.zeilen[tabname];

    for (const spalte in raster.spalten) {
      const feld = FELDER[raster.spalten[spalte]];
      if (!feld) continue;
      const neu = daten[feld];
      if (neu === undefined || neu === null || typeof neu === 'object') continue;
      geprueft++;
      const alt = tab.getRange(zeile, Number(spalte)).getValue();
      if (String(alt) !== String(neu) && fuehrendeZahl_(alt) !== Number(neu)) {
        aenderungen.push({
          zeile: zeile, spalte: Number(spalte),
          wo: tabname + ' / ' + raster.spalten[spalte],
          alt: alt, neu: neu
        });
      }
    }
  }
  const geb = gebaeudePlan_(q, json, tab);
  for (let i = 0; i < geb.aenderungen.length; i++) {
    aenderungen.push(geb.aenderungen[i]);
  }
  geprueft += geb.geprueft;

  return { aenderungen: aenderungen, geprueft: geprueft,
           ohneZuordnung: ohneZuordnung, tab: tab };
}

/** Liest die fuehrende Zahl einer Zelle. "0      (2)" -> 0, damit Notizen
 *  in Klammern nicht ueberschrieben werden. */
function fuehrendeZahl_(wert) {
  if (wert === '' || wert === null || wert === undefined) return null;
  if (typeof wert === 'number') return wert;
  const treffer = String(wert).trim().match(/^-?[\d.,]+/);
  if (!treffer) return null;
  return Number(treffer[0].replace(',', '.'));
}

/* ---------- Gebaeude ----------
 * Eigener Block im selben Tab, eigene Koepfe ("Buildings", "Health",
 * "Gold/Wood/Stone/Iron/Pitch"). Die Reihenfolge im JSON-Feld "cost" wurde
 * an den echten Werten gemessen: [Wood, Stone, Iron, Pitch, Gold].
 */
const GEB_KOSTEN = { 'Wood': 0, 'Stone': 1, 'Iron': 2, 'Pitch': 3, 'Gold': 4 };

function gebaeudePlan_(q, json, tab) {
  const b = json.buildings || {};
  const n2u = namensTabelle_();
  const letzteZeile = tab.getLastRow();
  const letzteSpalte = tab.getLastColumn();
  const alles = tab.getRange(1, 1, letzteZeile, letzteSpalte).getValues();

  // Kopfzeile des Gebaeudeblocks finden
  let kopfZeile = -1;
  for (let r = 0; r < alles.length; r++) {
    if (String(alles[r][0]).trim() === 'Buildings') { kopfZeile = r; break; }
  }
  if (kopfZeile < 0) return { aenderungen: [], geprueft: 0, hinweis: 'Kein Gebaeudeblock' };

  // Spalten aus Kopfzeile und Folgezeile
  const spalten = {};
  for (let r = kopfZeile; r <= kopfZeile + 1 && r < alles.length; r++) {
    for (let c = 1; c < letzteSpalte; c++) {
      const txt = String(alles[r][c] || '').trim();
      if (txt && !spalten[txt]) spalten[txt] = c + 1;
    }
  }

  const aenderungen = [];
  let geprueft = 0;
  for (let r = kopfZeile + 1; r < alles.length; r++) {
    const name = String(alles[r][0] || '').trim();
    if (!name) continue;
    const ucp = n2u[name];
    if (!ucp || !b[ucp]) continue;
    const daten = b[ucp];
    const zeile = r + 1;

    if (spalten['Health'] && daten.health !== undefined) {
      geprueft++;
      const spalte = spalten['Health'];
      const alt = alles[r][spalte - 1];
      if (fuehrendeZahl_(alt) !== Number(daten.health)) {
        aenderungen.push({ zeile: zeile, spalte: spalte,
          wo: name + ' / Health', alt: alt, neu: daten.health });
      }
    }
    if (daten.cost) {
      for (const stoff in GEB_KOSTEN) {
        const spalte = spalten[stoff];
        if (!spalte) continue;
        const wert = daten.cost[GEB_KOSTEN[stoff]];
        if (wert === undefined) continue;
        geprueft++;
        const alt = alles[r][spalte - 1];
        const altLeer = (alt === '' || alt === null);
        if (altLeer && Number(wert) === 0) continue;   // 0 bleibt leer
        const altZahl = altLeer ? 0 : fuehrendeZahl_(alt);
        if (altZahl !== Number(wert)) {
          aenderungen.push({ zeile: zeile, spalte: spalte,
            wo: name + ' / ' + stoff, alt: alt, neu: wert });
        }
      }
    }
  }
  return { aenderungen: aenderungen, geprueft: geprueft };
}


/** TROCKENLAUF — schreibt nichts, meldet nur, was sich aendern wuerde. */
function trockenlauf() {
  const zeilen = [];
  for (let i = 0; i < QUELLEN.length; i++) {
    const q = QUELLEN[i];
    const json = holeJson_(q);
    if (!json) { zeilen.push(q.name + ': JSON nicht ladbar'); continue; }
    const plan = planeImport_(q, json);
    if (plan.fehler) { zeilen.push(q.name + ': ' + plan.fehler); continue; }
    zeilen.push('=== ' + q.name + ': ' + plan.geprueft + ' Werte geprueft, ' +
                plan.aenderungen.length + ' wuerden sich aendern ===');
    for (let k = 0; k < plan.aenderungen.length; k++) {
      const a = plan.aenderungen[k];
      zeilen.push('   ' + a.wo + ': "' + a.alt + '" -> "' + a.neu + '"');
    }
    zeilen.push('   (' + plan.ohneZuordnung.length +
                ' Zeilen ohne Eintrag im JSON — z.B. Mauern, Tore, Deko)');
  }
  return zeilen.join('\n');
}

/* ---------- Scharfer Import ---------- */

function importiere_(q, commit) {
  const json = holeJson_(q);
  if (!json) return 'JSON nicht ladbar';

  const plan = planeImport_(q, json);
  if (plan.fehler) return plan.fehler;

  // Sicherung des Tabs, bevor irgendetwas geschrieben wird
  const ss = SpreadsheetApp.getActive();
  const stempel = Utilities.formatDate(new Date(),
                    ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
  const sicherung = plan.tab.copyTo(ss).setName(q.tab + ' Sicherung ' + stempel);
  sicherung.hideSheet();
  alteSicherungenAufraeumen_(q.tab);

  // Nur die betroffenen Zellen schreiben - das Raster bleibt unangetastet
  for (let i = 0; i < plan.aenderungen.length; i++) {
    const a = plan.aenderungen[i];
    plan.tab.getRange(a.zeile, a.spalte).setValue(a.neu);
  }
  // Herkunft ehrlich in die Kopfzeile
  plan.tab.getRange(2, 1).setValue(
    'Commit ' + commit.kurz + ' vom ' + commit.datum + '  ·  ' +
    commit.nachricht + '  ·  https://github.com/' + q.repo +
    '/blob/' + q.branch + '/' + q.pfad);
  SpreadsheetApp.flush();

  const archivStatus = insArchiv_(q, json, commit);
  logSchreiben(q.name, commit.kurz + ' / ' + commit.datum,
               plan.aenderungen.length + ' Werte geaendert · Sicherung: ' +
               sicherung.getName() + ' · Archiv: ' + archivStatus);
  return plan.aenderungen.length + ' Werte';
}

/* ---------- Archiv-Repo: Git macht die Versionierung ---------- */

function insArchiv_(q, json, commit) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const repo = props.getProperty('ARCHIV_REPO') || ARCHIV_REPO;
  if (!token) return 'Token fehlt';

  const pfad = 'balances/' + q.archivDatei;
  const url = 'https://api.github.com/repos/' + repo + '/contents/' + pfad;
  const kopfzeilen = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json'
  };

  let sha = null;
  const vorhanden = UrlFetchApp.fetch(url, {
    headers: kopfzeilen, muteHttpExceptions: true
  });
  if (vorhanden.getResponseCode() === 200) {
    sha = JSON.parse(vorhanden.getContentText()).sha;
  }

  const inhalt = Utilities.base64Encode(
    JSON.stringify(json, null, 2), Utilities.Charset.UTF_8);
  const koerper = {
    message: q.name + ' — Commit ' + commit.kurz + ' vom ' + commit.datum,
    content: inhalt
  };
  if (sha) koerper.sha = sha;

  const antwort = UrlFetchApp.fetch(url, {
    method: 'put', headers: kopfzeilen,
    contentType: 'application/json',
    payload: JSON.stringify(koerper),
    muteHttpExceptions: true
  });
  const code = antwort.getResponseCode();
  return (code === 200 || code === 201) ? 'gespeichert' : 'Fehler ' + code;
}

/* ---------- Log ---------- */

function logSchreiben(quelle, stand, hinweis) {
  const ss = SpreadsheetApp.getActive();
  let log = ss.getSheetByName(LOG_TAB);
  if (!log) {
    log = ss.insertSheet(LOG_TAB);
    log.appendRow(['Zeitpunkt', 'Quelle', 'Stand laut Git', 'Ergebnis']);
    log.getRange(1, 1, 1, 4).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  log.appendRow([new Date(), quelle, stand, hinweis]);
}

/* ---------- Menue ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Autoupdate')
    .addItem('Trockenlauf (schreibt nichts)', 'trockenlaufZeigen')
    .addItem('Jetzt auf Aenderungen pruefen', 'pruefeAufAenderung')
    .addItem('Import erzwingen', 'jetztImportieren')
    .addItem('Stunden-Waechter einrichten', 'einrichten')
    .addToUi();
}

function doGet(e) {
  const aktion = (e && e.parameter && e.parameter.action) || '';
  let text = 'keine Aktion';
  try {
    if (aktion === 'pruefen') text = pruefeAufAenderung();
    else if (aktion === 'importieren') text = jetztImportieren();
    else if (aktion === 'einrichten') text = einrichten();
    else if (aktion === 'status') text = status_();
    else if (aktion === 'diagnose') text = diagnose_();
    else if (aktion === 'stopp') text = stoppWaechter_();
    else if (aktion === 'trocken') text = trockenlauf();
    else if (aktion === 'aufraeumen') text = sicherungenAufraeumen();
  } catch (fehler) {
    text = 'FEHLER: ' + fehler.message;
  }
  return ContentService.createTextOutput(text);
}

function status_() {
  const props = PropertiesService.getScriptProperties();
  const zeilen = [];
  for (let i = 0; i < QUELLEN.length; i++) {
    const q = QUELLEN[i];
    const c = holeCommit_(q);
    zeilen.push(q.name + ': gespeichert=' +
      (props.getProperty(PROP_PREFIX + q.name) || '-').substring(0, 7) +
      ' git=' + (c ? c.kurz + ' (' + c.datum + ')' : 'nicht erreichbar'));
  }
  zeilen.push('Archiv-Repo: ' + (props.getProperty('ARCHIV_REPO') || ARCHIV_REPO));
  zeilen.push('Token: ' + (props.getProperty('GITHUB_TOKEN') ? 'gesetzt' : 'fehlt'));
  return zeilen.join(' | ');
}

function diagnose_() {
  const q = QUELLEN[0];
  const url = 'https://api.github.com/repos/' + q.repo + '/commits?sha=' +
              q.branch + '&path=' + encodeURIComponent(q.pfad) + '&per_page=1';
  const a = UrlFetchApp.fetch(url, { headers: gitKopf_(), muteHttpExceptions: true });
  return 'HTTP ' + a.getResponseCode() + ' | ' +
         a.getContentText().substring(0, 300);
}

/** Notbremse: alle Zeitschaltungen entfernen. */
function stoppWaechter_() {
  const trigger = ScriptApp.getProjectTriggers();
  let n = 0;
  for (let i = 0; i < trigger.length; i++) {
    ScriptApp.deleteTrigger(trigger[i]); n++;
  }
  logSchreiben('Notbremse', '-', n + ' Zeitschaltung(en) entfernt');
  return n + ' Zeitschaltung(en) entfernt';
}

function trockenlaufZeigen() {
  SpreadsheetApp.getUi().alert('Trockenlauf', trockenlauf(),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Behaelt je Balance nur die drei juengsten Sicherungen. */
const SICHERUNGEN_BEHALTEN = 3;

function alteSicherungenAufraeumen_(tabName) {
  const ss = SpreadsheetApp.getActive();
  const praefix = tabName + ' Sicherung ';
  const treffer = ss.getSheets().filter(function (s) {
    return s.getName().indexOf(praefix) === 0;
  });
  // Namen enthalten den Zeitstempel -> alphabetisch = chronologisch
  treffer.sort(function (a, b) {
    return a.getName() < b.getName() ? -1 : 1;
  });
  let geloescht = 0;
  while (treffer.length > SICHERUNGEN_BEHALTEN) {
    ss.deleteSheet(treffer.shift());
    geloescht++;
  }
  return geloescht;
}

/** Von Hand aufrufbar: raeumt sofort auf. */
function sicherungenAufraeumen() {
  let n = 0;
  for (let i = 0; i < QUELLEN.length; i++) {
    n += alteSicherungenAufraeumen_(QUELLEN[i].tab);
  }
  return n + ' alte Sicherung(en) entfernt';
}
