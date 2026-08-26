# Balance-Sheet-Archive

Automatisches Archiv der SHC-Balance-Daten aus den Ground-Truth-JSONs.

## Was hier liegt

`balances/ascension.json` und `balances/liga_ai.json` — die Balance-Daten,
wie sie zuletzt ins Vergleichs-Sheet importiert wurden. Jede Datei wird bei
jedem Import ueberschrieben. **Die Git-Historie ist die Versionierung:** jeder
frueherer Stand bleibt ueber die Commit-Historie einsehbar und
wiederherstellbar, ohne dass sich Kopien stapeln.

Jede Commit-Nachricht nennt Quelle, Commit-Kennung und das echte Commit-Datum
der Original-Datei, z.B.
`Ascension — Commit 0456137 vom 2025-11-28T19:47:49Z`.

## Quellen

| Balance | Repo | Branch | Datei |
|---|---|---|---|
| Ascension | Krarilotus/Ascension | ucp3-ascension | extension-Ascension-Balance/resources/balance/ascension.json |
| Team Liga | Nevikov/Mod-KI-Team-Liga | main | resources/balance/liga_ai.json |

Vanilla hat keine Git-Quelle und wird weiterhin von Hand gepflegt.

## Wie es funktioniert

`script/Autoupdate.js` laeuft als Apps Script im Vergleichs-Sheet.

1. **Waechter** — stuendliche Zeitschaltung prueft nur die Commit-Kennung der
   beiden JSONs. Unveraendert: nichts passiert. Neu: Import.
2. **Import** — schreibt einzelne Zellen ins bestehende Raster (Einheiten und
   Gebaeude, rund 380-430 Werte je Balance). Spaltenraster, Formatierung und
   Formeln bleiben unberuehrt.
3. **Archiv** — direkt nach dem Import landet der Stand hier im Repo.
4. **Log** — Tab `Autoupdate-Log` im Sheet: Zeitpunkt, Git-Stand, Anzahl
   geaenderter Werte, Name der Sicherung, Archiv-Status.

## Schutzmechanismen

- **Trockenlauf** (`Autoupdate → Trockenlauf`) zeigt jede geplante Aenderung,
  ohne etwas zu schreiben.
- **Sicherung** vor jedem Schreibvorgang als versteckter Tab; die drei
  juengsten je Balance bleiben erhalten.
- **Notizen bleiben stehen** — bei Zellen wie `0      (2)` wird nur die
  fuehrende Zahl verglichen, der Klammerzusatz bleibt.
- **Notbremse** — Aktion `stopp` entfernt alle Zeitschaltungen.

## Zuordnungen

Namen kommen aus dem Tab `UCP3 names` im Sheet (Tabellenname → UCP3-Name).
Felder sind im Skript zugeordnet und wurden an den echten Werten geprueft:

- Einheiten: Health, Arrow, Crossbow, Sling, Unit base, Buildings,
  Towers and gates, Walls
- Gebaeude: Health und Kosten. Die Reihenfolge im JSON-Feld `cost` wurde
  gemessen, nicht angenommen: `[Wood, Stone, Iron, Pitch, Gold]`
  (213 Treffer gegen 2 Abweichungen).

## Einrichtung

Das Skript braucht eine einzige Skripteigenschaft: `GITHUB_TOKEN`
(fine-grained, nur dieses Repo, Contents: Read and write).
