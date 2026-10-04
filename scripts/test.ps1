$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Missing .venv. Run .\scripts\start.ps1 -Install first."
}

Push-Location $projectRoot
try {
    & $venvPython -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw "Python tests failed." }

    node --check frontend\js\api.js
    if ($LASTEXITCODE -ne 0) { throw "api.js syntax check failed." }
    node --check frontend\js\data-adapters.js
    if ($LASTEXITCODE -ne 0) { throw "data-adapters.js syntax check failed." }
    node --check frontend\js\store.js
    if ($LASTEXITCODE -ne 0) { throw "store.js syntax check failed." }
    node --check frontend\js\phase2-ui.js
    if ($LASTEXITCODE -ne 0) { throw "phase2-ui.js syntax check failed." }
    node frontend\tests\data-layer.test.js
    if ($LASTEXITCODE -ne 0) { throw "Frontend data-layer tests failed." }

    Write-Host "All FAIR / OS checks passed." -ForegroundColor Green
}
finally {
    Pop-Location
}
