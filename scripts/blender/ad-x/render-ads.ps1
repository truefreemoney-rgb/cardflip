# Renders the three square X ads (10-26). Usage: .\render-ads.ps1 [-Stills "20,80,150,239"] [-Only pull,binder,phone]
# Prices were checked on TCGplayer 10-26 (latest NM sales + market). The ads run for months (Chris 10-26: "dont get to
# wrapped up in the price"): prices are examples of a scan, so no "today", no dates, no dated % on screen.
param([string]$Stills = "", [string[]]$Only = @())
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$dir = "C:\Users\Chris\cardflip\scripts\blender\ad-x"
$work = "C:\Users\Chris\Downloads\CardFlip X Ads 10-26"
$src = "$work\src"
# Charizard 30th Classic Collection #001: our TCGplayer series 10-06..10-25 (gaps joined) + today's market
$chzSeries = "148.96,142.51,139.24,140.96,142.68,144.40,145.51,141.93,137.35,134.22,134.86,138.46,141.17,143.88,143.88,143.88,147.08,150.28,153.47,156.67,159.13"
$scenes = @(
  @{ n = "A-pull"; py = "pull.py"; a = @("$src\charizard.png", "Charizard", "30th Classic Collection  #001", "159.13", "PRICE HISTORY", $chzSeries, "") },
  # 3x3 page, row by row; index 4 (Lugia, the priciest) is scanned last and lifts out. Page total $632.83.
  @{ n = "B-binder"; py = "binder.py"; a = @("", "4", "$src\charizard.png", "159.13", "$src\pikachu.png", "19.46", "$src\mew.png", "23.14",
      "$src\gengar.png", "54.32", "$src\lugia.png", "197.98", "$src\rayquaza.png", "21.68",
      "$src\magikarp.png", "80.48", "$src\pikazek.png", "29.49", "$src\latias.png", "47.15") },
  # C v1 (phone.py, price hidden) was "plain and boring", C v2 (lowball.py, the $5 note) "i hate the new C ad" (Chris
  # 10-26); C v3 = Higher or Lower? (his pick). Phone screens: node phonescreen.mjs ... "$src\phone-magikarp".
  @{ n = "C-higher"; py = "higherlower.py"; a = @("$src\pikachu.png", "19.46", "$src\magikarp.png", "80.48",
      "$src\phone-magikarp\screen_scan.png", "$src\phone-magikarp\screen_result.png", "") }
)
if ($Stills) { $env:STILLS = $Stills } else { Remove-Item Env:\STILLS -ErrorAction SilentlyContinue }
foreach ($s in $scenes) {
  if ($Only.Count -and -not ($Only -contains ($s.n -replace '^[A-Z]-', ''))) { continue }
  # Blender renders the wordless scene into raw\ (+ overlay.json); overlay.mjs draws the words into the scene folder
  $out = Join-Path $work "frames\$($s.n)"
  $rawDir = Join-Path $out "raw"
  New-Item -ItemType Directory -Force $rawDir | Out-Null
  Get-ChildItem $out, $rawDir -File -Filter '*.png' | Remove-Item   # the last version's frames
  $bargs = $s.a | ForEach-Object { if ($_ -eq "") { $rawDir } else { $_ } }
  $t0 = Get-Date
  "START $($s.n) $($t0.ToString('h:mm:ss tt'))"
  & $blender --background --python (Join-Path $dir $s.py) -- @bargs 2>&1 | Select-String -Pattern 'Error|Traceback|BLOOM|eevee|line \d+' | ForEach-Object { $_.Line }
  node (Join-Path $dir "overlay.mjs") $s.n $out
  $n = (Get-ChildItem $out -Filter '*.png').Count
  "DONE  $($s.n) pngs=$n $([int]((Get-Date) - $t0).TotalSeconds) s"
}
"ALL DONE"
