/* ============================================================
   Coinflip · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Eine Münze hat zwei Seiten: "kopf" und "zahl". Der Spieler tippt
      auf eine Seite, dann wird geworfen. Stimmt der Tipp, ist er richtig.
      Ganz selten landet die Münze auf der KANTE (2 %): ein drittes,
      seltenes Ergebnis.
   2. Die Regeln stehen in kleinen REINEN Funktionen (muenzeWerfen,
      wurfBewerten, casinoTippTrifft, kettenStand, auszahlungBerechnen,
      casinoAuszahlung, zielWinkel ...). Sie kennen kein DOM und keinen
      Speicher und lassen sich deshalb in Node testen.
   3. ZUFALL: Ein einziger Math.random()-Wert z (0 <= z < 1, gleichmäßig
      verteilt) wird in drei Streifen geteilt, deren Breite genau der
      Wahrscheinlichkeit entspricht (Herleitung bei den Konstanten unten):
        z < 0,02          -> KANTE (2 %)
        z < 0,51          -> KOPF  (49 %)
        sonst             -> ZAHL  (49 %)
      Das ist kein kryptografischer Zufall, aber für ein Spiel mit
      Spielgeld völlig ausreichend – niemand kann daraus Vorteile ziehen
      oder etwas knacken. (Für Passwörter oder Lose mit echtem Wert nimmt
      man crypto.getRandomValues().) Das Ergebnis steht fest, BEVOR die
      Animation startet; sie zeigt es nur an.
   4. DIE MÜNZE ist reines HTML/CSS/SVG: zwei Flächen (Vorder- und
      Rückseite) plus ein Rand aus vielen schmalen Streifen (das ist die
      Münzdicke), per CSS-3D um die X-Achse gedreht (siehe spiel.css). Der
      Wurf besteht aus einer Drehung mit mehreren Umdrehungen (transition
      auf transform) und einem Sprung nach oben (Keyframes). Bei KANTE
      dreht sich die Münze zusätzlich um die senkrechte Achse, bis sie mit
      dem Rand zum Betrachter steht, und wackelt dann kurz aus. Wer
      "Bewegung reduzieren" eingestellt hat, sieht nur ein kurzes
      Umblenden.
   5. Die Variable "phase" verhindert, dass man mitten im Wurf noch einmal
      tippt: "wartet" (Tipp möglich) | "wurf" (Münze fliegt) | "vorbei"
      (nur Arcade: Runde beendet).
   6. ZWEI MODI, eine Münze: "Arcade" (Kette ohne Geld) und "Casino"
      (Spielgeld). Der Umschalter oben speichert den Modus; ?modus=casino
      in der URL wählt ihn direkt vor (für Verlinkungen).
   7. ARCADE: Richtig = Kette +1, falsch = Runde vorbei. KANTE ist ein
      UNENTSCHIEDEN: Die Kette bleibt, es geht einfach weiter (wie bei
      GLEICH in Higher Lower). Das Ende läuft über gameOverDialog() aus
      ../assets/ui.js; der Dialog trägt einen Rekord selbst ein.
   8. CASINO: Einsatz wählen (Chips), dann KOPF, ZAHL oder KANTE. Feste
      Quoten: x1,94 auf KOPF und ZAHL, x47 auf KANTE. Bei KANTE verliert
      ein KOPF-/ZAHL-Tipp (kein Unentschieden!); nur wer direkt auf KANTE
      gewettet hat, gewinnt. Die Hausvorteile (4,94 % bzw. 6 %) werden bei
      den Konstanten vorgerechnet. Geld läuft NUR über ../assets/wallet.js.
      Die Topliste zeigt die höchsten Netto-Gewinne und wird still
      gepflegt (ohne Dialog).
   ============================================================ */

import {
  bewegungReduziert,
  zahlHochzaehlen,
  toplisteAnzeigen,
  gameOverDialog,
  stillEintragen,
} from "./assets/ui.js";
import { spielZuruecksetzen, topliste, lade, speichere } from "./assets/storage.js";
import {
  STARTGELD,
  kontostand,
  einsatzAbbuchen,
  rundeAbschliessen,
  istPleite,
  pleiteNeustart,
  walletHud,
  walletHudAktualisieren,
} from "./assets/wallet.js";

const SPIEL = "coinflip"; // Schlüssel für storage.js (Arcade-Topliste + gewählter Modus)
const SPIEL_CASINO = "coinflip-casino"; // eigener Schlüssel: Casino-Topliste (höchster Netto-Gewinn) + Chip
const CHIPS = [10, 25, 50, 100]; // erlaubte Einsätze im Casino-Modus
const MINDESTEINSATZ = CHIPS[0]; // darunter ist man pleite
const MODI = ["arcade", "casino"];
const UMDREHUNGEN = 5; // so oft dreht sich die Münze im Flug komplett
const WURF_MS = 1600; // Dauer des Wurfs; geht als CSS-Variable --wurf-ms an spiel.css
const UMBLEND_MS = 300; // reduzierte Bewegung: kurzes Umblenden statt Wurf
const NACH_WURF_MS = 600; // so lange bleibt das Ergebnis stehen, bevor es weitergeht
const VERLAUF_LAENGE = 12; // so viele letzte Würfe zeigt die Marken-Reihe
const AUFSTELL_MS = 700; // KANTE: so lange dauert das Aufrichten (endet genau mit der Landung)
const WACKEL_MS = 1000; // KANTE: so lange wackelt die stehende Münze aus ("Oho!"-Moment)
const RAND_SEGMENTE = 48; // Der Münzrand besteht aus so vielen schmalen Streifen (rund genug, noch billig)

/* ------------------------------------------------------------
   WAHRSCHEINLICHKEITEN
   Math.random() liefert z mit 0 <= z < 1, gleichmäßig verteilt. Teilt man
   dieses Intervall in Streifen, ist die Wahrscheinlichkeit eines
   Streifens genau seine Breite:
       [0,00 ; 0,02)   KANTE   Breite 0,02 =  2 %  (1 von 50)
       [0,02 ; 0,51)   KOPF    Breite 0,49 = 49 %
       [0,51 ; 1,00)   ZAHL    Breite 0,49 = 49 %
   Zusammen 0,02 + 0,49 + 0,49 = 1. Die obere Grenze des KOPF-Streifens ist
   also 0,02 + 0,49 = 0,51. Das untere Ende jedes Streifens gehört dazu
   ("<=", also z. B. genau 0,02 ist schon KOPF), das obere nicht ("<"):
   Deshalb prüft muenzeWerfen() mit "z < Grenze".

   WARUM 2 %? Eine echte Münze landet praktisch nie auf der Kante (grob 1
   Wurf in einigen Tausend). Damit das Ereignis im Spiel erlebbar bleibt,
   ist die Kante hier bewusst auf 2 % angehoben. Die Münze ist also nicht
   "realistisch", sondern ein Spiel mit drei Ausgängen.
   ------------------------------------------------------------ */
export const WAHRSCHEINLICHKEIT = { kante: 0.02, kopf: 0.49, zahl: 0.49 };
export const GRENZE_KANTE = 0.02; // z < 0,02 -> KANTE
export const GRENZE_KOPF = 0.51; // z < 0,51 -> KOPF (= 0,02 + 0,49), sonst ZAHL

/* ------------------------------------------------------------
   QUOTEN (nur Casino) als GANZE Zahlen in Hundertsteln (Begründung bei
   auszahlungBerechnen). Hausvorteil = 1 - Chance x Quote:
     KOPF / ZAHL  Chance 49 %: fair wäre 1 / 0,49 = x2,04. Gezahlt wird x1,94.
                  Erwartung je 100 Einsatz: 0,49 x 194 = 95,06 -> Hausvorteil 4,94 %.
     KANTE        Chance  2 %: fair wäre 1 / 0,02 = x50. Gezahlt wird x47.
                  Erwartung je 100 Einsatz: 0,02 x 4700 = 94 -> Hausvorteil 6 %.
   Die seltene Kante bekommt den größeren Abschlag: Bei großen Quoten
   schlägt jede kleine Quotenänderung stark auf die Erwartung durch, und
   ein x50-Jackpot ohne Abschlag wäre auf Dauer gefährlich für die Bank.
   ------------------------------------------------------------ */
export const QUOTE_HUNDERTSTEL = { kopf: 194, zahl: 194, kante: 4700 };

/* ============================================================
   TEIL 1: REINE SPIELLOGIK (ohne DOM)
   "export" steht nur da, damit Tests in Node die Funktionen
   importieren können. Im Browser wird es nicht gebraucht.
   ============================================================ */

/** Großgeschriebener Name einer Seite für Knöpfe und Meldungen: "KOPF" / "ZAHL" / "KANTE". */
export function seitenName(seite) {
  return seite.toUpperCase();
}

/**
 * Kurzzeichen für die Marken-Reihe: "K" (Kopf), "Z" (Zahl) und "|" für die
 * Kante. Das "K" von KANTE wäre mit KOPF verwechselbar – der senkrechte
 * Strich erinnert dagegen an die hochkant stehende Münze.
 */
export function seitenKuerzel(seite) {
  return seite === "kante" ? "|" : seitenName(seite)[0];
}

/**
 * Wirft die Münze und gibt "kante", "kopf" oder "zahl" zurück.
 *
 * Ein einziger Zufallswert z aus [0, 1): z < 0,02 ist KANTE, z < 0,51 ist
 * KOPF, alles darüber ZAHL. Grenzen: 0,0199… ist noch Kante, genau 0,02 schon
 * Kopf; 0,5099… ist noch Kopf, genau 0,51 schon Zahl (siehe WAHRSCHEINLICHKEITEN).
 * Der Vergleich mit "<" (nicht "<=") ist richtig, weil 1 selbst nie herauskommt.
 *
 * `zufall` ist austauschbar (Standard Math.random) – für Tests, in denen
 * ein bestimmtes Ergebnis erzwungen werden soll.
 */
export function muenzeWerfen(zufall = Math.random) {
  const z = zufall();
  if (z < GRENZE_KANTE) return "kante";
  if (z < GRENZE_KOPF) return "kopf";
  return "zahl";
}

/**
 * ARCADE-Bewertung eines Tipps. Rückgabe: "richtig" | "unentschieden" | "falsch".
 *
 * UNENTSCHIEDEN bei KANTE: Weder KOPF noch ZAHL stimmt, der Spieler kann
 * aber nichts dafür – "falsch" wäre unfair, "richtig" geschenkt. Also
 * neutral: Die Kette bleibt, es geht einfach weiter. (Ein Tipp auf "kante"
 * gibt es nur im Casino; trifft er dort, ist er natürlich "richtig".)
 */
export function wurfBewerten(tipp, ergebnis) {
  if (tipp === ergebnis) return "richtig";
  return ergebnis === "kante" ? "unentschieden" : "falsch";
}

/**
 * CASINO: Hat der Tipp getroffen? true/false – es gibt dort kein
 * Unentschieden. Landet die Münze auf der Kante, verliert ein KOPF- oder
 * ZAHL-Tipp; nur ein Tipp direkt auf "kante" trifft.
 */
export function casinoTippTrifft(tipp, ergebnis) {
  return tipp === ergebnis;
}

/**
 * Arcade-Kette: Aus dem bisherigen Stand und der Bewertung wird der neue
 * Stand. Richtig = Kette +1 und weiter, unentschieden (Kante) = Kette bleibt
 * und es geht weiter, falsch = die Kette bleibt stehen (das ist das
 * Ergebnis der Runde) und die Runde ist vorbei.
 */
export function kettenStand(kette, bewertung) {
  if (bewertung === "richtig") return { kette: kette + 1, vorbei: false };
  if (bewertung === "unentschieden") return { kette, vorbei: false };
  return { kette, vorbei: true };
}

/**
 * Wahrscheinlichkeit, n entscheidende Würfe hintereinander richtig zu tippen.
 * Die Würfe sind voneinander unabhängig, also werden die Chancen
 * multipliziert: 0,5 x 0,5 x ... = 0,5 hoch n.
 *
 * WARUM 0,5 TROTZ KANTE? Kante-Würfe zählen im Arcade-Modus nicht, es
 * entscheiden nur Würfe mit KOPF oder ZAHL. Von diesen ist genau die Hälfte
 * richtig: 0,49 / (0,49 + 0,49) = 0,5. Die Tabelle gilt also für die
 * entscheidenden Würfe; die Kante verlängert die Runde nur um Würfe, die
 * nichts ändern.
 */
export function kettenWahrscheinlichkeit(n) {
  return Math.pow(0.5, n);
}

/** Quote als ganze Hundertstel: 194 für KOPF/ZAHL, 4700 für KANTE. */
export function quoteHundertstel(tipp) {
  return QUOTE_HUNDERTSTEL[tipp];
}

/**
 * BRUTTO-Auszahlung bei Treffer: Einsatz x Quote auf ganze Spielgeld-Einheiten
 * gerundet (bei ".5" wird aufgerundet). Dieselbe Hilfsfunktion rechnet die
 * x1,94 von KOPF/ZAHL und die x47 der KANTE.
 *
 * WARUM GANZE HUNDERTSTEL? 1,94 lässt sich als Gleitkommazahl nicht exakt
 * speichern. Bei Einsätzen wie 25 (25 x 1,94 = 48,5 genau auf der Rundungs-
 * kante) könnte ein winziger Fehler das Ergebnis auf die falsche Seite
 * schieben. Mit Ganzzahlen ist alles exakt:
 *   einsatz x 194 ergibt Hundertstel; + 50 ist das "halbe" Stück für
 *   kaufmännisches Aufrunden; durch 100 teilen und abschneiden (floor).
 *   25: (25 x 194 + 50) / 100 = 4900 / 100 = 49.
 * Die Kante (4700 Hundertstel = x47) geht ohne Rest auf: Der Einsatz x 47.
 */
export function auszahlungBerechnen(einsatz, tipp = "kopf") {
  return Math.floor((einsatz * quoteHundertstel(tipp) + 50) / 100);
}

/**
 * CASINO: Brutto-Auszahlung einer Runde. Treffer = Einsatz x Quote des
 * getippten Feldes, sonst 0. Beispiele (Einsatz 50): Tipp KANTE bei Kante
 * = 2.350; Tipp KOPF bei Kante = 0; Tipp KOPF bei Kopf = 97.
 */
export function casinoAuszahlung(einsatz, tipp, ergebnis) {
  return casinoTippTrifft(tipp, ergebnis) ? auszahlungBerechnen(einsatz, tipp) : 0;
}

/** NETTO-Ergebnis einer Runde: Auszahlung (0 bei Verlust) minus Einsatz. */
export function nettoBerechnen(einsatz, auszahlung) {
  return auszahlung - einsatz;
}

/**
 * Erwartungswert der Rückzahlung bei diesem Einsatz und Tipp: Mit der
 * Wahrscheinlichkeit des Tipps kommt die Auszahlung, sonst nichts. Liegt er
 * unter dem Einsatz, gewinnt auf lange Sicht die Bank (Hausvorteil).
 */
export function erwarteteRueckzahlung(einsatz, tipp = "kopf") {
  return WAHRSCHEINLICHKEIT[tipp] * auszahlungBerechnen(einsatz, tipp);
}

/** Faire Quote = 1 / Wahrscheinlichkeit (KOPF/ZAHL: 2,04 · KANTE: 50). */
export function faireQuote(tipp) {
  return 1 / WAHRSCHEINLICHKEIT[tipp];
}

/** Hausvorteil der gebotenen Quote in Prozent: (1 - Chance x Quote) x 100. KOPF/ZAHL 4,94 · KANTE 6. */
export function hausvorteilProzent(tipp) {
  return (1 - (WAHRSCHEINLICHKEIT[tipp] * quoteHundertstel(tipp)) / 100) * 100;
}

/** Quote hübsch für die Anzeige: "1,94" bzw. "47" (deutsches Komma, überflüssige Nullen weg). */
export function quoteText(tipp = "kopf") {
  return (quoteHundertstel(tipp) / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Meldung unter der Münze nach einem Casino-Wurf: { text, art }.
 * `auszahlung` ist die Brutto-Auszahlung (0 = verloren). Bei KANTE macht die
 * Meldung die Regel klar: Nur ein Kanten-Tipp hätte gewonnen.
 */
export function casinoMeldung(tipp, ergebnis, auszahlung) {
  const geld = auszahlung.toLocaleString("de-DE");
  if (casinoTippTrifft(tipp, ergebnis)) {
    if (ergebnis === "kante") {
      return {
        text: `KANTE! Volltreffer! Auszahlung: ${geld} (×${quoteText("kante")}).`,
        art: "richtig",
      };
    }
    return {
      text: `Treffer! Es war ${seitenName(ergebnis)}. Auszahlung: ${geld} (×${quoteText(tipp)}).`,
      art: "richtig",
    };
  }
  if (ergebnis === "kante") {
    return { text: "KANTE! Nur ein Kanten-Tipp hätte gewonnen.", art: "falsch" };
  }
  return { text: `Daneben! Es war ${seitenName(ergebnis)}.`, art: "falsch" };
}

/**
 * Zielwinkel für die Münze (in Grad, Drehung um die X-Achse).
 * 0° zeigt KOPF, 180° zeigt ZAHL (360° wieder KOPF usw.). Bei KANTE fliegt
 * die Münze wie bei KOPF (0°); das Aufstellen auf den Rand übernimmt eine
 * eigene Drehung um die senkrechte Achse (siehe wurfAnzeigen).
 *
 * Damit die Münze MEHRFACH rotiert und trotzdem genau auf dem Ergebnis
 * landet, rechnen wir vom aktuellen Winkel aus weiter:
 *   neuer Winkel = aktueller Winkel + volle Umdrehungen + Rest bis zur Seite
 * Der Rest wird mit "modulo" berechnet. Weil % in JavaScript bei negativen
 * Zahlen negativ bleibt, wird zweimal mit 360 gerechnet: ((x % 360) + 360) % 360.
 */
export function zielWinkel(aktuell, ergebnis, umdrehungen) {
  const ziel = ergebnis === "zahl" ? 180 : 0;
  const rest = (((ziel - aktuell) % 360) + 360) % 360;
  return aktuell + umdrehungen * 360 + rest;
}

/**
 * Werte für die Streifen des Münzrands: für jeden von `anzahl` Streifen der
 * Winkel um die Münzmitte (0° = oben) und eine Helligkeit in Prozent. Oben
 * ist der Rand hell, unten dunkel, das gibt dem Rand Rundung ohne echte
 * Beleuchtung. Rein rechnerisch, damit es sich testen lässt.
 */
export function randWerte(anzahl) {
  const werte = [];
  for (let i = 0; i < anzahl; i++) {
    const winkel = (360 / anzahl) * i;
    const helligkeit = 46 + 16 * Math.cos((winkel * Math.PI) / 180); // 62 % oben, 30 % unten
    werte.push({ winkel, helligkeit: Math.round(helligkeit * 10) / 10 });
  }
  return werte;
}

/* ============================================================
   TEIL 2: KLEINE HELFER
   ============================================================ */

/**
 * Startet eine CSS-Animation (über eine Klasse) garantiert NEU.
 * Problem: Fügt man eine Klasse hinzu, die schon da ist, passiert nichts.
 * Also erst entfernen, dann einen "Reflow" erzwingen (offsetWidth lesen
 * zwingt den Browser, das Layout jetzt zu berechnen und damit die alte
 * Animation zu vergessen) und dann wieder hinzufügen.
 */
function animationNeuStarten(element, klasse) {
  element.classList.remove(klasse);
  void element.offsetWidth;
  element.classList.add(klasse);
}

/** Wartet `ms` Millisekunden – als Promise, damit man "await warte(…)" schreiben kann. */
function warte(ms) {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

/**
 * Baut den Münzrand: viele schmale Streifen im Kreis um die Münzmitte.
 * Jeder Streifen wird per CSS (--a) um seinen Winkel gedreht und an den
 * Außenrand geschoben; seine Höhe ist die Münzdicke. Aus der Seite gesehen
 * ergibt das einen runden Rand – wichtig für die stehende Kanten-Münze.
 * Nur Zahlen gehen in Style-Variablen, kein HTML aus Werten.
 */
function randBauen(container) {
  container.replaceChildren();
  for (const { winkel, helligkeit } of randWerte(RAND_SEGMENTE)) {
    const streifen = document.createElement("span");
    streifen.style.setProperty("--a", `${winkel}deg`);
    streifen.style.setProperty("--l", String(helligkeit));
    container.append(streifen);
  }
}

/* ============================================================
   TEIL 3: DAS SPIEL IM BROWSER
   ============================================================ */

function starteSpiel() {
  // ----- Elemente einmal suchen und merken -----
  const feldElement = document.getElementById("muenze-feld");
  const hubElement = document.getElementById("muenze-hub");
  const schattenElement = document.getElementById("muenze-schatten");
  const muenzeElement = document.getElementById("muenze");
  const standElement = document.getElementById("muenze-stand"); // dreht die Münze für KANTE hochkant (Y-Achse)
  const szeneElement = document.getElementById("muenze-szene"); // wackelt bei KANTE aus
  const randElement = document.getElementById("muenze-rand");
  const verlaufElement = document.getElementById("verlauf");
  const meldungElement = document.getElementById("meldung");
  const gewinnElement = document.getElementById("gewinn");
  const ketteElement = document.getElementById("hud-kette");
  const rekordElement = document.getElementById("hud-rekord");
  const toplisteElement = document.getElementById("topliste");
  const toplisteTitel = document.getElementById("topliste-titel");
  const resetKnopf = document.getElementById("reset");
  const resetHinweis = document.getElementById("reset-hinweis");
  const neueRundeKnopf = document.getElementById("neue-runde");
  const modusKnoepfe = [...document.querySelectorAll(".modus-leiste [data-modus]")];
  const chipKnoepfe = [...document.querySelectorAll("#chips .chip")];
  const tippKnoepfe = {
    kopf: document.getElementById("tipp-kopf"),
    kante: document.getElementById("tipp-kante"), // nur im Casino sichtbar
    zahl: document.getElementById("tipp-zahl"),
  };
  // Arcade kennt nur KOPF und ZAHL; die Kante-Taste bleibt dort versteckt
  const arcadeKnoepfe = [tippKnoepfe.kopf, tippKnoepfe.zahl];

  // Die Zeiten stehen nur HIER im Code; das CSS liest sie aus den Variablen.
  feldElement.style.setProperty("--wurf-ms", `${WURF_MS}ms`);
  feldElement.style.setProperty("--aufstell-ms", `${AUFSTELL_MS}ms`);
  feldElement.style.setProperty("--aufstell-pause", `${WURF_MS - AUFSTELL_MS}ms`); // Aufrichten endet mit der Landung
  feldElement.style.setProperty("--wackel-ms", `${WACKEL_MS}ms`);
  randBauen(randElement);

  // ----- Spielzustand -----
  let phase = "wartet"; // "wartet" | "wurf" | "vorbei"
  let kette = 0; // Arcade: aktuelle Serie richtiger Tipps
  let winkel = 0; // aktuelle Drehung der Münze in Grad (0 = KOPF, 180 = ZAHL)
  let steht = false; // true, solange die Münze nach einer KANTE hochkant steht
  let letzteWuerfe = []; // Ergebnisse für die Marken-Reihe
  let modus = modusAusUrl() ?? gespeicherterModus(); // "arcade" | "casino"
  let einsatz = ladeEinsatz(); // Casino: gewählter Chip
  let walletHudGebaut = false; // das Wallet-HUD wird erst im Casino-Modus aufgebaut

  // ---------------------------------------------------------
  // Anzeigen
  // ---------------------------------------------------------

  /** Meldung unter der Münze; `art` färbt sie (neutral/richtig/falsch). */
  function meldungSetzen(text, art = "neutral") {
    meldungElement.textContent = text;
    meldungElement.dataset.art = art;
  }

  function rekordWert() {
    // Die Topliste ist absteigend sortiert → Platz 1 = Rekord-Kette.
    return topliste(SPIEL)[0]?.punkte ?? 0;
  }

  /** Rekord-Kette im HUD. Läuft gerade eine längere Kette als der gespeicherte Rekord, zeigt es sie schon an. */
  function rekordAnzeigen() {
    rekordElement.textContent = Math.max(rekordWert(), kette);
  }

  /** Topliste (je nach Modus) und Rekord-Kette neu zeigen. */
  function seiteAktualisieren() {
    if (modus === "casino") {
      // Casino: Topliste zeigt die größten Netto-Gewinne eines einzelnen Wurfs
      toplisteAnzeigen(toplisteElement, SPIEL_CASINO, (p) => `+${p.toLocaleString("de-DE")}`);
      return;
    }
    rekordAnzeigen();
    toplisteAnzeigen(toplisteElement, SPIEL, (p) => `Kette: ${p}`);
  }

  /** Marken-Reihe der letzten Würfe neu aufbauen (K / Z / | für die Kante), nur mit textContent. */
  function verlaufAnzeigen() {
    verlaufElement.replaceChildren();
    for (const seite of letzteWuerfe) {
      const marke = document.createElement("span");
      marke.dataset.seite = seite;
      marke.textContent = seitenKuerzel(seite);
      verlaufElement.append(marke);
    }
    const text = letzteWuerfe.length === 0 ? "noch keine" : letzteWuerfe.map(seitenName).join(", ");
    verlaufElement.setAttribute("aria-label", `Letzte Würfe: ${text}`);
  }

  function verlaufLeeren() {
    letzteWuerfe = [];
    verlaufAnzeigen();
  }

  function verlaufEintragen(ergebnis) {
    letzteWuerfe.push(ergebnis);
    if (letzteWuerfe.length > VERLAUF_LAENGE) letzteWuerfe.shift();
    verlaufAnzeigen();
  }

  /** Münze ohne Animation auf eine Seite stellen (nur Startzustand). */
  function muenzeSetzen(ergebnis) {
    winkel = zielWinkel(0, ergebnis, 0);
    winkelOhneUebergang(winkel);
    muenzeElement.setAttribute("aria-label", `Münze: zeigt ${seitenName(ergebnis)}`);
  }

  /**
   * Setzt den Winkel SOFORT, ohne Drehung zu zeigen: Übergang kurz aus,
   * Wert setzen, per Reflow "festschreiben", Übergang wieder an.
   */
  function winkelOhneUebergang(grad) {
    muenzeElement.classList.add("ohne-uebergang");
    muenzeElement.style.setProperty("--winkel", `${grad}deg`);
    void muenzeElement.offsetWidth;
    muenzeElement.classList.remove("ohne-uebergang");
  }

  /** Hochkant (KANTE) oder flach (KOPF/ZAHL) stellen – sofort, ohne sichtbare Drehung. */
  function standOhneUebergang(hochkant) {
    steht = hochkant;
    standElement.classList.add("ohne-uebergang");
    standElement.classList.toggle("steht", hochkant);
    void standElement.offsetWidth;
    standElement.classList.remove("ohne-uebergang");
    hubElement.classList.toggle("kante-steht", hochkant);
  }

  /**
   * Zeigt den Wurf an und wartet, bis die Münze gelandet ist.
   * `ergebnis` ("kopf" | "zahl" | "kante") steht zu diesem Zeitpunkt längst fest.
   *
   * KANTE: Die Münze fliegt und dreht sich wie sonst (Zielwinkel 0°). Zusätzlich
   * bekommt der Außenrahmen die Klasse "steht": Er dreht die Münze um die
   * senkrechte Achse um 90°, und zwar so verzögert (--aufstell-pause), dass die
   * Drehung genau mit der Landung endet. Dann wackelt die Münze 3x aus.
   */
  async function wurfAnzeigen(ergebnis) {
    muenzeElement.setAttribute("aria-label", "Münze fliegt");
    const kante = ergebnis === "kante";
    hubElement.classList.remove("kante-steht");

    if (bewegungReduziert()) {
      // Kein Flug, keine Drehung: Seite direkt setzen (Kante: gleich hochkant) und kurz umblenden.
      winkel = zielWinkel(winkel, ergebnis, 0) % 360;
      winkelOhneUebergang(winkel);
      standOhneUebergang(kante);
      animationNeuStarten(hubElement, "umblenden");
      await warte(UMBLEND_MS);
      hubElement.classList.remove("umblenden");
    } else {
      // Steht die Münze schon hochkant und fällt wieder auf die Kante, hüpft sie nur
      // (0 Umdrehungen): Eine hochkant stehende Münze würde sich sonst wie ein Rad drehen.
      const umdrehungen = kante && steht ? 0 : UMDREHUNGEN;
      // 1. Zielwinkel berechnen (aktueller Winkel + 5 Umdrehungen + Rest bis zum Ergebnis) ...
      winkel = zielWinkel(winkel, ergebnis, umdrehungen);
      // 2. ... und in die CSS-Variable schreiben: Die Transition dreht die Münze dorthin.
      muenzeElement.style.setProperty("--winkel", `${winkel}deg`);
      // 3. KANTE: hochkant aufstellen (verzögert, endet mit der Landung); sonst wieder flach legen.
      steht = kante;
      standElement.classList.toggle("steht", kante);
      // 4. Gleichzeitig springt die Münze hoch und fällt wieder (Keyframes auf dem Hub).
      animationNeuStarten(hubElement, "fliegt");
      animationNeuStarten(schattenElement, "fliegt");
      await warte(WURF_MS);
      hubElement.classList.remove("fliegt");
      schattenElement.classList.remove("fliegt");
      // 5. Winkel auf 0° oder 180° zurückrechnen: sieht identisch aus, hält die Zahl klein.
      winkel = winkel % 360;
      winkelOhneUebergang(winkel);
      if (kante) {
        // "Oho!": Die Münze steht, wackelt 3x aus und bleibt stehen.
        hubElement.classList.add("kante-steht");
        animationNeuStarten(szeneElement, "wackelt");
        await warte(WACKEL_MS);
        szeneElement.classList.remove("wackelt");
      }
    }
    muenzeElement.setAttribute(
      "aria-label",
      kante ? "Münze: steht auf der KANTE" : `Münze: zeigt ${seitenName(ergebnis)}`,
    );
  }

  function knoepfeEinstellen() {
    // Modus nicht mitten im Wurf wechseln (der Einsatz wäre sonst schon abgebucht)
    for (const knopf of modusKnoepfe) knopf.disabled = phase === "wurf";
    if (modus === "casino") {
      casinoKnoepfeEinstellen();
      return;
    }
    const kannTippen = phase === "wartet";
    for (const knopf of arcadeKnoepfe) {
      knopf.disabled = !kannTippen;
      // Nach dem Spielende (z. B. Dialog mit Esc geschlossen) kommt man hier trotzdem weiter
      knopf.hidden = phase === "vorbei";
    }
    neueRundeKnopf.hidden = phase !== "vorbei";
  }

  /**
   * Tastatur-Nutzer verlieren den Fokus, wenn ein Knopf während des Wurfs
   * gesperrt wird (gesperrte Knöpfe können keinen Fokus halten). Danach
   * geben wir ihn zurück, damit man nicht neu durch die Seite tabben muss.
   */
  function fokusZurueckgeben(knopf) {
    if (
      knopf &&
      !knopf.disabled &&
      !knopf.hidden &&
      (document.activeElement === document.body || document.activeElement === null)
    ) {
      knopf.focus();
    }
  }

  // ---------------------------------------------------------
  // Arcade-Modus
  // ---------------------------------------------------------

  function neuesSpiel() {
    kette = 0;
    phase = "wartet";
    zahlHochzaehlen(ketteElement, 0);
    for (const knopf of Object.values(tippKnoepfe)) knopf.removeAttribute("aria-label"); // Casino-Beschriftung (mit Quote) ablegen
    verlaufLeeren();
    meldungSetzen("Kopf oder Zahl? Tippe, wie die Münze fällt.");
    seiteAktualisieren();
    knoepfeEinstellen();
  }

  /**
   * Ein Tipp. "async" erlaubt es, mit "await warte(…)" Pausen einzubauen,
   * ohne den Browser zu blockieren (die Seite bleibt bedienbar, nur
   * dieser Ablauf "schläft" kurz).
   */
  async function tippen(tipp) {
    if (modus === "casino") return casinoTippen(tipp);
    if (phase !== "wartet") return; // mitten im Wurf: Eingabe ignorieren
    if (tipp === "kante") return; // Kanten-Tipps gibt es nur im Casino
    const fokusKnopf = document.activeElement === tippKnoepfe[tipp] ? tippKnoepfe[tipp] : null;
    phase = "wurf";
    knoepfeEinstellen();

    const ergebnis = muenzeWerfen(); // Ergebnis steht fest, bevor die Animation startet
    await wurfAnzeigen(ergebnis);
    verlaufEintragen(ergebnis);

    const bewertung = wurfBewerten(tipp, ergebnis); // "richtig" | "unentschieden" (Kante) | "falsch"
    const stand = kettenStand(kette, bewertung);
    kette = stand.kette;
    zahlHochzaehlen(ketteElement, kette, 250);
    rekordAnzeigen();

    if (stand.vorbei) {
      phase = "vorbei";
      meldungSetzen(`Falsch! Es war ${seitenName(ergebnis)}.`, "falsch");
      knoepfeEinstellen();
      await warte(bewegungReduziert() ? 400 : NACH_WURF_MS + 300);

      const dialog = gameOverDialog({
        spiel: SPIEL,
        punkte: kette,
        punkteText: `Kette: ${kette}`,
        richtung: "hoch",
        format: (p) => `Kette: ${p}`, // Topliste im Dialog hübsch anzeigen
        neustart: neuesSpiel,
      });
      // Topliste + Rekord neu zeigen, sobald der Dialog zu ist (evtl. gab es einen Eintrag)
      dialog.addEventListener("close", seiteAktualisieren);
      return;
    }

    if (bewertung === "unentschieden") {
      // KANTE: weder richtig noch falsch. Die Kette bleibt, kein Dialog, nächster Wurf frei.
      meldungSetzen("KANTE! Unentschieden – die Kette bleibt.", "kante");
    } else {
      meldungSetzen(`Richtig! Es war ${seitenName(ergebnis)}. Kette: ${kette}`, "richtig");
    }
    await warte(bewegungReduziert() ? 200 : NACH_WURF_MS);
    phase = "wartet";
    knoepfeEinstellen();
    fokusZurueckgeben(fokusKnopf);
  }

  // ---------------------------------------------------------
  // Casino-Modus
  // ---------------------------------------------------------

  /** Gespeicherten Chip laden – nur erlaubte Werte, sonst 50. */
  function ladeEinsatz() {
    const gespeichert = lade(SPIEL_CASINO, "einsatz", 50);
    return CHIPS.includes(gespeichert) ? gespeichert : 50;
  }

  /** Neues Casino-Spiel: Wallet-HUD zeigen, Chip prüfen, ggf. Pleite behandeln. */
  function casinoStart() {
    if (!walletHudGebaut) {
      walletHud(document.getElementById("wallet-hud"));
      walletHudGebaut = true;
    } else {
      walletHudAktualisieren(false);
    }
    phase = "wartet";
    einsatz = ladeEinsatz();
    einsatzAnpassen();
    verlaufLeeren();
    gewinnSetzen(null);
    for (const [seite, knopf] of Object.entries(tippKnoepfe)) {
      knopf.querySelector(".tipp-quote").textContent = `×${quoteText(seite)}`; // x1,94 bzw. x47
      knopf.setAttribute("aria-label", `${seitenName(seite)}, Quote ${quoteText(seite)}`);
    }
    meldungSetzen("Wähle einen Einsatz und tippe: KOPF, ZAHL oder die seltene KANTE?");
    seiteAktualisieren();
    knoepfeEinstellen();
    if (istPleite(MINDESTEINSATZ)) pleiteDialogZeigen();
  }

  /** Ist der gewählte Chip teurer als das Konto, wird der größte bezahlbare gewählt. */
  function einsatzAnpassen() {
    const stand = kontostand();
    if (einsatz > stand) {
      einsatz = [...CHIPS].reverse().find((c) => c <= stand) ?? MINDESTEINSATZ;
    }
  }

  function einsatzWaehlen(wert) {
    einsatz = wert;
    einsatzAnpassen();
    speichere(SPIEL_CASINO, "einsatz", einsatz);
    knoepfeEinstellen();
  }

  /** "+47" / "−50" über den Tipp-Knöpfen; null leert die Anzeige. */
  function gewinnSetzen(netto) {
    gewinnElement.className = "gewinn-anzeige";
    if (netto === null) {
      gewinnElement.textContent = "";
    } else if (netto > 0) {
      gewinnElement.textContent = `+${netto.toLocaleString("de-DE")}`;
      gewinnElement.classList.add("plus");
      if (!bewegungReduziert()) gewinnElement.classList.add("blitz");
    } else {
      gewinnElement.textContent = `−${(-netto).toLocaleString("de-DE")}`; // echtes Minuszeichen (U+2212)
      gewinnElement.classList.add("minus");
    }
  }

  function casinoKnoepfeEinstellen() {
    const stand = kontostand();
    const bereit = phase === "wartet";
    for (const knopf of chipKnoepfe) {
      const wert = Number(knopf.dataset.wert);
      knopf.disabled = !bereit || wert > stand;
      knopf.setAttribute("aria-pressed", String(wert === einsatz));
    }
    for (const knopf of Object.values(tippKnoepfe)) {
      knopf.hidden = false;
      knopf.disabled = !bereit || einsatz > stand;
    }
    neueRundeKnopf.hidden = true;
  }

  /**
   * Ein Casino-Tipp. Ablauf: Einsatz abbuchen → werfen → Runde sofort
   * verbuchen → Münze landen lassen → Anzeige nachziehen.
   *
   * WARUM SOFORT VERBUCHEN? Das Ergebnis steht ja schon vor der Animation
   * fest. Würde man erst nach der Landung gutschreiben, ginge der Einsatz
   * beim Neuladen mitten im Flug verloren. So ist der Kontostand in jedem
   * Moment richtig; nur die ANZEIGE wartet, damit sie den Wurf nicht verrät.
   */
  async function casinoTippen(tipp) {
    if (phase !== "wartet") return;
    const gesetzt = einsatz;
    if (!einsatzAbbuchen(gesetzt)) {
      meldungSetzen("Dafür reicht dein Spielgeld nicht. Wähle einen kleineren Einsatz.", "falsch");
      einsatzAnpassen();
      knoepfeEinstellen();
      return;
    }
    const fokusKnopf = document.activeElement === tippKnoepfe[tipp] ? tippKnoepfe[tipp] : null;
    phase = "wurf";
    walletHudAktualisieren(); // der Einsatz verlässt sichtbar das Konto
    gewinnSetzen(null);
    knoepfeEinstellen();

    // Werfen und sofort verbuchen (Auszahlung 0 = Einsatz verloren)
    // KANTE verliert hier jeden KOPF-/ZAHL-Tipp; nur ein Tipp direkt auf KANTE gewinnt (x47).
    const ergebnis = muenzeWerfen();
    const auszahlung = casinoAuszahlung(gesetzt, tipp, ergebnis);
    rundeAbschliessen(gesetzt, auszahlung);
    const netto = nettoBerechnen(gesetzt, auszahlung);
    // Top-3-Gewinn? STILL eintragen – kein Dialog, keine Aufforderung mitten im Spiel.
    const neuerEintrag = netto > 0 && stillEintragen(SPIEL_CASINO, netto) !== null;

    await wurfAnzeigen(ergebnis);
    verlaufEintragen(ergebnis);

    // Erst jetzt zeigt die Oberfläche das Ergebnis
    walletHudAktualisieren();
    gewinnSetzen(netto);
    const meldung = casinoMeldung(tipp, ergebnis, auszahlung);
    meldungSetzen(meldung.text, meldung.art);
    if (neuerEintrag) seiteAktualisieren();
    await warte(bewegungReduziert() ? 200 : NACH_WURF_MS);

    phase = "wartet";
    einsatzAnpassen();
    knoepfeEinstellen();
    fokusZurueckgeben(fokusKnopf);
    if (istPleite(MINDESTEINSATZ)) pleiteDialogZeigen();
  }

  /** "Pleite! Neues Startgeld." – lässt sich nur per Knopf schließen. */
  function pleiteDialogZeigen() {
    if (document.getElementById("pleite-dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.className = "spiel-dialog";
    dialog.id = "pleite-dialog";
    // Nur feste Texte im HTML; die Zahl kommt per textContent
    dialog.innerHTML = `
      <h2>Pleite!</h2>
      <p>Dein Spielgeld ist aufgebraucht. Du bekommst neues Startgeld:</p>
      <p class="gross"></p>
      <div class="aktionen">
        <button class="knopf primaer" data-rolle="neu">Neues Startgeld</button>
        
      </div>`;
    dialog.querySelector(".gross").textContent = STARTGELD.toLocaleString("de-DE");
    dialog.querySelector('[data-rolle="neu"]').addEventListener("click", () => {
      pleiteNeustart();
      walletHudAktualisieren();
      dialog.close();
      dialog.remove();
      einsatzAnpassen();
      knoepfeEinstellen();
      meldungSetzen("Neues Startgeld ist da. Viel Glück!");
    });
    // Esc würde den Dialog ohne Neustart schließen → verhindern
    dialog.addEventListener("cancel", (e) => e.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("button")?.focus();
  }

  // ---------------------------------------------------------
  // Modus-Umschalter
  // ---------------------------------------------------------

  /**
   * Zeigt nur die Bereiche des aktuellen Modus. Elemente mit data-nur="casino"
   * oder data-nur="arcade" im HTML werden hier per hidden ein- und ausgeblendet.
   */
  function modusAnwenden() {
    for (const el of document.querySelectorAll("[data-nur]")) {
      el.hidden = el.dataset.nur !== modus;
    }
    for (const knopf of modusKnoepfe) {
      knopf.setAttribute("aria-pressed", String(knopf.dataset.modus === modus));
    }
    const casino = modus === "casino";
    document.querySelector(".tipp-knoepfe").classList.toggle("drei", casino); // drei Tipp-Knöpfe nur im Casino
    toplisteTitel.textContent = casino ? "Topliste · Größte Gewinne" : "Topliste · Längste Kette";
    resetKnopf.textContent = casino ? "Topliste zurücksetzen" : "Spielstand zurücksetzen";
    resetHinweis.hidden = !casino;
  }

  function modusWechseln(neuerModus) {
    if (neuerModus === modus || phase === "wurf") return;
    modus = neuerModus;
    speichere(SPIEL, "modus", modus);
    urlAktualisieren(modus);
    modusAnwenden();
    if (modus === "casino") {
      casinoStart();
    } else {
      gewinnSetzen(null);
      neuesSpiel();
    }
  }

  // ---------------------------------------------------------
  // Eingabe
  // ---------------------------------------------------------
  tippKnoepfe.kopf.addEventListener("click", () => tippen("kopf"));
  tippKnoepfe.kante.addEventListener("click", () => tippen("kante"));
  tippKnoepfe.zahl.addEventListener("click", () => tippen("zahl"));
  neueRundeKnopf.addEventListener("click", neuesSpiel);
  for (const knopf of modusKnoepfe) {
    knopf.addEventListener("click", () => modusWechseln(knopf.dataset.modus));
  }
  for (const knopf of chipKnoepfe) {
    knopf.addEventListener("click", () => einsatzWaehlen(Number(knopf.dataset.wert)));
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Browser-Kürzel nicht stören
    if (e.repeat) return; // gehaltene Taste wirft nicht dauernd
    if (document.querySelector("dialog[open]")) return; // Dialog offen → Tasten gehören ihm
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const taste = e.key?.toLowerCase();
    if (taste === "k") tippen("kopf");
    else if (taste === "z") tippen("zahl");
    else if (taste === "e" && modus === "casino") tippen("kante"); // E wie "Edge": nur im Casino
  });

  resetKnopf.addEventListener("click", () => {
    if (modus === "casino") {
      spielZuruecksetzen(SPIEL_CASINO); // löscht Casino-Topliste + gespeicherten Chip (NICHT das Spielgeld)
      speichere(SPIEL_CASINO, "einsatz", einsatz);
    } else {
      spielZuruecksetzen(SPIEL); // löscht die Arcade-Topliste (und den gemerkten Modus)
      speichere(SPIEL, "modus", modus);
    }
    seiteAktualisieren(); // leere Topliste zeigen; die laufende Runde geht weiter
  });

  tabellenFuellen();

  // ----- Start -----
  muenzeSetzen("kopf");
  verlaufAnzeigen();
  modusAnwenden();
  if (modus === "casino") casinoStart();
  else neuesSpiel();
}

/* ------------------------------------------------------------
   Lernbox-Tabellen: Die Werte werden aus den reinen Funktionen
   berechnet, damit Text und Spiel nie auseinanderlaufen.
   (textContent statt innerHTML, auch hier.)
   ------------------------------------------------------------ */

/** Eine Tabellenzeile aus Text-Zellen bauen. */
function zeileBauen(zellen) {
  const tr = document.createElement("tr");
  for (const text of zellen) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.append(td);
  }
  return tr;
}

function tabellenFuellen() {
  const prozentFormat = { maximumFractionDigits: 2 };

  // Kettenwahrscheinlichkeit n = 1 … 10
  const kettenKoerper = document.getElementById("ketten-tabelle");
  for (let n = 1; n <= 10; n++) {
    const p = kettenWahrscheinlichkeit(n);
    kettenKoerper.append(
      zeileBauen([
        String(n),
        `${(p * 100).toLocaleString("de-DE", prozentFormat)} %`,
        Math.round(1 / p).toLocaleString("de-DE"),
      ]),
    );
  }

  // Chance, faire Quote, gebotene Quote und Hausvorteil je Tipp
  const tippKoerper = document.getElementById("tipp-tabelle");
  for (const tipp of ["kopf", "zahl", "kante"]) {
    tippKoerper.append(
      zeileBauen([
        seitenName(tipp),
        `${(WAHRSCHEINLICHKEIT[tipp] * 100).toLocaleString("de-DE", prozentFormat)} %`,
        `×${faireQuote(tipp).toLocaleString("de-DE", prozentFormat)}`,
        `×${quoteText(tipp)}`,
        `${hausvorteilProzent(tipp).toLocaleString("de-DE", prozentFormat)} %`,
      ]),
    );
  }

  // Auszahlung und Hausvorteil je Chip: KOPF/ZAHL (x1,94) und KANTE (x47) nebeneinander.
  // Der Hausvorteil kommt aus der echten Rundung, deshalb weicht er je Chip leicht ab.
  const quotenKoerper = document.getElementById("quoten-tabelle");
  for (const einsatz of CHIPS) {
    const vorteil = (tipp) => (1 - erwarteteRueckzahlung(einsatz, tipp) / einsatz) * 100;
    quotenKoerper.append(
      zeileBauen([
        String(einsatz),
        auszahlungBerechnen(einsatz, "kopf").toLocaleString("de-DE"),
        `${vorteil("kopf").toLocaleString("de-DE", prozentFormat)} %`,
        auszahlungBerechnen(einsatz, "kante").toLocaleString("de-DE"),
        `${vorteil("kante").toLocaleString("de-DE", prozentFormat)} %`,
      ]),
    );
  }
}

/* ------------------------------------------------------------
   Modus aus URL oder Speicher (außerhalb von starteSpiel, weil
   sie keinen Spielzustand brauchen)
   ------------------------------------------------------------ */

/** ?modus=casino in der URL wählt den Modus vor (für Links vom Hub). */
function modusAusUrl() {
  try {
    const wunsch = new URLSearchParams(window.location.search).get("modus");
    return MODI.includes(wunsch) ? wunsch : null;
  } catch {
    return null;
  }
}

function gespeicherterModus() {
  const gespeichert = lade(SPIEL, "modus", "arcade");
  return MODI.includes(gespeichert) ? gespeichert : "arcade";
}

/** Hält die Adresszeile zum Modus passend, damit ein Neuladen im selben Modus landet. */
function urlAktualisieren(modus) {
  try {
    const url = new URL(window.location.href);
    if (modus === "casino") url.searchParams.set("modus", "casino");
    else url.searchParams.delete("modus");
    window.history.replaceState(null, "", url);
  } catch {
    /* bewusst ignoriert */
  }
}

// Nur im Browser starten. In Node (Tests) gibt es kein "document" –
// dort werden nur die reinen Funktionen oben importiert.
if (typeof document !== "undefined") {
  starteSpiel();
}
