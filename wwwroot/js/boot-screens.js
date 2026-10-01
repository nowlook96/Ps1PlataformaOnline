import { drawPsLogo } from './tv-models.js';

// Desenha o conteúdo da tela da TV (640x480) em um canvas 2D.
export const SCREEN_W = 640, SCREEN_H = 480;

const MENU = { top: 120, rowH: 54, visible: 6, left: 60, width: 520 };

export class ScreenPainter {
    constructor(games) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = SCREEN_W;
        this.canvas.height = SCREEN_H;
        this.ctx = this.canvas.getContext('2d');
        this.games = games;
        this.covers = new Map();
        for (const g of games) {
            if (!g.coverUrl) continue;
            const img = new Image();
            img.src = g.coverUrl;
            this.covers.set(g.id, img);
        }
        this.scroll = 0;
    }

    clear(color = '#000') {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }

    /** OSD azul da TV ao ligar (canal AV). */
    tvOn(t) {
        const ctx = this.ctx;
        this.clear('#0a14a8');
        ctx.fillStyle = '#7cff7c';
        ctx.font = 'bold 36px "Courier New", monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('AV1', 40, 32);
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.fillStyle = '#ffffff';
        if (t > 0.4) ctx.fillText('VOLUME ' + '|'.repeat(Math.min(18, Math.floor((t - 0.4) * 30))), 40, 410);
    }

    /** Primeira tela de boot: fundo branco, losango colorido, "Sony Computer Entertainment". */
    sony(t) {
        const ctx = this.ctx;
        const fade = Math.min(1, t / 0.6);
        this.clear('#ffffff');
        ctx.save();
        ctx.globalAlpha = fade;
        const cx = SCREEN_W / 2, cy = 190, s = 78;
        const grow = Math.min(1, t / 1.2);
        // Losango formado por quatro triângulos coloridos.
        const tri = (color, a, b) => {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.fill();
        };
        const k = s * grow;
        tri('#f6a800', [cx, cy - k], [cx + k, cy]);
        tri('#e5004f', [cx + k, cy], [cx, cy + k]);
        tri('#00a0e9', [cx, cy + k], [cx - k, cy]);
        tri('#8fc31f', [cx - k, cy], [cx, cy - k]);
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - k * 0.42, cy - k * 0.42, k * 0.84, k * 0.84);

        if (t > 1.0) {
            ctx.globalAlpha = Math.min(1, (t - 1.0) / 0.5);
            ctx.fillStyle = '#1b1b1b';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = 'bold 34px "Times New Roman", serif';
            ctx.fillText('S O N Y', cx, 330);
            ctx.font = '22px "Times New Roman", serif';
            ctx.fillText('Computer Entertainment', cx, 368);
        }
        ctx.restore();
        this._fadeOut(t, 3.6, 4.0);
    }

    /** Segunda tela de boot: fundo preto, logo PS e texto de licença. */
    psLogo(t) {
        const ctx = this.ctx;
        this.clear('#000');
        ctx.save();
        ctx.globalAlpha = Math.min(1, t / 0.5);
        drawPsLogo(ctx, SCREEN_W / 2, 200, 110);
        ctx.fillStyle = '#f0f0f0';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 30px Arial, sans-serif';
        ctx.fillText('PlayStation', SCREEN_W / 2, 330);
        ctx.font = '15px Arial, sans-serif';
        ctx.fillStyle = '#bdbdbd';
        ctx.fillText('Licensed by', SCREEN_W / 2, 380);
        ctx.fillText('Sony Computer Entertainment Inc.', SCREEN_W / 2, 400);
        ctx.restore();
        this._fadeOut(t, 2.8, 3.2);
    }

    /** Menu de seleção estilo "memory card". */
    menu(selected, t) {
        const ctx = this.ctx;
        const g = ctx.createLinearGradient(0, 0, 0, SCREEN_H);
        g.addColorStop(0, '#0d1a5c'); g.addColorStop(1, '#030824');
        ctx.fillStyle = g; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

        // Linhas decorativas animadas.
        ctx.strokeStyle = 'rgba(120,150,255,0.10)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
            const y = ((i * 70 + t * 25) % (SCREEN_H + 70)) - 35;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SCREEN_W, y - 60); ctx.stroke();
        }

        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e8ecff';
        ctx.font = 'bold 30px Arial, sans-serif';
        ctx.fillText('SELECIONE O JOGO', MENU.left, 60);
        ctx.fillStyle = '#8fa2ff';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText(this.games.length + ' jogo(s) na pasta Jogos', MENU.left, 92);

        if (this.games.length === 0) {
            ctx.fillStyle = '#ffd36b';
            ctx.font = 'bold 20px Arial, sans-serif';
            ctx.fillText('Nenhum jogo encontrado.', MENU.left, 200);
            ctx.fillStyle = '#c9d2ff';
            ctx.font = '16px Arial, sans-serif';
            ctx.fillText('Coloque arquivos .chd, .pbp, .iso, .zip ou .7z', MENU.left, 236);
            ctx.fillText('na pasta "Jogos" do projeto e recarregue a página.', MENU.left, 260);
            return;
        }

        if (selected < this.scroll) this.scroll = selected;
        if (selected >= this.scroll + MENU.visible) this.scroll = selected - MENU.visible + 1;

        for (let row = 0; row < MENU.visible; row++) {
            const i = this.scroll + row;
            if (i >= this.games.length) break;
            const game = this.games[i];
            const y = MENU.top + row * MENU.rowH;
            const isSel = i === selected;

            if (isSel) {
                const pulse = 0.55 + 0.25 * Math.sin(t * 6);
                ctx.fillStyle = 'rgba(80,120,255,' + pulse.toFixed(2) + ')';
                roundRect(ctx, MENU.left - 10, y, MENU.width + 20, MENU.rowH - 8, 8); ctx.fill();
                ctx.strokeStyle = '#d6e0ff'; ctx.lineWidth = 2; ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                roundRect(ctx, MENU.left - 10, y, MENU.width + 20, MENU.rowH - 8, 8); ctx.fill();
            }

            // Ícone / capa.
            const iconX = MENU.left, iconY = y + 4, iconS = MENU.rowH - 16;
            const cover = this.covers.get(game.id);
            if (cover && cover.complete && cover.naturalWidth > 0) {
                ctx.drawImage(cover, iconX, iconY, iconS, iconS);
            } else {
                ctx.fillStyle = '#222';
                ctx.beginPath(); ctx.arc(iconX + iconS / 2, iconY + iconS / 2, iconS / 2, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#9aa';
                ctx.beginPath(); ctx.arc(iconX + iconS / 2, iconY + iconS / 2, iconS / 2 - 2, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#111';
                ctx.beginPath(); ctx.arc(iconX + iconS / 2, iconY + iconS / 2, 5, 0, Math.PI * 2); ctx.fill();
            }

            ctx.fillStyle = isSel ? '#ffffff' : '#c9d2ff';
            ctx.font = (isSel ? 'bold ' : '') + '20px Arial, sans-serif';
            ctx.fillText(ellipsize(ctx, game.title, MENU.width - iconS - 30), iconX + iconS + 16, y + (MENU.rowH - 8) / 2 - 7);
            ctx.fillStyle = '#7f8fd6';
            ctx.font = '13px Arial, sans-serif';
            ctx.fillText(game.fileName + '  •  ' + formatSize(game.sizeBytes), iconX + iconS + 16, y + (MENU.rowH - 8) / 2 + 13);
        }

        // Barra de rolagem.
        if (this.games.length > MENU.visible) {
            const trackH = MENU.visible * MENU.rowH - 8;
            const barH = trackH * MENU.visible / this.games.length;
            const barY = MENU.top + (trackH - barH) * this.scroll / (this.games.length - MENU.visible);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(MENU.left + MENU.width + 18, MENU.top, 4, trackH);
            ctx.fillStyle = '#c9d2ff'; ctx.fillRect(MENU.left + MENU.width + 18, barY, 4, barH);
        }

        ctx.fillStyle = '#c9d2ff';
        ctx.font = '15px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↑↓ Escolher    ✕ / Enter  Iniciar    F  Tela cheia', SCREEN_W / 2, SCREEN_H - 28);
    }

    loading(title, t) {
        const ctx = this.ctx;
        this.clear('#000');
        ctx.fillStyle = '#ddd';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 22px Arial, sans-serif';
        ctx.fillText(title, SCREEN_W / 2, SCREEN_H / 2 - 30);
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('Carregando' + '.'.repeat(1 + Math.floor(t * 3) % 3), SCREEN_W / 2, SCREEN_H / 2 + 10);
    }

    /** Índice do item do menu na coordenada UV da tela (ou -1). */
    itemAtUv(u, v) {
        const x = u * SCREEN_W, y = (1 - v) * SCREEN_H;
        if (x < MENU.left - 10 || x > MENU.left + MENU.width + 10) return -1;
        const row = Math.floor((y - MENU.top) / MENU.rowH);
        if (row < 0 || row >= MENU.visible) return -1;
        const i = this.scroll + row;
        return i < this.games.length ? i : -1;
    }

    _fadeOut(t, start, end) {
        if (t <= start) return;
        this.ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, (t - start) / (end - start)).toFixed(3) + ')';
        this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
}

function formatSize(bytes) {
    if (bytes > 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB';
    return (bytes / (1 << 20)).toFixed(0) + ' MB';
}
