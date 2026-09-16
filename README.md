# Maitosten Opiston presidentinvaalit — äänten laskenta

Yksinkertainen, backendittömän staattinen nettisivu presidentinvaalien äänten laskentaan
ja tulosten näyttämiseen isolla näytöllä. Tyyli mukailee Suomen presidentinvaalien
pylväsdiagrammia.

## Toiminnot

- **Ääntenlasku** — laskija klikkaa ehdokasta, vahvistaa äänen erillisellä dialogilla
  (estää vahinkoäänet) ja ääni kirjautuu. Mukana "kumoa viimeisin" ja "nollaa laskenta".
- **Äänten katsominen (tulokset)** — YLE-tyylinen pylväsdiagrammi, jossa kaikki ehdokkaat,
  äänimäärät, prosentit ja kärjessä oleva korostettuna. Koko näytön tila isolle näytölle.
- **Asetukset** — muokkaa vaalin nimeä ja ehdokkaita (nimet + värit).

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

1. Avaa **Asetukset** ja syötä oikeat ehdokkaat (poista esimerkkiehdokkaat).
2. Avaa **Tulokset** isolle näytölle ja paina "Koko näyttö".
3. Avaa **Ääntenlasku** laskijan ikkunaan ja aloita klikkaus + vahvistus jokaiselle äänelle.

Tekniikka: pelkkä HTML + CSS + vanilla JS, ei riippuvuuksia.
