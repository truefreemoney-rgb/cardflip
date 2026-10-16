' Runs the nightly catalog sync with no window (10-16: the visible cmd window
' at 2am got closed mid-run while Chris was working, cutting off the push).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Chris\cardflip"
WScript.Quit sh.Run("cmd.exe /c ""C:\Users\Chris\cardflip\scripts\catalog-sync.cmd >> C:\Users\Chris\cardflip\backups\catalog-sync.log 2>&1""", 0, True)
