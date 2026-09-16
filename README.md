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

## Reaaliaikainen synkka

Laskenta- ja tulosnäkymä jakavat tilan `localStorage`n kautta ja synkataan reaaliajassa
`BroadcastChannel`illa. Voit siis avata **tulosnäkymän omaan selainikkunaan** isolle näytölle
ja pitää **laskentanäkymän** toisessa ikkunassa/välilehdessä — äänet ilmestyvät pylväisiin heti.

> Huom: synkka toimii saman selaimen ikkunoiden/välilehtien välillä samalla koneella.
> Jos iso näyttö on eri kone, peilaa näyttö (esim. HDMI) tai käytä samaa konetta kahdella näytöllä.

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
