@echo off
rem NIGHTLY catalog run (Task Scheduler: "CardFlip catalog sync", 2:00am ET; weekly until 10-13).
rem Chris 10-13: new cards must arrive on their own, with pictures and every price source we use.
rem Runs on Chris's PC because Scryfall and the Pokemon sources 429/deny cloud IPs.
rem   1. sync each game's catalog into the local mirror (new sets + cards)
rem   2. Magic printing -> TCGplayer id map (pictures come from TCGplayer first)
rem   3. push the catalog tables to Turso
rem   4. Cardmarket maps (Yu-Gi-Oh, Lorcana) into Turso cardmarket_map: new cards get the Cardmarket fill
rem   5. save new cards' pictures into our Blob (local + Turso), then replay any missed Turso batch
rem   6. record the run in Turso (price_history_meta catalog_nightly) for /admin
rem The 5-5:45am ET Vercel price crons then price the new rows (TCGplayer ids are built into the
rem Yu-Gi-Oh ids, Scryfall/Lorcast/optcgapi ids into the others, new Pokemon groups map themselves).
rem A failed step never stops the rest. Each step's exit code goes into the record.
setlocal enabledelayedexpansion
cd /d C:\Users\Chris\cardflip
set NODE="C:\Program Files\nodejs\node.exe"
set FAILS=
echo ===== catalog nightly %date% %time% =====
call npm run sync:en || set FAILS=%FAILS% sync:en
call npm run sync:mtg || set FAILS=%FAILS% sync:mtg
call npm run sync:lorcana || set FAILS=%FAILS% sync:lorcana
call npm run sync:onepiece || set FAILS=%FAILS% sync:onepiece
call npm run sync:yugioh || set FAILS=%FAILS% sync:yugioh
%NODE% scripts\mtg-tcgplayer-ids.mjs || set FAILS=%FAILS% mtg-ids
%NODE% scripts\push-catalog.mjs || set FAILS=%FAILS% push-catalog
%NODE% scripts\build-cardmarket-map.mjs --game yugioh --prod --write-db || set FAILS=%FAILS% cm-yugioh
%NODE% scripts\build-cardmarket-map.mjs --game lorcana --prod --write-db || set FAILS=%FAILS% cm-lorcana
rem save-pictures exits 3 when a source's daily cap or a 429 stops it: the rest wait for tomorrow night (not a failure).
for %%G in (lorcana onepiece pokemon yugioh mtg) do (
  %NODE% --env-file=.env.local scripts\save-pictures.mjs --game %%G --prod
  if not !errorlevel!==0 if not !errorlevel!==3 set FAILS=!FAILS! pictures:%%G
  %NODE% --env-file=.env.local scripts\push-own-pictures.mjs --game %%G || set FAILS=!FAILS! push-own:%%G
)
%NODE% scripts\catalog-nightly-record.mjs %FAILS%
echo ===== done %date% %time% (failed:%FAILS%) =====
