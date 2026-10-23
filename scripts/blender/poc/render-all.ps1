# Renders the five POC scenes (10-23). Usage: .\render-all.ps1 [-Stills "40,80,130"] [-Only guess,vs]
param([string]$Stills = "", [string[]]$Only = @())
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$poc = "C:\Users\Chris\cardflip\scripts\blender\poc"
$work = "C:\Users\Chris\Downloads\CardFlip Blender POC 10-23"
$src20 = "C:\Users\Chris\Downloads\CardFlip Blender 10-20 social\src"
$assets = "C:\Users\Chris\cardflip\scripts\blender\assets"
$chz = "$src20\charizard.webp"; $lug = "$src20\lugia.webp"; $pik = "$src20\pikazek.webp"; $mag = "$src20\magikarp.webp"; $gen = "$src20\gengar.webp"
$lat = "$assets\latias-sm7-107.webp"; $dar = "$assets\darkrai-sm5-77.webp"; $jir = "$assets\jirachi-sm7-97.webp"; $lu2 = "$assets\lugia-bw8-108.webp"
$scenes = @(
  @{ n = "1-guess";  py = "guess.py";  a = @($chz, "Charizard", "") },
  @{ n = "2-vs";     py = "vs.py";     a = @($chz, "Charizard", "163", $lug, "Lugia", "189", "") },
  @{ n = "3-binder"; py = "binder.py"; a = @("", "Gengar", "56.28", $chz, $lat, $pik, $dar, $gen, $jir, $lug, $mag, $lu2) },
  @{ n = "4-top3";   py = "top3.py";   a = @("", $gen, "Gengar", "56.28", $mag, "Magikarp", "83.95", $lug, "Lugia", "189") },
  @{ n = "5-scan";   py = "scan.py";   a = @($mag, "Magikarp", "83.95", "") }
)
if ($Stills) { $env:STILLS = $Stills } else { Remove-Item Env:\STILLS -ErrorAction SilentlyContinue }
foreach ($s in $scenes) {
  if ($Only.Count -and -not ($Only -contains ($s.n -replace '^\d-', ''))) { continue }
  $out = Join-Path $work "frames\$($s.n)"
  New-Item -ItemType Directory -Force $out | Out-Null
  $args = $s.a | ForEach-Object { if ($_ -eq "") { $out } else { $_ } }
  $t0 = Get-Date
  "START $($s.n) $($t0.ToString('h:mm:ss tt'))"
  & $blender --background --python (Join-Path $poc $s.py) -- @args 2>&1 | Select-String -Pattern 'Error|Traceback|BLOOM|eevee|line \d+' | ForEach-Object { $_.Line }
  $n = (Get-ChildItem $out -Filter '*.png').Count
  "DONE  $($s.n) pngs=$n $([int]((Get-Date) - $t0).TotalSeconds) s"
}
"ALL DONE"
