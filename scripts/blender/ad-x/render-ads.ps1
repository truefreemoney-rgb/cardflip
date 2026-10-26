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
  # C v1 (phone.py, price hidden) was "plain and boring" (Chris 10-26); C v2 = the lowball story. Magikarp checked 10-26.
  @{ n = "C-lowball"; py = "lowball.py"; a = @("$src\magikarp.png", "Magikarp", "30th Classic Collection  #030", "80.48", "I'll give you", "`$5 for it", "C:\Users\Chris\cardflip\public\brand\cardflip-logo.png", "") }
)
if ($Stills) { $env:STILLS = $Stills } else { Remove-Item Env:\STILLS -ErrorAction SilentlyContinue }
foreach ($s in $scenes) {
  if ($Only.Count -and -not ($Only -contains ($s.n -replace '^[A-Z]-', ''))) { continue }
  $out = Join-Path $work "frames\$($s.n)"
  New-Item -ItemType Directory -Force $out | Out-Null
  $args = $s.a | ForEach-Object { if ($_ -eq "") { $out } else { $_ } }
  $t0 = Get-Date
  "START $($s.n) $($t0.ToString('h:mm:ss tt'))"
  & $blender --background --python (Join-Path $dir $s.py) -- @args 2>&1 | Select-String -Pattern 'Error|Traceback|BLOOM|eevee|line \d+' | ForEach-Object { $_.Line }
  $n = (Get-ChildItem $out -Filter '*.png').Count
  "DONE  $($s.n) pngs=$n $([int]((Get-Date) - $t0).TotalSeconds) s"
}
"ALL DONE"
