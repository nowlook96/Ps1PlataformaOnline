@echo off
rem Atalho de um clique: executa o iniciar-apresentacao.ps1 desta mesma pasta.
rem "-ExecutionPolicy Bypass" vale só para este script, sem alterar a configuração do Windows.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-apresentacao.ps1" %*
echo.
pause
