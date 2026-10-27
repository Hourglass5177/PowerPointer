param([Parameter(Mandatory=$true)][string]$InputFile, [Parameter(Mandatory=$true)][string]$OutputFile, [string]$CancelFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$office = $null
$deck = $null
$priorSecurity = $null
$priorAlerts = $null
$priorProcesses = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
function Assert-Active {
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { throw 'CANCELLED' }
}
try {
    Assert-Active
    $office = New-Object -ComObject PowerPoint.Application
    $priorSecurity = $office.AutomationSecurity
    $priorAlerts = $office.DisplayAlerts
    $office.AutomationSecurity = 3
    $office.DisplayAlerts = 1
    Assert-Active
    # Read-only and without a presentation window. Never update linked objects.
    $deck = $office.Presentations.Open($InputFile, -1, 0, 0)
    Assert-Active
    if ($deck.Permission.Enabled) { throw 'PROTECTED: 受保护的演示文稿无法生成阅读缓存' }
    $count = $deck.Slides.Count
    $deck.PrintOptions.PrintHiddenSlides = -1
    # Some Office builds ignore PrintHiddenSlides during PDF export.
    # Unhide only this read-only in-memory document; never save it back.
    for ($n = 1; $n -le $count; $n++) {
        $slide = $deck.Slides.Item($n)
        $slide.SlideShowTransition.Hidden = 0
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide)
    }
    # All slides, including hidden slides; preserve one slide per physical page.
    $range = $deck.PrintOptions.Ranges.Add(1, $count)
    Assert-Active
    $deck.ExportAsFixedFormat($OutputFile, 2, 2, 0, 1, 1, -1, $range, 4)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
    Assert-Active
    [Console]::WriteLine((@{pages=$count} | ConvertTo-Json -Compress))
} catch {
    [Console]::Error.WriteLine(('PowerPoint line {0}: {1}' -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message))
    exit 1
} finally {
    if ($deck) { try { $deck.Close() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck) }
    if ($office) {
        try {
            if ($null -ne $priorSecurity) { $office.AutomationSecurity = $priorSecurity }
            if ($null -ne $priorAlerts) { $office.DisplayAlerts = $priorAlerts }
            # PowerPoint can share its COM server with interactive windows.
            # Quit only when no pre-existing process and no other document exists.
            if ($priorProcesses.Count -eq 0 -and $office.Presentations.Count -eq 0) { $office.Quit() }
        } catch {}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($office)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
