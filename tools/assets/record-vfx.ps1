[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BundleList,
    [Parameter(Mandatory)][string]$JobsDirectory,
    [Parameter(Mandatory)][string]$BatchRoot,
    [string]$UnityExecutable = 'C:\Program Files\Unity\Hub\Editor\2021.3.48f1\Editor\Unity.exe',
    [ValidateRange(30,3600)][int]$TimeoutSeconds = 600
)
$ErrorActionPreference = 'Stop'

function Assert-RegularAbsolutePath([string]$Value) {
    if (-not [IO.Path]::IsPathFullyQualified($Value)) { throw "Absolute path required: $Value" }
    $resolved = [IO.Path]::GetFullPath($Value)
    $ancestor = $resolved
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Unverified reparse point: $ancestor"
            }
        }
        $next = Split-Path -Parent $ancestor
        if ($next -eq $ancestor) { break }
        $ancestor = $next
    }
    return $resolved
}

$BundleList = [IO.Path]::GetFullPath($BundleList)
$JobsDirectory = Assert-RegularAbsolutePath $JobsDirectory
$BatchRoot = Assert-RegularAbsolutePath $BatchRoot
$framesRoot = Join-Path $BatchRoot 'frames'
$framesPrefix = $framesRoot.TrimEnd('\') + '\'
$jobs = @(Get-ChildItem -LiteralPath $JobsDirectory -Filter '*.json' -File)
if ($jobs.Count -eq 0) { throw "No jobs: $JobsDirectory" }
if (-not (Test-Path -LiteralPath $BundleList -PathType Leaf)) { throw "Bundle list missing: $BundleList" }
foreach ($file in $jobs) {
    $job = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    $out = Assert-RegularAbsolutePath $job.outDir
    if (-not $out.StartsWith($framesPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Job output outside this batch's frames directory: $out"
    }
    if ((Test-Path -LiteralPath $out) -and @(Get-ChildItem -LiteralPath $out -Force).Count -ne 0) {
        throw "Nonempty job output is preserved; select a new batch: $out"
    }
}

$project = Join-Path $BatchRoot 'unity-project'
if (Test-Path -LiteralPath $project) { throw "Unity project already exists; select a new batch: $project" }
$log = Join-Path $BatchRoot 'record.unity.log'
$summary = Join-Path $BatchRoot 'record.summary.txt'
$receiptPath = Join-Path $BatchRoot 'record-receipt.json'
foreach ($path in @($log,$summary,$receiptPath)) {
    if (Test-Path -LiteralPath $path) { throw "Existing batch artifact is preserved: $path" }
}
New-Item -ItemType Directory -Path (Join-Path $project 'Assets\Editor'),(Join-Path $project 'Packages'),(Join-Path $project 'ProjectSettings') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ark-vfx') -Destination (Join-Path $project 'Assets\Editor\ArkVfx') -Recurse
'{"dependencies":{}}' | Set-Content -LiteralPath (Join-Path $project 'Packages\manifest.json') -Encoding utf8
'm_EditorVersion: 2021.3.48f1' | Set-Content -LiteralPath (Join-Path $project 'ProjectSettings\ProjectVersion.txt') -Encoding utf8

$arguments = @('-batchmode','-projectPath',$project,'-executeMethod','ArkVfxRecorder.Batch',
    '-arkList',$BundleList,'-arkJobs',$JobsDirectory,'-arkSummary',$summary,'-logFile',$log)
# Start-Process joins arguments; quote each path explicitly so spaces remain intact.
$quotedArguments = @($arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' })
$process = Start-Process -FilePath $UnityExecutable -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru
$started = $process.StartTime.ToUniversalTime().ToString('o')
$exited = $process.WaitForExit($TimeoutSeconds * 1000)
if (-not $exited) { $process.Kill(); $process.WaitForExit() }
$process.Refresh()
$receipt = [ordered]@{
    pid=$process.Id; startedAt=$started; endedAt=[DateTime]::UtcNow.ToString('o')
    timeoutSeconds=$TimeoutSeconds; timedOut=(-not $exited); exitCode=$process.ExitCode
    project=$project; bundleList=$BundleList; jobs=@($jobs.FullName)
    recorderSource=(Join-Path $PSScriptRoot 'ark-vfx'); frames=$framesRoot
    log=$log; summary=$summary; receipt=$receiptPath
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$receipt | ConvertTo-Json -Depth 6
if (Test-Path -LiteralPath $summary) { Get-Content -LiteralPath $summary }
if ((-not $exited) -or $process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 35 }
    exit 1
}
