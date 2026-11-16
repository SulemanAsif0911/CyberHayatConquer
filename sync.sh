#!/bin/sh
# Run after editing apps-script/geo.js or apps-script/Code.template.gs:
# copies geo.js into the app and builds the final apps-script/Code.gs
cd "$(dirname "$0")"
cp apps-script/geo.js app/src/main/assets/www/js/geo.js
{ sed '/@@GEO@@/,$d' apps-script/Code.template.gs; sed '/^if (typeof window/d' apps-script/geo.js; sed '1,/@@GEO@@/d' apps-script/Code.template.gs; } > apps-script/Code.gs
echo "synced"
