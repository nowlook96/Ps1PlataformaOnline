// Entrada unificada (teclado + Gamepad API) para navegar na TV fora do jogo.
// Durante o jogo a ponte de controle do player.html repassa o joystick ao EmulatorJS.
import { listPads, readPad } from './pad-map.js';

const REPEAT_DELAY = 0.35, REPEAT_RATE = 0.12;

// Índices no layout standard (ver pad-map.js).
const BTN = { cross: 0, circle: 1, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

export class InputManager {
    constructor({ onAction, onPadsChanged }) {
        this.onAction = onAction;
        this.onPadsChanged = onPadsChanged;
        this.prev = new Map();        // estado anterior por gamepad
        this.hold = { dir: null, time: 0, next: 0 };
        this.padsKey = '';

        this._onKey = e => this._handleKey(e);
        this._onPad = () => this._checkPads(true);
        window.addEventListener('keydown', this._onKey);
        window.addEventListener('gamepadconnected', this._onPad);
        window.addEventListener('gamepaddisconnected', this._onPad);
    }

    connectedPads() {
        return listPads();
    }

    /**
     * O navegador só expõe o joystick depois que um botão é apertado com a página em foco
     * e nem sempre dispara "gamepadconnected" (ex.: após recarregar), então a lista é conferida a cada frame.
     */
    _checkPads(force = false) {
        const pads = this.connectedPads();
        const key = pads.map(p => p.index + ':' + p.id).join('|');
        if (!force && key === this.padsKey) return pads;
        this.padsKey = key;
        this.onPadsChanged(pads);
        return pads;
    }

    _handleKey(e) {
        if (e.target instanceof HTMLInputElement) return;
        const map = {
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
            Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back',
            f: 'fullscreen', F: 'fullscreen', p: 'power', P: 'power'
        };
        const action = map[e.key];
        if (!action) return;
        e.preventDefault();
        this.onAction(action, 'keyboard');
    }

    /** Chamado a cada frame pelo loop de render. */
    poll(dt, enabled) {
        const pads = this._checkPads();
        let dir = null;

        for (const pad of pads) {
            const pressed = readPad(pad).buttons;
            const before = this.prev.get(pad.index) ?? [];
            const down = i => pressed[i] && !before[i];
            this.prev.set(pad.index, pressed);

            // Select + Start alterna tela cheia, inclusive durante o jogo.
            if ((pressed[BTN.select] && down(BTN.start)) || (pressed[BTN.start] && down(BTN.select))) {
                this.onAction('fullscreen', 'gamepad');
                continue;
            }
            if (!enabled) continue;
            if (down(BTN.cross)) this.onAction('confirm', 'gamepad');
            if (down(BTN.circle)) this.onAction('back', 'gamepad');
            if (down(BTN.start) && !pressed[BTN.select]) this.onAction('start', 'gamepad');

            if (pressed[BTN.up]) dir = 'up';
            else if (pressed[BTN.down]) dir = 'down';
        }

        // Repetição automática ao segurar o direcional.
        if (!enabled || dir !== this.hold.dir) {
            this.hold = { dir, time: 0, next: REPEAT_DELAY };
            if (enabled && dir) this.onAction(dir, 'gamepad');
        } else if (dir) {
            this.hold.time += dt;
            if (this.hold.time >= this.hold.next) {
                this.hold.next += REPEAT_RATE;
                this.onAction(dir, 'gamepad');
            }
        }
    }

    dispose() {
        window.removeEventListener('keydown', this._onKey);
        window.removeEventListener('gamepadconnected', this._onPad);
        window.removeEventListener('gamepaddisconnected', this._onPad);
    }
}
