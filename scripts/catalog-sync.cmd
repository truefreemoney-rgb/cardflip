@echo off
rem Weekly catalog refresh (Task Scheduler: "CardFlip catalog sync").
rem Syncs the Pokemon English mirror and the MTG mirror locally (these
rem sources 429/deny cloud IPs, so this must run on Chris's PC), then
rem pushes the catalog tables to the live Turso database.
cd /d C:\Users\Chris\cardflip
echo ===== catalog sync %date% %time% =====
call npm run sync:en || echo sync:en FAILED (continuing - push sends whatever is fresh)
call npm run sync:mtg || echo sync:mtg FAILED (continuing)
"C:\Program Files\nodejs\node.exe" scripts\push-catalog.mjs
echo ===== done %date% %time% (push exit %errorlevel%) =====
