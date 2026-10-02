<div align="center">

# 🎮 Ps1 Plataforma Online

### Teste seus jogos de PlayStation 1 feitos na Unity, online e em 3D

![.NET 8](https://img.shields.io/badge/.NET-8.0-512BD4?logo=dotnet&logoColor=white)
![Blazor](https://img.shields.io/badge/Blazor-Web%20App-5C2D91?logo=blazor&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white)
![EmulatorJS](https://img.shields.io/badge/EmulatorJS-PSX-E60012)
![PlayStation](https://img.shields.io/badge/PlayStation-1-003791?logo=playstation&logoColor=white)

</div>

---

## 📺 Sobre o projeto

**Ps1 Plataforma Online** é um site que funciona como uma plataforma online para testar jogos de PlayStation 1
desenvolvidos na **Unity**. Em vez de apenas abrir um emulador em uma janela, o jogo é apresentado dentro de uma
**sala 3D** com uma TV CRT LG dos anos 2000 e um PlayStation 1 de verdade na estante — do jeito que ele seria jogado
na época.

A TV liga, o console faz o boot, aparece um menu com os jogos disponíveis e o jogo escolhido roda direto na tela
da TV, com efeito de tubo CRT, tudo no navegador. Assim, quem desenvolve para PS1 pode mostrar e testar seu jogo
online, em qualquer lugar, com a mesma sensação do hardware original.

## ✨ Destaques

- 🏠 **Sala 3D interativa** com TV CRT e PlayStation 1 modelados em Three.js
- 📼 **Experiência completa**: TV ligando, boot do console e menu de seleção de jogos
- 🕹️ **Emulação no navegador** via EmulatorJS (core PSX)
- 🌀 **Shader CRT** com scanlines e curvatura de tela para o visual autêntico
- 🎮 **Suporte a joysticks** pela Gamepad API (Xbox, DualShock/DualSense e genéricos)
- 🖥️ **Tela cheia** para jogar sem distrações
- 📂 **Biblioteca automática**: os jogos da pasta são listados com capa no menu
- 🔒 **Pronto para exposição pública** com chave de acesso, rate limit e cabeçalhos de segurança

## 🏁 Arrancada do Porto

Ao lado da TV fica um carrinho do tamanho de um Hot Wheels. Clique nele: a câmera vira, a tela escurece e abre
um jogo de **arrancada** em 3D (Three.js) com uma BMW Série 3 Touring stance contra o Mustang preto do **Navalha**.

- **Dois botões**: segure **↑/W** para acelerar (deixe o giro na faixa verde) e use **Espaço** para largar na luz
  verde e trocar de marcha quando as luzes piscarem azul (troca perfeita). Joystick: R2/✕ acelera, R1/□ troca.
- **Respeito (XP)** a cada corrida, com **ranking mundial** gravado no servidor em JSON. O servidor reexecuta a
  corrida a partir dos comandos do jogador, então tempo e vencedor não podem ser forjados no navegador.
- Motor, turbo, blow-off, estouros no escape e trilha de rock são sintetizados em tempo real.
- Garagem, oficina e novos rivais já estão no catálogo (`Drag/catalog.json`) como **em breve**.

## 🧱 Tecnologias

| Camada        | Tecnologia                                  |
|---------------|---------------------------------------------|
| Back-end      | ASP.NET Core / Blazor Web App (.NET 8)      |
| Cena 3D       | Three.js                                    |
| Emulação      | EmulatorJS (core `psx`)                     |
| Entrada       | Gamepad API + teclado                       |
| Publicação    | Cloudflare Tunnel                           |

## 🎯 Para quem é

Desenvolvedores que criam jogos com estética e limitações do PlayStation 1 na Unity e querem uma vitrine online,
nostálgica e jogável para testar, compartilhar e apresentar seus projetos.

## 🤖 Desenvolvido com Claude

Este é o meu primeiro projeto desenvolvido utilizando o **Claude** (Anthropic) como ferramenta de ajuda.
O arquivo `CLAUDE.md` guarda as instruções e o contexto do projeto usados pelo Claude Code durante o desenvolvimento.

---

<div align="center">

Feito com 💙 e nostalgia dos anos 2000.

</div>
