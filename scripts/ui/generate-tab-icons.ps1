# 原创72px线性图标，2026-10-06；不含第三方素材。
Add-Type -AssemblyName System.Drawing
$taskIconRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/mini-program/miniprogram/assets/tabs'))
foreach ($taskIconName in @('catalog','orders','support','profile')) {
  foreach ($taskIconVariant in @('normal','active')) {
    $taskBitmap = New-Object System.Drawing.Bitmap 72,72
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskColor = if ($taskIconVariant -eq 'active') { '#0071e3' } else { '#6e6e73' }
    $taskPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($taskColor)),4
    $taskPen.StartCap = $taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    if ($taskIconName -eq 'catalog') {
      $taskGraphics.DrawLine($taskPen,14,26,36,14); $taskGraphics.DrawLine($taskPen,36,14,58,26)
      $taskGraphics.DrawLine($taskPen,14,26,36,38); $taskGraphics.DrawLine($taskPen,36,38,58,26)
      $taskGraphics.DrawLine($taskPen,14,26,14,51); $taskGraphics.DrawLine($taskPen,14,51,36,63)
      $taskGraphics.DrawLine($taskPen,36,63,58,51); $taskGraphics.DrawLine($taskPen,58,51,58,26)
      $taskGraphics.DrawLine($taskPen,36,38,36,63); $taskGraphics.DrawLine($taskPen,25,20,47,32)
    } elseif ($taskIconName -eq 'orders') {
      $taskGraphics.DrawRectangle($taskPen,19,13,34,47)
      $taskGraphics.DrawLine($taskPen,27,26,45,26); $taskGraphics.DrawLine($taskPen,27,36,45,36)
      $taskGraphics.DrawLine($taskPen,27,46,38,46)
    } elseif ($taskIconName -eq 'support') {
      $taskGraphics.DrawArc($taskPen,12,14,48,40,180,180)
      $taskGraphics.DrawLine($taskPen,12,34,12,46); $taskGraphics.DrawLine($taskPen,60,34,60,46)
      $taskGraphics.DrawArc($taskPen,12,38,48,18,0,130)
      $taskGraphics.DrawLine($taskPen,12,46,18,52); $taskGraphics.DrawLine($taskPen,18,52,18,62)
      $taskGraphics.DrawLine($taskPen,18,62,30,55)
      $taskGraphics.DrawEllipse($taskPen,25,31,2,2); $taskGraphics.DrawEllipse($taskPen,44,31,2,2)
    } else {
      $taskGraphics.DrawEllipse($taskPen,25,11,22,22)
      $taskGraphics.DrawArc($taskPen,15,39,42,39,180,180)
      $taskGraphics.DrawLine($taskPen,15,58,57,58)
    }
    $taskBitmap.Save((Join-Path $taskIconRoot "$taskIconName-$taskIconVariant.png"),[System.Drawing.Imaging.ImageFormat]::Png)
    $taskPen.Dispose();$taskGraphics.Dispose();$taskBitmap.Dispose()
  }
}
