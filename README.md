# Overhead

Satellite passes over you, with an ntfy nudge before the ones you pick. Static files only: no server, account or database.

## Host it (once)

Any HTTPS static host works. Upload this folder as is.

- **Firebase Hosting:** `firebase init hosting` (public directory: this folder, single-page app: no), then `firebase deploy`.
- **GitHub Pages:** push the folder to a repo and turn on Pages for it.

Keep the same URL from then on. Each phone's saved settings are tied to it.

## Share it

Send people the link. On their phone:

1. Open the link and tap **Use my location**.
2. **Android:** tap Install when offered. **iPhone:** in Safari tap Share, then Add to Home Screen, and open Overhead from the home screen.
3. Tap the bell on any pass and follow the three steps to connect ntfy.

Each phone gets its own private alert code, so nobody sees anyone else's alerts. Tapping any alert reopens Overhead with that phone's code, which restores alerts if the phone's storage was ever cleared.

## Update it

Edit and redeploy. Phones pick up the new version the next time they open the app online.

Each release, bump both version markers together: `core.js?v=N` in `index.html` and `overhead-vN` in `sw.js`. This makes every file arrive as one release. GitHub Pages lets phones keep files for up to 10 minutes, and a new page with an older `core.js` can stop the app.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The app: layout, styles and behaviour |
| `core.js` | Orbit maths: SGP4, Sun and Moon position, pass search, brightness |
| `extras-worker.js` | Works out bright-satellite and recent-launch passes in the background |
| `sw.js` | Offline support and updates |
| `manifest.webmanifest`, icons | Install to home screen |

## Good to know

- Your exact location stays on the phone. Only a rough area (to about 10 km) goes to Open-Meteo for the cloud forecast. Orbit data comes from CelesTrak, with a backup source if it's unreachable.
- The line under the coordinates sums up tonight's sky: cloud from dusk to 1 am, and how much of the Moon is lit. Tap it for cloud hour by hour, the best hour and Moon rise and set times. Each pass also shows the forecast cloud at its time. The forecast comes from [Open-Meteo](https://open-meteo.com) (free for non-commercial use, no key), at most once an hour, and keeps working offline for a day. The Moon is worked out on the phone.
- On phones with motion sensors, tapping the sky chart opens Find in sky.
- ntfy holds scheduled alerts for up to 3 days ahead, which covers the window the app shows.
- Brightness estimates are shown for the ISS, Tiangong and Hubble only. Other satellites show times and directions.
- Settings → Satellites has a Popular list, search by name or catalogue number, and two optional extras: Bright satellites (CelesTrak's brightest objects) and Recent launches (including Starlink trains). Extras appear under Also passing.
- Android: if the installed app plays a sound and shows "Tap to copy the URL for this app" each time it opens, long-press that notification and turn off Chrome's Full screen site controls category.
- Low-orbit satellites only. High orbits (GPS, geostationary) show in search but can't be added, because they don't make passes.
