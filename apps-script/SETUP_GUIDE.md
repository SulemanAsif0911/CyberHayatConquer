# Database setup (Google Sheets + Apps Script), free, no server

1. Create a new Google Sheet, name it **Cyber Hayat Conquer - Database**.
2. **Extensions > Apps Script**. Delete the default code and paste all of `Code.gs`.
3. Change `SHARED_SECRET` (long random text).
4. Pick **setup** in the function dropdown, press **Run**, allow access. The tabs **Users, Activities, Cells, Audit** appear.
5. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the Web App URL.
6. Open `app/src/main/assets/www/js/config.js` and fill in `APPS_SCRIPT_URL` and the same `SHARED_SECRET`.
7. Build the APK (see README).

After every change to `Code.gs`: **Deploy > Manage deployments > edit > New version > Deploy**.

## What is in the sheet
- **Users**: nickname, salted PIN hash, birth year, hashed phone id, status (set `status` to `blocked` to ban someone).
- **Activities**: every saved walk (distance, time, area, squares gained and stolen).
- **Cells**: one row per owned square: age group, grid x/y, owner, time. This IS the territory map.
- **Audit**: rejected walks and why (spot cheaters here).

## Test checklist
1. Install on two phones, register both (same age group).
2. Phone A: Start walk, walk a loop around a block, return to the start, Finish, Confirm. The squares turn coral on A's map.
3. Phone B: open Map near the same place: A's squares show in another colour.
4. B walks a loop overlapping A's: B's squares replace A's in the overlap. Ranks tab updates.
5. Register a third account with a different age group: it sees an empty map there (separate competition).
6. Try a walk by bike or with a fake-GPS app: it is rejected and appears in Audit.
