$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$settings = @{}
Get-Content -LiteralPath (Join-Path $root '.env') | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
        $settings[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}

$binary = $settings['SPACETIME_STANDALONE']
if (-not $binary) {
    $command = Get-Command spacetimedb-standalone -ErrorAction SilentlyContinue
    if ($command) { $binary = $command.Source }
}
if (-not $binary -or -not (Test-Path -LiteralPath $binary)) {
    throw 'Set SPACETIME_STANDALONE in root .env to the local SpacetimeDB standalone executable.'
}

$url = [uri]$(if ($settings['VITE_SPACETIME_WS_URL']) { $settings['VITE_SPACETIME_WS_URL'] } else { 'ws://localhost:3000' })
if ($url.Host -notin @('localhost', '127.0.0.1')) { throw 'This script only starts a loopback database.' }
$port = if ($url.IsDefaultPort) { 3000 } else { $url.Port }
$dataDir = Join-Path $root '.local-spacetimedb'
$keyDir = Join-Path $env:LOCALAPPDATA 'SpacetimeDB\config'
$pub = Join-Path $keyDir 'id_ecdsa.pub'
$priv = Join-Path $keyDir 'id_ecdsa'
if (-not (Test-Path -LiteralPath $pub) -or -not (Test-Path -LiteralPath $priv)) {
    throw 'Local SpacetimeDB JWT keys were not found. Install and initialize the SpacetimeDB CLI first.'
}

Write-Host "Starting project SpacetimeDB on 127.0.0.1:$port"
& $binary start --data-dir $dataDir --listen-addr "127.0.0.1:$port" --jwt-pub-key-path $pub --jwt-priv-key-path $priv --non-interactive
exit $LASTEXITCODE
