// Controles da arrancada: um botão para acelerar (segurar) e outro para trocar de marcha (apertar).
// Teclado: ↑/W acelera, Espaço/E troca. Joystick: R2/RT ou ✕/A acelera, R1/RB ou □/X troca.
// Celular: botões na tela.
import { listPads, readPad } from '/js/pad-map.js';

const THROTTLE_KEYS = new Set(['ArrowUp', 'KeyW']);
const SHIFT_KEYS = new Set(['Space', 'KeyE', 'ShiftRight']);

export class DragInput {
    constructor({ onMenu } = {}) {
        this.keys = new Set();
        this.touchThrottle = false;
        this.shiftQueue = 0;
        this.padThrottle = false;
        this.padPrevShift = false;
        this.padPrev = [];
        this.onMenu = onMenu;
        this.enabled = true;

        this._down = e => {
            if (e.target instanceof HTMLInputElement) return;
            if (THROTTLE_KEYS.has(e.code) || SHIFT_KEYS.has(e.code)) e.preventDefault();
            if (e.repeat) return;
            this.keys.add(e.code);
            if (SHIFT_KEYS.has(e.code)) this.shiftQueue++;
            this.onMenu?.(e.code, 'key');
        };
        this._up = e => {
            // Espaço ativa botões no keyup: sem isso, um botão com foco seria clicado ao trocar de marcha.
            if (THROTTLE_KEYS.has(e.code) || SHIFT_KEYS.has(e.code)) e.preventDefault();
            this.keys.delete(e.code);
        };
        this._blur = () => { this.keys.clear(); this.touchThrottle = false; };
        window.addEventListener('keydown', this._down);
        window.addEventListener('keyup', this._up);
        window.addEventListener('blur', this._blur);
    }

    bindTouch(throttleEl, shiftEl) {
        const on = e => { e.preventDefault(); this.touchThrottle = true; throttleEl.classList.add('down'); };
        const off = e => { e?.preventDefault(); this.touchThrottle = false; throttleEl.classList.remove('down'); };
        throttleEl.addEventListener('pointerdown', on);
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) throttleEl.addEventListener(ev, off);
        shiftEl.addEventListener('pointerdown', e => {
            e.preventDefault();
            this.shiftQueue++;
            shiftEl.classList.add('down');
            setTimeout(() => shiftEl.classList.remove('down'), 120);
        });
    }

    /** Chamado a cada frame: lê joysticks. */
    poll() {
        let thr = false, shift = false;
        for (const pad of listPads()) {
            const { buttons } = readPad(pad);
            const r2 = pad.buttons[7]?.value ?? 0;
            thr ||= buttons[0] || r2 > 0.3;
            const sh = buttons[5] || buttons[2];
            shift ||= sh;
            const prev = this.padPrev[pad.index] ?? [];
            // Navegação de menu pelo joystick.
            const edge = i => buttons[i] && !prev[i];
            if (edge(9)) this.onMenu?.('Enter', 'pad');
            if (edge(1)) this.onMenu?.('Escape', 'pad');
            if (edge(12)) this.onMenu?.('ArrowUp', 'pad');
            if (edge(13)) this.onMenu?.('ArrowDown', 'pad');
            if (edge(0)) this.onMenu?.('PadConfirm', 'pad');
            this.padPrev[pad.index] = buttons.slice();
        }
        if (shift && !this.padPrevShift) this.shiftQueue++;
        this.padPrevShift = shift;
        this.padThrottle = thr;
    }

    get throttle() {
        if (!this.enabled) return false;
        for (const k of THROTTLE_KEYS) if (this.keys.has(k)) return true;
        return this.touchThrottle || this.padThrottle;
    }

    consumeShift() {
        if (!this.enabled || this.shiftQueue === 0) return false;
        this.shiftQueue--;
        return true;
    }

    clear() { this.shiftQueue = 0; }

    dispose() {
        window.removeEventListener('keydown', this._down);
        window.removeEventListener('keyup', this._up);
        window.removeEventListener('blur', this._blur);
    }
}
