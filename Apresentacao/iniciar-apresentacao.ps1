#Requires -Version 5.1
<#
    Sobe a PlataformaOnline para uma apresentação, com segurança:
      - o site escuta SOMENTE em 127.0.0.1 (nenhuma porta aberta na rede ou no roteador);
      - o acesso público passa por um túnel HTTPS da Cloudflare (cloudflared);
      - cada execução gera uma chave aleatória nova: só quem tem o link completo entra;
      - ao encerrar (ENTER ou Ctrl+C), site e túnel são finalizados e o link deixa de existir.
#>
param(
    [int]$Porta = 5080
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Falhar([string]$msg) {
    Write-Host ''
    Write-Host "ERRO: $msg" -ForegroundColor Red
    exit 1
}

Write-Host '=== PlataformaOnline - modo apresentação ===' -ForegroundColor Cyan

# ---------- 1. Verificações ----------
$exe = Join-Path $PSScriptRoot 'PlataformaOnline.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    Falhar 'PlataformaOnline.exe não encontrado. Rode este script de dentro da pasta gerada pelo gerar-pacote.ps1.'
}

$runtimes = & dotnet --list-runtimes 2>$null
if (-not ($runtimes -match '^Microsoft\.AspNetCore\.App 8\.')) {
    Falhar ('ASP.NET Core Runtime 8 não instalado neste computador.' +
        "`n      Instale com:  winget install Microsoft.DotNet.AspNetCore.8")
}

$cloudflared = Join-Path $PSScriptRoot 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Falhar ('cloudflared não encontrado.' +
            "`n      Instale com:  winget install --id Cloudflare.cloudflared" +
            "`n      (ou coloque o cloudflared.exe oficial nesta pasta)")
    }
    $cloudflared = $cmd.Source
}

if (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue) {
    Falhar "A porta $Porta já está em uso. Feche o outro programa ou rode: .\iniciar-apresentacao.ps1 -Porta 5090"
}

# ---------- 2. Chave de acesso aleatória (192 bits, nova a cada execução) ----------
$bytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$chave = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

# ---------- 3. Mantém o computador acordado enquanto o script roda ----------
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED
[void][Win32.Power]::SetThreadExecutionState([uint32]'0x80000001')

$app = $null
$tunel = $null
try {
    # ---------- 4. Site (somente local, modo produção, chave via variável de ambiente) ----------
    $env:ASPNETCORE_ENVIRONMENT = 'Production'
    $env:ASPNETCORE_URLS = "http://127.0.0.1:$Porta"
    $env:AccessKey = $chave

    Write-Host "Iniciando o site em http://127.0.0.1:$Porta (acesso só por esta máquina)..."
    $app = Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logs 'site.log') -RedirectStandardError (Join-Path $logs 'site-erros.log')

    # A chave não precisa ficar no ambiente deste console depois que o site leu.
    Remove-Item Env:AccessKey

    $pronto = $false
    for ($i = 0; $i -lt 60 -and -not $pronto; $i++) {
        Start-Sleep -Milliseconds 500
        if ($app.HasExited) { Falhar "O site fechou ao iniciar. Veja $logs\site-erros.log" }
        try {
            Invoke-WebRequest "http://127.0.0.1:$Porta/" -UseBasicParsing -TimeoutSec 2 | Out-Null
            $pronto = $true
        } catch {
            # 401 = site no ar e exigindo a chave (esperado).
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $pronto = $true }
        }
    }
    if (-not $pronto) { Falhar "O site não respondeu. Veja $logs\site-erros.log" }

    # ---------- 5. Túnel HTTPS da Cloudflare ----------
    Write-Host 'Abrindo o túnel HTTPS da Cloudflare...'
    $tunelLog = Join-Path $logs 'tunel.log'
    Remove-Item -LiteralPath $tunelLog -ErrorAction SilentlyContinue
    $tunel = Start-Process -FilePath $cloudflared -WindowStyle Hidden -PassThru `
        -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Porta" `
        -RedirectStandardError $tunelLog -RedirectStandardOutput (Join-Path $logs 'tunel-saida.log')

    $url = $null
    for ($i = 0; $i -lt 90 -and -not $url; $i++) {
        Start-Sleep -Milliseconds 500
        if ($tunel.HasExited) { Falhar "O túnel fechou. Veja $tunelLog" }
        if (Test-Path -LiteralPath $tunelLog) {
            $m = Select-String -LiteralPath $tunelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value }
        }
    }
    if (-not $url) { Falhar "Não foi possível obter o link do túnel. Veja $tunelLog" }

    $link = "$url/?chave=$chave"
    try { Set-Clipboard -Value $link } catch { }

    Write-Host ''
    Write-Host '================ PRONTO ================' -ForegroundColor Green
    Write-Host ' Link da apresentação (já copiado):' -ForegroundColor Green
    Write-Host " $link" -ForegroundColor Yellow
    Write-Host '========================================' -ForegroundColor Green
    Write-Host ' - Envie o link só para o seu público. Quem não tiver a chave vê "Acesso restrito".'
    Write-Host ' - O túnel pode levar até 30 s para responder na primeira vez.'
    Write-Host ' - Ao encerrar, o link para de funcionar e a próxima execução gera outro.'
    Write-Host ''
    Read-Host 'Pressione ENTER para encerrar a apresentação' | Out-Null
}
finally {
    Write-Host 'Encerrando site e túnel...'
    foreach ($p in @($tunel, $app)) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item Env:AccessKey -ErrorAction SilentlyContinue
    [void][Win32.Power]::SetThreadExecutionState([uint32]'0x80000000')   # libera a suspensão
    Write-Host 'Encerrado.'
}
