$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
python (Join-Path $scriptDir 'e2e.py')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
