// Leitura de joysticks normalizada para o layout "standard" da Gamepad API,
// usada pelo menu da TV (input.js) e pela ponte de controle do emulador (player.html).
//
// Layout standard: 0 = ✕, 1 = ○, 2 = □, 3 = △, 4/5 = L1/R1, 6/7 = L2/R2, 8 = Select, 9 = Start,
// 10/11 = L3/R3, 12..15 = D-pad (cima, baixo, esquerda, direita).
//
// Controles USB genéricos (mapping "", comuns em adaptadores de PS2/PS1) costumam usar
// 0 = △, 1 = ○, 2 = ✕, 3 = □ e o direcional no "hat" (eixo 9) ou nos eixos 0/1.

const GENERIC_FACE = [2, 1, 3, 0];   // índice standard [✕, ○, □, △] ← botão no controle genérico
const STICK_DEAD = 0.5;

/** Lista os controles conectados (null/desconectados filtrados). */
export function listPads(nav = navigator) {
    try {
        return Array.from(nav.getGamepads?.() ?? []).filter(p => p && p.connected !== false);
    } catch {
        return [];
    }
}

/**
 * Lê um Gamepad e devolve { buttons: bool[16], lx, ly, rx, ry } no layout standard.
 * O D-pad também é acionado pelo analógico esquerdo e pelo hat switch.
 */
export function readPad(pad) {
    const raw = i => {
        const b = pad.buttons[i];
        return !!b && (b.pressed || b.value > 0.5);
    };
    const axis = i => {
        const v = pad.axes[i] ?? 0;
        return Math.abs(v) < 0.15 ? 0 : v;
    };

    const b = new Array(16).fill(false);
    const standard = pad.mapping === 'standard';

    if (standard) {
        for (let i = 0; i < 16; i++) b[i] = raw(i);
    } else {
        GENERIC_FACE.forEach((src, dst) => { b[dst] = raw(src); });
        for (let i = 4; i < 16; i++) b[i] = raw(i);

        // Hat switch: -1 = cima e avança 2/7 por posição no sentido horário; repouso fica fora de [-1, 1].
        const hat = pad.axes[9];
        if (hat !== undefined && hat >= -1.05 && hat <= 1.05) {
            const dir = Math.round((hat + 1) * 3.5); // 0 = cima, 1 = cima-dir, 2 = dir, ... 7 = cima-esq
            if (dir === 7 || dir <= 1) b[12] = true;
            if (dir >= 3 && dir <= 5) b[13] = true;
            if (dir >= 5 && dir <= 7) b[14] = true;
            if (dir >= 1 && dir <= 3) b[15] = true;
        }
    }

    const lx = axis(0), ly = axis(1);
    const rx = axis(2), ry = axis(standard ? 3 : (pad.axes.length > 5 ? 5 : 3));

    // Muitos controles genéricos mandam o direcional pelos eixos 0/1; o analógico também navega.
    if (ly < -STICK_DEAD) b[12] = true;
    if (ly > STICK_DEAD) b[13] = true;
    if (lx < -STICK_DEAD) b[14] = true;
    if (lx > STICK_DEAD) b[15] = true;

    return { buttons: b, lx, ly, rx, ry };
}

/** Nome curto do controle para exibir na interface. */
export function padName(pad) {
    return pad.id.replace(/\(.*\)/, '').trim() || 'Controle';
}
