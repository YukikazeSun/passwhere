$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$IconDirectory = Join-Path $ProjectRoot "src-tauri\icons"
$IconPath = Join-Path $IconDirectory "icon-source.png"

New-Item -ItemType Directory -Force -Path $IconDirectory | Out-Null

$Bitmap = New-Object System.Drawing.Bitmap 512, 512
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$Graphics.Clear([System.Drawing.Color]::Transparent)

$Background = New-Object System.Drawing.Drawing2D.GraphicsPath
$Radius = 88
$Background.AddArc(12, 12, $Radius, $Radius, 180, 90)
$Background.AddArc(412, 12, $Radius, $Radius, 270, 90)
$Background.AddArc(412, 412, $Radius, $Radius, 0, 90)
$Background.AddArc(12, 412, $Radius, $Radius, 90, 90)
$Background.CloseFigure()
$Graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(47, 111, 176))), $Background)

$Page = New-Object System.Drawing.Drawing2D.GraphicsPath
$Page.AddLine(92, 54, 338, 54)
$Page.AddLine(338, 54, 420, 136)
$Page.AddLine(420, 136, 420, 454)
$Page.AddLine(420, 454, 92, 454)
$Page.CloseFigure()
$Graphics.FillPath([System.Drawing.Brushes]::White, $Page)

$FoldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(216, 232, 245))
$Fold = New-Object System.Drawing.Drawing2D.GraphicsPath
$Fold.AddLine(338, 54, 338, 136)
$Fold.AddLine(338, 136, 420, 136)
$Fold.CloseFigure()
$Graphics.FillPath($FoldBrush, $Fold)

$SpinePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 125, 114)), 18
$SpinePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$SpinePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$Graphics.DrawLine($SpinePen, 120, 96, 120, 412)

$QuestionPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(29, 41, 53)), 56
$QuestionPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$QuestionPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$Question = New-Object System.Drawing.Drawing2D.GraphicsPath
$Question.StartFigure()
$Question.AddBezier(174, 198, 174, 104, 366, 104, 366, 210)
$Question.AddBezier(366, 210, 366, 258, 272, 258, 272, 292)
$Graphics.DrawPath($QuestionPen, $Question)

$KeyholeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(29, 41, 53))
$Graphics.FillEllipse($KeyholeBrush, 246, 362, 52, 52)
$Graphics.FillRectangle($KeyholeBrush, 259, 398, 26, 26)

$DotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 125, 114))
$Graphics.FillEllipse($DotBrush, 184, 420, 18, 18)
$Graphics.FillEllipse($DotBrush, 263, 420, 18, 18)
$Graphics.FillEllipse($DotBrush, 342, 420, 18, 18)

$Bitmap.Save($IconPath, [System.Drawing.Imaging.ImageFormat]::Png)

$DotBrush.Dispose()
$KeyholeBrush.Dispose()
$Question.Dispose()
$QuestionPen.Dispose()
$SpinePen.Dispose()
$FoldBrush.Dispose()
$Page.Dispose()
$Background.Dispose()
$Graphics.Dispose()
$Bitmap.Dispose()

Write-Host $IconPath
