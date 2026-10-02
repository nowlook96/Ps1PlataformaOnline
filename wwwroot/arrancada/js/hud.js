// HUD da corrida: conta-giros em canvas (faixa de largada, zona de troca perfeita, luzes de troca),
// marcha, velocidade, árvore de largada, barra de progresso e mensagens.

const START_A = Math.PI * 0.75, END_A = Math.PI * 2.25;

export class Hud {
    constructor(root) {
        this.root = root;
        this.el = q => root.querySelector(q);
        this.tach = this.el('#tach');
        this.ctx = this.tach.getContext('2d');
        this.msg = this.el('#hud-msg');
        this.msgTimer = 0;
        this.tree = [...root.querySelectorAll('#hud-tree .bulb')];
        this.barMe = this.el('#bar-me');
        this.barOpp = this.el('#bar-opp');
        this.oppName = this.el('#hud-opp-name');
        this.timer = this.el('#hud-timer');
        this._dpr = 0;
    }

    show(on) { this.root.classList.toggle('hidden', !on); }

    setup({ car, launch, opponentName }) {
        this.car = car;
        this.launch = launch;
        this.maxRpm = Math.ceil((car.limiterRpm + 500) / 1000) * 1000;
        this.oppName.textContent = opponentName;
        this.setTree({});
        this.message('');
    }

    message(text, kind = '', time = 1.2) {
        this.msg.textContent = text;
        this.msg.className = 'hud-msg ' + kind + (text ? ' show' : '');
        this.msgTimer = time;
    }

    setTree({ stage = false, amber = 0, green = false, red = false }) {
        const on = [stage, amber >= 1, amber >= 2, amber >= 3, green, red];
        this.tree.forEach((b, i) => b.classList.toggle('on', on[i]));
    }

    update(dt, { rpm, gear, kmh, prelaunch, me, opp, distance, time }) {
        if (this.msgTimer > 0) {
            this.msgTimer -= dt;
            if (this.msgTimer <= 0) this.msg.classList.remove('show');
        }
        this.barMe.style.width = Math.min(100, me / distance * 100) + '%';
        this.barOpp.style.width = Math.min(100, opp / distance * 100) + '%';
        this.timer.textContent = time == null ? '0.000' : Math.max(0, time).toFixed(3);
        this._drawTach(rpm, gear, kmh, prelaunch);
    }

    _drawTach(rpm, gear, kmh, prelaunch) {
        const c = this.tach, ctx = this.ctx;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const size = c.clientWidth || 260;
        if (this._dpr !== dpr || c.width !== Math.round(size * dpr)) {
            this._dpr = dpr;
            c.width = c.height = Math.round(size * dpr);
        }
        const S = c.width, cx = S / 2, cy = S / 2, R = S * 0.42;
        ctx.clearRect(0, 0, S, S);
        const car = this.car;
        const a = r => START_A + (END_A - START_A) * Math.min(1, Math.max(0, r / this.maxRpm));

        // Fundo.
        const bg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.08);
        bg.addColorStop(0, 'rgba(10,12,16,0.92)');
        bg.addColorStop(1, 'rgba(0,0,0,0.75)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2); ctx.fill();

        const arc = (r0, r1, w, color) => {
            ctx.strokeStyle = color; ctx.lineWidth = w;
            ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, a(r0), a(r1)); ctx.stroke();
        };
        arc(0, this.maxRpm, S * 0.012, 'rgba(255,255,255,0.18)');
        arc(car.limiterRpm - 500, this.maxRpm, S * 0.03, '#d4161c');
        if (prelaunch && this.launch) arc(this.launch.min, this.launch.max, S * 0.045, '#22d35b');
        else arc(car.shiftRpm - 250, car.shiftRpm + 250, S * 0.045, '#22c4ff');

        // Marcas.
        ctx.fillStyle = '#e8e8e8';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `italic 700 ${S * 0.07}px "Segoe UI", Arial`;
        for (let r = 0; r <= this.maxRpm; r += 500) {
            const ang = a(r), major = r % 1000 === 0;
            const r0 = R * (major ? 0.74 : 0.8), r1 = R * 0.86;
            ctx.strokeStyle = r >= car.limiterRpm - 500 ? '#ff4d4d' : '#ddd';
            ctx.lineWidth = major ? S * 0.012 : S * 0.006;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
            ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
            ctx.stroke();
            if (major) ctx.fillText(String(r / 1000), cx + Math.cos(ang) * R * 0.62, cy + Math.sin(ang) * R * 0.62);
        }

        // Ponteiro.
        const ang = a(rpm);
        ctx.strokeStyle = '#ff5a1f';
        ctx.lineWidth = S * 0.018;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#ff5a1f'; ctx.shadowBlur = S * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang) * R * 0.12, cy - Math.sin(ang) * R * 0.12);
        ctx.lineTo(cx + Math.cos(ang) * R * 0.88, cy + Math.sin(ang) * R * 0.88);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2); ctx.fill();

        // Marcha e velocidade.
        ctx.fillStyle = '#fff';
        ctx.font = `italic 900 ${S * 0.2}px "Segoe UI", Arial`;
        ctx.fillText(gear === 0 ? 'N' : String(gear), cx + R * 0.36, cy + R * 0.42);
        ctx.font = `italic 800 ${S * 0.11}px "Segoe UI", Arial`;
        ctx.fillText(String(Math.round(kmh)), cx - R * 0.02, cy + R * 0.5);
        ctx.font = `600 ${S * 0.045}px "Segoe UI", Arial`;
        ctx.fillStyle = '#aaa';
        ctx.fillText('KM/H', cx - R * 0.02, cy + R * 0.68);
        ctx.fillText('x1000 RPM', cx, cy - R * 0.14);

        // Luzes de troca: acendem chegando no ponto e piscam azul na janela perfeita.
        const n = 9;
        const from = car.shiftRpm - 1800;
        const perfect = !prelaunch && Math.abs(rpm - car.shiftRpm) <= 250;
        const blink = perfect && Math.floor(performance.now() / 70) % 2 === 0;
        for (let i = 0; i < n; i++) {
            const lit = rpm >= from + (i / (n - 1)) * 1800;
            const col = i < 3 ? '#22d35b' : i < 6 ? '#ffc21f' : '#ff2a2a';
            ctx.fillStyle = perfect ? (blink ? '#3fd0ff' : '#0b3a52') : lit ? col : 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.arc(cx + (i - (n - 1) / 2) * R * 0.15, cy - R * 0.34 + Math.abs(i - (n - 1) / 2) * R * 0.015, R * 0.045, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
