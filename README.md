# Cyber Hayat Conquer v2.0

Walk a loop on foot, confirm it, and the land inside the line you walked is yours. You only compete with people in your own age group.
Native Kotlin shell + WebView UI (`app/src/main/assets/www`), Google Sheet database through Apps Script, free APK build on GitHub.

## What is new in v2
- **Real shapes, not boxes.** Your conquest is the exact outline you walked (glowing border, shaded fill). The road you walked is the border.
- **Newer land wins.** When user2 walks over part of user1's land, that part is user2's. user1's remaining area shrinks automatically.
- **Owner label.** Each territory shows its owner's round emblem (emoji + colour of their choice) and name. Tap any territory for details.
- **See all players.** The map loads territory from zoom 11 (a whole city). The Ranks tab lists every player in your age group; tap one to fly to their land, or use "See everyone on the map".
- **Breach alerts.** While someone records a walk, their phone pings the server every 20 s. If they stand inside your land you get an alert, with their latest location. Turn on **Guard mode** (Me tab) to get a phone notification even with the app closed.
- **Hectare explained.** 1 ha = 10,000 m2 = 100 m x 100 m. A football pitch is about 0.7 ha. The app now also shows "about N football pitches" and a rank title (Scout, Explorer, Commander, Warlord, Emperor).

## How a conquest works
1. **Start walk.** Walk a loop; the dashed ring marks your start.
2. Come back within 40 m of the start: "Loop closed". Tap **Finish**.
3. Preview, then **Confirm and conquer**. The server re-checks the walk, stores your outline, and re-computes what is still visible of every older outline underneath yours.

## Breach alerts: how it works and its limits
- Intruder phone (while recording) -> `ping` every 20 s -> server finds which territory is on top at that point -> if it is not theirs, an alert is stored for the owner for 90 s.
- Owner phone: while the app is open it checks every 20 s; with Guard mode on, a small foreground service does the same with the app closed and shows a notification.
- **Children (Kids and Teens groups):** the location shared in an alert is rounded to about 100 m. Adults share the exact spot, which is inside the land they are attacking.
- Guard mode uses some battery and shows a permanent tiny notification (Android requires it). Allow "Unrestricted battery" in the permission screen so Android does not stop it.
- Apps Script is free but not instant: alerts arrive within about 20 to 40 s. It is fine for a pilot of a few dozen active players. Beyond that, move to Supabase (ask for the Supabase version).

## Accuracy
GPS chip only; fixes worse than 25 m dropped; jumps above 12 m/s dropped; Kalman smoothing; stand-still jitter ignored. The stored outline is simplified to within 1.5 m of what you walked. Area sharing between overlapping lands is sampled and accurate to about 1 to 2 %.

## Anti-cheat (server side, `apps-script/geo.js` RULES)
Fake-GPS flagged and rejected; speed over 15 km/h average or 9 m/s jumps rejected; weak signal rejected; loop must close within 40 m; area 500 m2 to 3 km2; thin out-and-back rejected; same walk cannot be submitted twice; walks older than 24 h rejected; max 3 accounts per phone; PIN lock after 5 wrong tries.

## Editing shared logic
`apps-script/geo.js` is used by the app and the server. After editing it or `Code.template.gs`, run `./sync.sh`, then paste the new `Code.gs` into Apps Script and redeploy a **new version**.

## Children: decisions that are yours
Under 13 needs a "parent agrees" tick (a checkbox, not verified consent). Territory shows where someone walks, often near home or school; only nicknames and emblems are shown, only inside the same age group, no photos or chat. Consider a privacy zone before opening to children publicly. Players can delete all their data from Me.

## Known limits
- Not compiled by the author for Android: the Kotlin was checked statically only. Server and geometry were tested end to end with a simulated Sheet.
- Territories load up to 400 outlines per view; zoom in to see all in very busy areas.
- The secret in the APK can be extracted; real protection is the server-side checks.
- Android only. No clubs, friends, photos or wearables yet.
