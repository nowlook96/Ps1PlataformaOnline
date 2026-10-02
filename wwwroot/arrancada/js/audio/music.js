// Trilha de rock pesado gerada em tempo real (inspirada no clima das trilhas de NFS Most Wanted):
// guitarras distorcidas dobradas em estéreo, baixo, bateria sintetizada. Composição original.

const BPM = 152;
const STEP = 60 / BPM / 4;   // semicolcheia

// Notas MIDI (afinação em Ré): D2 = 38.
const D = 38, E = 40, F = 41, G = 43, A = 45, Bb = 46, C = 48;

// Cada compasso: 16 passos. [nota, tipo] com tipo 'm' (abafada) ou 'o' (aberta, segura até a próxima); null = pausa.
const m = n => [n, 'm'], o = n => [n, 'o'];
const RIFFS = {
    verseA: [m(D), m(D), null, m(D), m(D), null, o(F), null, m(D), m(D), null, m(D), o(G), null, o(F), null],
    verseB: [m(D), m(D), null, m(D), m(D), null, o(Bb), null, o(A), null, null, m(D), o(G), null, o(E), null],
    chorusA: [o(D), null, null, null, null, null, null, null, o(Bb), null, null, null, null, null, null, null],
    chorusB: [o(C), null, null, null, null, null, null, null, o(A), null, null, null, o(G), null, null, null],
    bridge: [m(D), null, null, m(D), null, null, m(D), null, m(D), null, null, m(D), null, null, o(F), o(E)],
    intro: [o(D), null, null, null, null, null, null, null, null, null, null, null, m(D), m(D), m(D), m(D)]
};

// Bateria por estilo: k = bumbo, s = caixa, h = chimbal, c = prato.
const DRUMS = {
    none: { k: [], s: [], h: [] },
    verse: { k: [0, 3, 6, 8, 10, 11], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },
    chorus: { k: [0, 2, 6, 8, 10, 14], s: [4, 12], h: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ride: true },
    bridge: { k: [0, 3, 6, 8, 11, 14], s: [8], h: [0, 4, 8, 12] }
};

// Seções: [riff por compasso], estilo de bateria. A música repete a partir de "loopFrom".
const SONG = [
    { bars: ['intro', 'intro'], drums: 'none', fill: true },
    { bars: ['verseA', 'verseB', 'verseA', 'verseB'], drums: 'verse', fill: true, crash: true },
    { bars: ['chorusA', 'chorusB', 'chorusA', 'chorusB'], drums: 'chorus', fill: true, crash: true },
    { bars: ['verseA', 'verseB'], drums: 'verse', fill: false, crash: true },
    { bars: ['bridge', 'bridge'], drums: 'bridge', fill: true, crash: true },
    { bars: ['chorusA', 'chorusB', 'chorusA', 'chorusB'], drums: 'chorus', fill: true, crash: true }
];
const LOOP_FROM = 1;

const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);

export class RockMusic {
    constructor(audio) {
        this.audio = audio;
        this.playing = false;
        this.section = 0;
        this.bar = 0;
        this.step = 0;
        this.intensity = 1;
    }

    start() {
        const a = this.audio;
        if (this.playing || !a.ctx) return;
        const ctx = a.ctx;
        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
        this.out.connect(a.music);
        this.guitars = [-0.75, 0.75].map((pan, i) => this._guitarBus(pan, i ? 0.011 : 0));
        this.drumBus = ctx.createGain();
        this.drumBus.gain.value = 0.9;
        this.drumBus.connect(this.out);
        this.bassBus = ctx.createGain();
        this.bassBus.gain.value = 0.55;
        const bassLp = ctx.createBiquadFilter();
        bassLp.type = 'lowpass'; bassLp.frequency.value = 900;
        this.bassBus.connect(bassLp).connect(this.out);

        this.playing = true;
        this.section = 0; this.bar = 0; this.step = 0;
        this.nextTime = ctx.currentTime + 0.1;
        this.timer = setInterval(() => this._schedule(), 25);
    }

    stop(fade = 0.8) {
        if (!this.playing) return;
        this.playing = false;
        clearInterval(this.timer);
        const out = this.out;
        const t = this.audio.ctx.currentTime;
        out.gain.setTargetAtTime(0, t, fade / 4);
        setTimeout(() => out.disconnect(), fade * 1000 + 200);
    }

    _guitarBus(pan, delay) {
        const ctx = this.audio.ctx;
        const input = ctx.createGain();
        input.gain.value = 9;
        const shaper = ctx.createWaveShaper();
        const n = 2048, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i / (n / 2) - 1; curve[i] = Math.tanh(x * 4) * 0.9; }
        shaper.curve = curve;
        shaper.oversample = '4x';
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
        const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 700; mid.gain.value = -5; mid.Q.value = 0.9;
        const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2400; pres.gain.value = 3;
        const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 4800; cab.Q.value = 0.8;
        const dl = ctx.createDelay(0.05); dl.delayTime.value = delay;
        const g = ctx.createGain(); g.gain.value = 0.16;
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        input.connect(shaper).connect(hp).connect(mid).connect(pres).connect(cab).connect(dl).connect(g).connect(p).connect(this.out);
        return input;
    }

    _schedule() {
        const ctx = this.audio.ctx;
        while (this.nextTime < ctx.currentTime + 0.12) {
            this._playStep(this.nextTime);
            this.nextTime += STEP;
            this.step++;
            if (this.step === 16) {
                this.step = 0;
                this.bar++;
                if (this.bar >= SONG[this.section].bars.length) {
                    this.bar = 0;
                    this.section++;
                    if (this.section >= SONG.length) this.section = LOOP_FROM;
                }
            }
        }
    }

    _playStep(t) {
        const sec = SONG[this.section];
        const riff = RIFFS[sec.bars[this.bar]];
        const s = this.step;
        const lastBar = this.bar === sec.bars.length - 1;

        // Guitarra + baixo.
        const note = riff[s];
        if (note) {
            const [n, kind] = note;
            let len = 1;
            if (kind === 'o') { while (s + len < 16 && !riff[s + len]) len++; }
            const dur = kind === 'm' ? STEP * 0.9 : STEP * len * 0.98;
            this._guitar(t, n, kind === 'm', dur);
            this._bass(t, n - 12, kind === 'm' ? STEP * 0.9 : Math.min(dur, STEP * 2));
            // No refrão, reataca a nota aberta em colcheias no baixo.
            if (kind === 'o' && sec.drums === 'chorus') for (let k = 2; k < len; k += 2) this._bass(t + k * STEP, n - 12, STEP * 1.6);
        }

        // Bateria.
        const d = DRUMS[sec.drums];
        const fillNow = sec.fill && lastBar && s >= 12;
        if (fillNow) {
            this._snare(t, 0.55 + (s - 12) * 0.12);
            if (s % 2 === 0) this._kick(t);
        } else {
            if (d.k.includes(s)) this._kick(t);
            if (d.s.includes(s)) this._snare(t, 1);
            if (d.h.includes(s)) this._hat(t, d.ride ? 0.09 : 0.05, s % 4 === 0 ? 1 : 0.6);
        }
        if (sec.crash && this.bar === 0 && s === 0) this._crash(t);
    }

    _guitar(t, midi, muted, dur) {
        const ctx = this.audio.ctx;
        for (const [i, bus] of this.guitars.entries()) {
            const env = ctx.createGain();
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = muted ? 700 : 5200;
            env.gain.setValueAtTime(0, t);
            env.gain.linearRampToValueAtTime(muted ? 0.9 : 0.75, t + 0.004);
            env.gain.setTargetAtTime(muted ? 0.0 : 0.5, t + 0.01, muted ? 0.05 : dur * 0.6);
            env.gain.setTargetAtTime(0, t + dur, 0.02);
            lp.connect(env).connect(bus);
            // Power chord: tônica, quinta e oitava, com leve desafinação por canal.
            for (const [interval, gain] of [[0, 0.5], [7, 0.38], [12, 0.25]]) {
                const o = ctx.createOscillator();
                o.type = 'sawtooth';
                o.frequency.value = freq(midi + interval);
                o.detune.value = (i ? 6 : -6) + (Math.random() - 0.5) * 4;
                const g = ctx.createGain();
                g.gain.value = gain;
                o.connect(g).connect(lp);
                o.start(t);
                o.stop(t + dur + 0.15);
            }
        }
    }

    _bass(t, midi, dur) {
        const ctx = this.audio.ctx;
        const o = ctx.createOscillator(), sub = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; sub.type = 'sine';
        o.frequency.value = freq(midi); sub.frequency.value = freq(midi);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.45, t + 0.006);
        g.gain.setTargetAtTime(0.25, t + 0.02, 0.08);
        g.gain.setTargetAtTime(0, t + dur, 0.02);
        o.connect(g); sub.connect(g);
        g.connect(this.bassBus);
        o.start(t); sub.start(t); o.stop(t + dur + 0.1); sub.stop(t + dur + 0.1);
    }

    _kick(t) {
        const ctx = this.audio.ctx;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        o.connect(g).connect(this.drumBus);
        o.start(t); o.stop(t + 0.35);
        this._noise(t, 0.012, 'highpass', 3000, 0.25);
    }

    _snare(t, vel) {
        const ctx = this.audio.ctx;
        this._noise(t, 0.18, 'bandpass', 2200, 0.55 * vel, 0.7);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(230, t);
        o.frequency.exponentialRampToValueAtTime(170, t + 0.06);
        g.gain.setValueAtTime(0.45 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.connect(g).connect(this.drumBus);
        o.start(t); o.stop(t + 0.12);
    }

    _hat(t, dur, vel) { this._noise(t, dur, 'highpass', 8000, 0.16 * vel); }
    _crash(t) { this._noise(t, 1.4, 'highpass', 5200, 0.22); }

    _noise(t, dur, type, f, gain, q = 0.8) {
        const ctx = this.audio.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.audio.noise;
        const flt = ctx.createBiquadFilter();
        flt.type = type; flt.frequency.value = f; flt.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(flt).connect(g).connect(this.drumBus);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.02);
    }
}
