' Runs the daily Turso backup with no window (10-16: a visible cmd window can be
' closed by accident mid-run; same fix as catalog-sync-hidden.vbs).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Chris\cardflip"
WScript.Quit sh.Run("cmd.exe /c """"C:\Program Files\nodejs\node.exe"" scripts\backup-turso.mjs >> backups\turso\backup.log 2>&1""", 0, True)
