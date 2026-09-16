/* Monen koneen synkka (esim. 2 laskijakonetta + iso näyttö eri koneella).
 *
 * Kun tähän on täytetty Firebase-projektin asetukset, kaikki koneet jakavat
 * saman äänimäärän reaaliajassa. Jos tämä jää nulliksi, sovellus toimii
 * paikallistilassa (vain saman koneen selainikkunat synkkaavat).
 *
 * Näin otat käyttöön (n. 3 min):
 *  1. Mene https://console.firebase.google.com/ ja luo uusi projekti (ilmainen).
 *  2. Build → Realtime Database → Create database → aloita "test mode".
 *  3. Project settings (ratas) → "Your apps" → Web (</>) → rekisteröi sovellus.
 *  4. Kopioi näkyvä firebaseConfig-objekti tähän alle (varmista että
 *     databaseURL on mukana; se näyttää tältä: https://<projekti>-default-rtdb.firebasedatabase.app).
 */

window.FIREBASE_CONFIG = null;

/* Esimerkki täytettynä (korvaa omilla arvoillasi ja poista kommentti):
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "maitoset-vaalit.firebaseapp.com",
  databaseURL: "https://maitoset-vaalit-default-rtdb.firebasedatabase.app",
  projectId: "maitoset-vaalit",
  appId: "1:1234567890:web:abcdef"
};
*/
