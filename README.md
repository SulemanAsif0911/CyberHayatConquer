# Cyber Hayat Conquer v1.0

Walk a loop on foot, confirm it, and the land inside is yours. You only compete with people in your own age group.
Native Kotlin shell + WebView UI (`app/src/main/assets/www`), Google Sheet database through Apps Script, free APK build on GitHub.
Same architecture and Cyber Hayat theme as the Nijah app (Onest type, coral red, dark panels, pill buttons). 100 % free to run.

## Build the APK
1. Database first: `apps-script/SETUP_GUIDE.md` (10 minutes).
2. Put the Web App URL and secret into `app/src/main/assets/www/js/config.js`.
3. Upload everything (keep `.github/workflows/main.yml`) to a GitHub repo and run the **Build Cyber Hayat Conquer APK** action.
   Download `CyberHayatConquer.apk` from the run's artifacts or the Releases page.

## How a conquest works
1. **Start walk.** The foreground service records GPS (screen off is fine).
2. Walk a loop. A dashed ring marks your start; the pill says how far you are from it.
3. Come back within 40 m of the start: the pill says "Loop closed". Tap **Finish**.
4. The phone previews the area. **Confirm and conquer** sends the track to the server.
5. The server re-checks the whole walk. If it passes, every grid square (about 22 m x 19 m) whose centre is inside the loop becomes yours.
   Squares held by someone in your age group are taken from them. Walking over your own squares just refreshes them.

## Age groups (separate maps and leaderboards)
Kids 6-12, Teens 13-17, Youth 18-29, Adults 30-44, Masters 45-59, Seniors 60+. Computed from birth year, so players move up on their own.
A Kid and an Adult can conquer the same street without affecting each other. Change the bands in `apps-script/geo.js` (GROUPS).

## Accuracy: what is done, and what is physics
- **Only the GPS chip is used** (never cell/Wi-Fi positions, which are 50-2000 m off).
- Fixes worse than 25 m are dropped; impossible jumps (> 12 m/s) are dropped; a **Kalman filter** blends the rest, weighted by each fix's accuracy.
- Stand-still jitter is ignored (a point is kept after 4 m or 10 s).
- The territory grid is ~20 m, larger than normal GPS error (3-10 m in the open), so a conquest does not flicker at the edges.
- Phone GPS is worse between tall buildings and under trees. The HUD shows live accuracy (green is 12 m or better).
- **The map** is OpenStreetMap (free, detailed worldwide), with our own territory layer on top. Building a complete world map from scratch is not realistic; OSM is what most free apps use.
  Tiles need internet. OSM's servers are meant for light use: for a public launch set `TILE_URL` in `config.js` to a free-tier tile host (MapTiler, Stadia) or self-host.

## Anti-cheat (all enforced on the server, `geo.js` RULES)
Fake-GPS apps flagged and rejected; average speed over 15 km/h or jumps over 9 m/s rejected (cars, bikes); weak-signal walks rejected;
loop must close within 40 m; area 500 m2 to 3 km2; thin "out and back" paths rejected; same walk cannot be submitted twice; walks older than 24 h rejected;
max 3 accounts per phone; PIN lock after 5 wrong tries. Tune any limit in `RULES`.

## Editing the shared logic
`apps-script/geo.js` is used by both the app and the server so the preview always matches the referee.
After editing `geo.js` or `Code.template.gs`, run `./sync.sh` (rebuilds `Code.gs`, copies `geo.js` into the app), paste the new `Code.gs` into Apps Script and redeploy.

## Children: decisions that are yours
- Under 13 needs a "parent agrees" tick at sign-up. That is a checkbox, not real parental consent verification; for a public release check the rules where you publish (COPPA in the US, similar elsewhere).
- Conquered squares show where someone walks, often around their home or school. Only nicknames are shown, only to the same age group, and there are no photos or chat. Consider adding a **privacy zone** (hide squares near the first walk) before opening it to children publicly.
- Players can delete their account and all their data from Me.

## Known limits
- **Not yet compiled or run on a phone.** The Kotlin and UI were written to match the working Nijah shell and were checked statically. The geometry, anti-cheat and the whole server were tested end to end with a simulated Sheet. If the first GitHub build shows an error, send it and it is a quick fix.
- Apps Script and Sheets are free but slow with size: fine for thousands of players and ~50,000 squares (a campus or a city district). Beyond that, move to a real database.
- Territory is loaded when you zoom in to street level (zoom 15+).
- The secret in the APK can be extracted by a determined person; real protection is the server-side checks above.
- No iOS or web build in v1 (the UI is web code, so a web/iOS wrapper is possible later). No clubs, photos, friends or wearables yet.
