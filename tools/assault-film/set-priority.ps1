# Raises the priority class of one process tree (the browser started with -Marker in its command line, plus all
# descendants) and of any extra PIDs. Prints JSON with each process touched. Only for this re-enactment's own processes.
param([string]$Marker = '', [string]$ExtraPid = '', [string]$Priority = 'AboveNormal')
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$targets = @{}
if ($Marker) {
  $roots = $all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Marker) -and $_.Name -eq 'chrome.exe' }
  $queue = New-Object System.Collections.Queue
  foreach ($r in $roots) { $queue.Enqueue([int]$r.ProcessId) }
  while ($queue.Count -gt 0) {
    $id = $queue.Dequeue()
    if ($targets.ContainsKey($id)) { continue }
    $targets[$id] = $true
    foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $id })) { $queue.Enqueue([int]$c.ProcessId) }
  }
}
foreach ($p in ($ExtraPid -split ',' | Where-Object { $_ })) { $targets[[int]$p] = $true }
$out = foreach ($id in $targets.Keys) {
  try { $proc = Get-Process -Id $id -ErrorAction Stop; $before = "$($proc.PriorityClass)"; if ($Priority) { $proc.PriorityClass = $Priority }
        [pscustomobject]@{ pid = $id; name = $proc.ProcessName; before = $before; after = "$($proc.PriorityClass)"; cpuSec = [math]::Round($proc.TotalProcessorTime.TotalSeconds, 2) } }
  catch { [pscustomobject]@{ pid = $id; error = $_.Exception.Message } }
}
@($out) | ConvertTo-Json -Compress
