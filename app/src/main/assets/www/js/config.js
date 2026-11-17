// ============================================================
// CYBER HAYAT CONQUER - app configuration
// Paste the Web App URL from Apps Script (Deploy > New deployment) and the SAME secret as in Code.gs.
// ============================================================
export const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbw4CiqmTEkBSHf8p2twj5r6sSgoOQEW4KElUYWDsEBvtJutPVhzViNA-dqneaLMDw_x/exec",
  SHARED_SECRET: "CYBER@2026",

  // Map tiles. OpenStreetMap is free. For a big public launch switch to a free-tier tile host (MapTiler, Stadia)
  // or self-host, because OSM's own servers are for light use. Use {z}/{x}/{y}.
  TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  START_CENTER: [31.5204, 74.3587],      // Lahore, used until the first GPS fix
  MAP_MIN_ZOOM: 11                       // territory is loaded from this zoom in (11 = a whole city)
};
