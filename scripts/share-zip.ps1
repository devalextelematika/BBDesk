param(
    [string]$ProjectId = $env:BB_PROJECT_ID,
    [string]$ServerUrl = $env:BB_SERVER_URL
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectId -or -not $ServerUrl) {
    throw 'Run inside a BB project thread, or pass -ProjectId and -ServerUrl.'
}
$serverUri = [uri]$ServerUrl
if (-not $serverUri.IsAbsoluteUri -or $serverUri.Scheme -notin @('http', 'https') -or $serverUri.UserInfo -or $serverUri.Query -or $serverUri.Fragment) {
    throw 'ServerUrl must be an HTTP(S) server URL without credentials, query or fragment.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pluginRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = Split-Path $pluginRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw 'Invalid package version.'
}
$archiveName = 'BBDesk-' + $manifest.version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip'
$archivePath = Join-Path $outputRoot $archiveName
$verifyPath = Join-Path $outputRoot ('.download-check-' + [guid]::NewGuid().ToString('N'))

$previousServerUrl = $env:BB_SERVER_URL
$env:BB_SERVER_URL = $ServerUrl
Push-Location $pluginRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed; no archive uploaded.' }

    foreach ($kind in @('app', 'server')) {
        $metadata = Get-Content -LiteralPath ('dist/' + $kind + '.meta.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($metadata.pluginId -ne 'dashboard' -or $metadata.pluginVersion -ne $manifest.version) {
            throw ('Build metadata does not match the package: ' + $kind)
        }
    }

    $files = @(Get-ChildItem -LiteralPath $pluginRoot -File | Where-Object {
        $_.Extension -in @('.ts', '.tsx', '.css', '.mjs') -or
        $_.Name -in @('package.json', 'package-lock.json', 'tsconfig.json', 'components.json', 'PLUGIN_OVERVIEW.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md')
    })
    foreach ($directory in @('assets', 'components', 'hooks', 'lib', 'scripts', 'skills', 'dist')) {
        $files += @(Get-ChildItem -LiteralPath (Join-Path $pluginRoot $directory) -File -Recurse)
    }
    $readme = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-README.md') -Raw -Encoding UTF8
    $readme = $readme.Replace('{{VERSION}}', $manifest.version).Replace('{{BB_RANGE}}', $manifest.engines.bb).Replace('{{SDK_RANGE}}', $manifest.engines.bbPluginSdk)
    $zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in ($files | Sort-Object FullName -Unique)) {
            $relative = $file.FullName.Substring($pluginRoot.Length + 1).Replace('\', '/')
            if ($relative -match '(^|/)(node_modules|\.git|\.env(?:\.[^/]*)?|secrets|logs)(/|$)|\.(db|sqlite|zip)$') {
                throw ('Unexpected file in release: ' + $relative)
            }
            if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw ('Linked files cannot be packaged: ' + $relative)
            }
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, ('bb-plugin-dashboard/' + $relative), [System.IO.Compression.CompressionLevel]::Optimal)
        }
        $entry = $zip.CreateEntry('bb-plugin-dashboard/README.md')
        $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
        try { $writer.Write($readme) } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }

    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        foreach ($required in @('package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'server.ts', 'app.tsx', 'dist/server.js', 'dist/server.meta.json', 'dist/app.js', 'dist/app.css', 'dist/app.meta.json', 'assets/icon.svg', 'assets/logo.svg', 'skills/dashboard/SKILL.md')) {
            if (-not $archive.GetEntry('bb-plugin-dashboard/' + $required)) { throw ('Missing ZIP entry: ' + $required) }
        }
        foreach ($entry in $archive.Entries) {
            $stream = $entry.Open()
            try { $stream.CopyTo([System.IO.Stream]::Null) } finally { $stream.Dispose() }
        }
    } finally { $archive.Dispose() }

    $uploadJson = & bb project attachment upload $ProjectId --client-file $archivePath --filename $archiveName --mime-type application/zip --json
    if ($LASTEXITCODE -ne 0) { throw ('Upload failed. Local archive: ' + $archivePath) }
    $attachment = ($uploadJson -join "`n") | ConvertFrom-Json
    if (-not $attachment.path -or $attachment.sizeBytes -ne (Get-Item -LiteralPath $archivePath).Length) {
        throw 'Unexpected attachment upload response.'
    }

    & bb project attachment download $ProjectId $attachment.path --client-file $verifyPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Attachment download verification failed.' }
    $expected = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $verifyPath -Algorithm SHA256).Hash -ne $expected) {
        throw 'Downloaded ZIP does not match the uploaded archive.'
    }
    $downloadUrl = $ServerUrl.TrimEnd('/') + '/api/v1/projects/' + [uri]::EscapeDataString($ProjectId) + '/attachments/content?path=' + [uri]::EscapeDataString($attachment.path)
    Write-Output ('Archive: ' + $archivePath)
    Write-Output ('SHA256: ' + $expected)
    Write-Output ('Download: ' + $downloadUrl)
    Write-Output ('[Download ' + $archiveName + '](' + $downloadUrl + ')')
    if ($serverUri.IsLoopback) { Write-Output 'This localhost link works on the computer running BB; send the ZIP itself to other people.' }
} finally {
    if (Test-Path -LiteralPath $verifyPath) { Remove-Item -LiteralPath $verifyPath -Force }
    Pop-Location
    $env:BB_SERVER_URL = $previousServerUrl
}
