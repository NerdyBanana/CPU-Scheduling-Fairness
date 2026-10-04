param(
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$requirements = Join-Path $projectRoot "backend\requirements.txt"

if (-not (Test-Path -LiteralPath $venvPython)) {
    $runtimePython = "C:\Users\lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (-not (Test-Path -LiteralPath $runtimePython)) {
        throw "Python runtime not found. Install Python 3.11+ or create .venv manually."
    }
    & $runtimePython -m venv --system-site-packages (Join-Path $projectRoot ".venv")
    $Install = $true
}

if ($Install) {
    & $venvPython -m pip install -r $requirements
}

$backend = Start-Process -FilePath $venvPython `
    -ArgumentList "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$frontend = Start-Process -FilePath $venvPython `
    -ArgumentList "-m", "http.server", "5500", "--directory", "frontend" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru

try {
    Start-Sleep -Seconds 2
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health"
    if ($health.status -ne "ok") {
        throw "Backend health check did not return ok."
    }
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5500/" | Out-Null
    Write-Host "FAIR / OS is running." -ForegroundColor Cyan
    Write-Host "Frontend: http://127.0.0.1:5500"
    Write-Host "API docs: http://127.0.0.1:8000/docs"
    Write-Host "Press Ctrl+C to stop both servers."
    Wait-Process -Id $backend.Id, $frontend.Id
}
finally {
    foreach ($process in @($backend, $frontend)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id
        }
    }
}
