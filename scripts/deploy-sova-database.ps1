$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$settings = @{}
Get-Content -LiteralPath (Join-Path $root '.env') | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
        $settings[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}

$cli = $settings['SPACETIME_CLI']
if (-not $cli) {
    $command = Get-Command spacetime -ErrorAction SilentlyContinue
    if ($command) { $cli = $command.Source }
}
if (-not $cli -or -not (Test-Path -LiteralPath $cli)) {
    throw 'Set SPACETIME_CLI in root .env to the local SpacetimeDB CLI executable.'
}

$wsUrl = [uri]$(if ($settings['VITE_SPACETIME_WS_URL']) { $settings['VITE_SPACETIME_WS_URL'] } else { 'ws://localhost:3000' })
if ($wsUrl.Host -notin @('localhost', '127.0.0.1')) { throw 'This script only deploys to a loopback database.' }
$scheme = if ($wsUrl.Scheme -eq 'wss') { 'https' } else { 'http' }
$server = "${scheme}://$($wsUrl.Authority)"
$database = if ($settings['VITE_SPACETIME_DATABASE']) { $settings['VITE_SPACETIME_DATABASE'] } else { 'broth-bullets-local' }

& $cli publish --no-config --server $server --module-path (Join-Path $root 'server') --delete-data=never --yes=skip-login $database
if ($LASTEXITCODE -ne 0) { throw 'SpacetimeDB publish failed.' }

function spacetime { & $cli @args }
& (Join-Path $root 'server\seed-sova-config.ps1') -Database $database -ServerName $server
if ($LASTEXITCODE -ne 0) { throw 'SOVA config seeding failed.' }
