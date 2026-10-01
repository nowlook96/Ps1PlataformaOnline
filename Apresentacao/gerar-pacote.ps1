#Requires -Version 5.1
<#
    Gera a pasta pronta para copiar para o notebook da apresentação:
        bin\Apresentacao\PlataformaOnline\
    Uso (na raiz do projeto):
        powershell -ExecutionPolicy Bypass -File Apresentacao\gerar-pacote.ps1 [-IncluirJogos]
    Usa só o SDK já instalado (dotnet publish dependente de framework, sem baixar runtimes).
#>
param(
    [switch]$IncluirJogos
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$destino = Join-Path $raiz 'bin\Apresentacao\PlataformaOnline'

if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }

Write-Host 'Publicando (Release)...' -ForegroundColor Cyan
& dotnet publish (Join-Path $raiz 'PlataformaOnline.csproj') -c Release -o $destino --nologo
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish falhou.' }

# Nada de configuração de desenvolvimento nem símbolos de depuração no pacote.
foreach ($f in 'appsettings.Development.json', 'global.json', 'web.config') {
    Remove-Item -LiteralPath (Join-Path $destino $f) -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $destino -Filter '*.pdb' | Remove-Item -Force

foreach ($f in 'iniciar-apresentacao.ps1', 'iniciar-apresentacao.bat', 'LEIA-ME.txt') {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $destino
}

foreach ($pasta in 'Jogos', 'Bios') {
    $alvo = Join-Path $destino $pasta
    New-Item -ItemType Directory -Force -Path $alvo | Out-Null
    if ($IncluirJogos) {
        Get-ChildItem -LiteralPath (Join-Path $raiz $pasta) -File |
            Where-Object Name -ne '.gitkeep' |
            Copy-Item -Destination $alvo
    }
}

Write-Host ''
Write-Host "Pacote pronto em: $destino" -ForegroundColor Green
if (-not $IncluirJogos) { Write-Host 'Jogos/ e Bios/ foram criadas vazias (use -IncluirJogos para copiar os seus).' }
