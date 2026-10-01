# PlataformaOnline

Blazor Web App (.NET 8) que exibe uma sala 3D (Three.js) com uma TV CRT LG anos 2000 e um PlayStation 1.
A TV liga, o PS1 faz o boot, aparece um menu com os jogos da pasta `Jogos/` e o jogo escolhido roda via EmulatorJS
(dentro de um iframe `wwwroot/player.html`). Suporta joysticks (Gamepad API) e tela cheia.

## Regras obrigatórias
- Usar **apenas SDKs .NET já instalados** na máquina (5.0.301, 6.0.404, 7.0.201, 8.0.300, 8.0.302, 9.0.100-rc.2).
  Nunca instalar/baixar SDKs, runtimes ou workloads novos. O projeto usa **.NET 8.0.302 / `net8.0`**, fixado em `global.json`.
- O projeto fica **diretamente em `D:\DevGAmes\PlataformaOnline`** (`.csproj` na raiz, sem subpastas de solução/projeto).
- Não adicionar pacotes NuGet além dos que vêm no template Blazor do .NET 8 sem perguntar ao usuário.

## Estrutura
- `Program.cs` — serviços, arquivos estáticos de `Jogos/` (`/jogos`) e `Bios/` (`/bios`), API `/api/games` e `/api/bios`.
- `Services/GameLibraryService.cs`, `Models/GameInfo.cs` — varredura da pasta de jogos.
- `Components/Pages/Home.razor` — página principal (InteractiveServer), chama o módulo JS da cena.
- `wwwroot/js/` — front 3D em Three.js (`tv-scene.js`, `tv-models.js`, `boot-screens.js`, `crt-shader.js`, `input.js`).
- `wwwroot/player.html` — página do EmulatorJS (core `psx`), recebe `?game=` e `?bios=`.
- `Jogos/` — jogos do usuário (`.chd`, `.pbp`, `.iso`, `.zip` com cue+bin, `.7z`). Capa opcional `.png/.jpg` com o mesmo nome.
- `Bios/` — BIOS opcional (ex.: `scph5501.bin`); sem BIOS usa HLE.
- `Security/SecuritySetup.cs` — proteções para exposição pública: chave de acesso (`AccessKey` → cookie), rate limit,
  cabeçalhos (CSP etc.), forwarded headers do túnel. `appsettings.Production.json` restringe `AllowedHosts`.
- `Apresentacao/` — `gerar-pacote.ps1` (publica em `bin/Apresentacao/PlataformaOnline`) e `iniciar-apresentacao.bat/.ps1`
  (site só em 127.0.0.1 + Cloudflare Tunnel + chave aleatória por execução). Scripts .ps1 salvos em UTF-8 com BOM.
- `DOCS/` — apostila do projeto (HTML editável + PDF gerado pelo Edge headless).

## Comandos
- `dotnet build`
- `dotnet run`
