# Maitoisten Opiston presidentinvaalit — äänten laskenta

Yksinkertainen, backendittömän staattinen nettisivu presidentinvaalien äänten laskentaan
ja tulosten näyttämiseen isolla näytöllä. Tyyli mukailee Suomen presidentinvaalien
pylväsdiagrammia.

## Toiminnot

- **Ääntenlasku** — laskija klikkaa ehdokasta (ehdokkaat numerojärjestyksessä, numero näkyy
  kuvan tilalla), vahvistaa äänen erillisellä dialogilla (estää vahinkoäänet) ja ääni kirjautuu.
  "Kumoa viimeisin" pyytää vahvistuksen ja näyttää minkä äänen poistaa. Salasanasuojattu.
- **Äänten katsominen (tulokset)** — YLE-tyylinen pylväsdiagrammi, jossa näkyy **4 eniten
  ääniä saanutta** (0 ääntä = ei näy), äänimäärät ja kärki korostettuna. Koko näytön tila
  isolle näytölle. Avoin (ei salasanaa).
- **Asetukset** — muokkaa vaalin nimeä, ehdokkaita (numero + nimi + väri + kuva) ja
  salasanoja. Salasanasuojattu.

### Salasanat
Ääntenlasku ja Asetukset ovat salasanasuojattuja. Oletukset: laskenta `Mlasku`,
asetukset `M.asetukset` (vaihdettavissa Asetuksista). **Huom:** tämä on *vahinkoeste*, ei
todellinen tietoturva — koska pilvitietokanta on test modessa (julkinen), salasanan voi
kiertää eikä se suojaa itse äänidataa. Todellinen suoja vaatii Firebase Authin + tiukat
tietokantasäännöt. Jos salasana unohtuu: poista `meta/pwCount` / `meta/pwSetup` Firebase-
konsolista → oletussalasana palautuu.

## Kaksi toimintatilaa

Sovellus tunnistaa tilan automaattisesti `firebase-config.js`-tiedostosta:

### 1. Pilvitila — useampi kone (suositeltu isoon näyttöön eri koneella)

Kun `firebase-config.js`:ään on täytetty Firebase-asetukset, **kaikki koneet jakavat saman
äänimäärän reaaliajassa**: esim. 2 laskijakonetta kirjaavat ääniä ja kolmas kone näyttää
pylväät isolla näytöllä. Äänet tallennetaan lisäyslokina (jokainen ääni oma rivi), joten
usea laskija voi kirjata yhtä aikaa ilman ristiriitoja. "Kumoa viimeisin" kumoaa vain sen
koneen oman edellisen äänen. Topbarissa näkyy vihreä **"Pilvi yhdistetty"**.

**Firebasen käyttöönotto (n. 3 min, ilmainen):**
1. https://console.firebase.google.com/ → luo projekti.
2. Build → **Realtime Database** → Create database → *test mode*.
3. Project settings → Your apps → **Web (`</>`)** → rekisteröi sovellus.
4. Kopioi `firebaseConfig`-objekti tiedostoon `firebase-config.js` (varmista että
   `databaseURL` on mukana). Commitoi ja pushaa → Vercel deployaa automaattisesti.

> Turvahuomio: *test mode* sallii julkisen luku/kirjoituksen. Lyhyeen kertaluontoiseen
> äänestykseen se riittää; nollaa laskenta ("Nollaa laskenta") ennen oikeaa laskentaa.

### 2. Paikallistila — yksi kone

Jos `firebase-config.js` on `null`, laskenta- ja tulosnäkymä synkkaavat vain **saman koneen
saman selaimen** ikkunoiden välillä (`localStorage` + `BroadcastChannel`). Avaa tulosnäkymä
omaan ikkunaan ja peilaa/laajenna se isolle näytölle (HDMI). Topbarissa näkyy harmaa **"Paikallinen"**.

## Ajaminen paikallisesti

```bash
cd maitosten-vaalit
python3 -m http.server 5190
```

Avaa selaimessa: <http://localhost:5190>

- Laskenta: <http://localhost:5190/#/count>
- Tulokset: <http://localhost:5190/#/results>
- Asetukset: <http://localhost:5190/#/setup>

Käytä `http://`-osoitetta (ei `file://`), jotta ikkunoiden välinen synkka toimii.

## Käyttö vaalipäivänä

1. Tee jokaisella koneella **kova uudelleenlataus** (Cmd+Shift+R) — varmistaa tuoreimman
   koodin (service worker on network-first; jos deployasit juuri, nosta myös `CACHE`-versio
   tiedostossa `sw.js`).
2. Avaa **Asetukset** ja syötä oikeat ehdokkaat + numerot (poista esimerkkiehdokkaat).
   Vaihda halutessasi salasanat.
3. Paina **Asetukset → "Nollaa äänet"** ennen oikeaa laskentaa (poistaa testiäänet).
4. Avaa **Tulokset** isolle näytölle ja paina "Koko näyttö".
5. Avaa **Ääntenlasku** laskijan ikkunaan ja aloita klikkaus + vahvistus jokaiselle äänelle.

Tekniikka: pelkkä HTML + CSS + vanilla JS, ei riippuvuuksia.
