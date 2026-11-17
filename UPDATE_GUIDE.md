# Updating from v1 to v2 (about 15 minutes)

## A. Database (Google Apps Script)
1. Open your Google Sheet > Extensions > Apps Script.
2. Select all the old code, delete it, paste ALL of the new `apps-script/Code.gs`.
3. Set `SHARED_SECRET` to the SAME secret you used before (look at your `config.js`).
4. Choose `setup` in the function dropdown, press Run. It adds the new **Territories** tab and the new `avatar`, `color` columns. Your Users and Activities stay.
5. Deploy > Manage deployments > pencil icon > Version: **New version** > Deploy. The Web App URL stays the same.
6. The old **Cells** tab is not used any more. You can delete it. Old land from v1 does not carry over; walk again.

## B. App (GitHub)
1. Unzip the new project.
2. Open your OLD `config.js` and copy your URL and secret.
3. In the new project open `app/src/main/assets/www/js/config.js` and paste them in.
4. In your GitHub repo upload and replace everything (including the hidden `.github` folder). Easiest: delete the old files in the repo, then upload the whole new project.
5. Actions > Build Cyber Hayat Conquer APK > Run workflow. When it is green, download the new APK and install over the old one.
6. Old accounts still work. They get the default emblem; change it in Me > Change emblem.

## C. Test (two phones)
1. Both phones: sign in, allow location, notifications, battery.
2. Phone A: walk a loop, confirm. Border glows, shaded fill, A's emblem and name appear.
3. Phone B: walk a loop over part of it, confirm. That part turns B's colour and A's area shrinks (check Me).
4. Phone A: Me > Guard mode on. Phone B: Start walk and walk inside A's land. Within 20 to 40 s phone A gets "Someone is breaching your territory" and the map shows B's emblem pulsing.
5. Ranks tab: tap B's row on phone A to fly to B's land.
