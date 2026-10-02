// Áudio do jogo (Web Audio, tudo sintetizado): motores, turbo, blow-off, estouros no escape,
// cantada de pneu, vento, bipes da largada e o barramento da trilha sonora.

export const ENGINE_PROFILES = {
    'i6-turbo': {
        cylinders: 6, pattern: [1, 0.96, 0.99, 0.95, 0.98, 0.97],
        resonances: [[140, 1.8, 1], [420, 2.5, 0.55], [1100, 3, 0.25], [2400, 4, 0.08]], drive: 2.0, rough: 0.08, turbo: true
    },
    'v8-cross': {
        cylinders: 8, pattern: [1.0, 0.62, 0.95, 0.78, 0.66, 1.0, 0.72, 0.88],
        resonances: [[85, 1.6, 1.2], [240, 2.2, 0.6], [700, 2.5, 0.25]], drive: 2.6, rough: 0.18, turbo: false
    },
    'l4-turbo': {
        cylinders: 4, pattern: [1, 0.93, 0.98, 0.9],
        resonances: [[180, 2, 0.9], [520, 3, 0.6], [1500, 3, 0.25]], drive: 2.2, rough: 0.12, turbo: true
    }
};

export class GameAudio {
    constructor() {
        this.ctx = null;
        this.ready = null;
        this.musicVolume = 0.55;
        this.sfxVolume = 1;
    }

    /** Precisa ser chamado num gesto do usuário (clique/tecla). */
    unlock() {
        if (!this.ready) this.ready = this._init();
        this.ctx?.resume?.();
        return this.ready;
    }

    async _init() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        const ctx = new Ctx({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.master = ctx.createDynamicsCompressor();
        this.master.threshold.value = -10;
        this.master.ratio.value = 4;
        this.master.connect(ctx.destination);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = this.sfxVolume;
        this.sfx.connect(this.master);
        this.music = ctx.createGain();
        this.music.gain.value = this.musicVolume;
        this.music.connect(this.master);

        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        this.worklet = false;
        try {
            await ctx.audioWorklet.addModule('/arrancada/js/audio/engine-worklet.js');
            this.worklet = true;
        } catch { /* sem AudioWorklet (ex.: http fora de localhost): usa osciladores */ }
        ctx.resume?.();
        return true;
    }

    setMusicVolume(v) {
        this.musicVolume = v;
        if (this.music) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
    }

    // ---------- Vozes contínuas ----------

    createEngine(layout, { gain = 1, pan = 0 } = {}) {
        if (!this.ctx) return null;
        return new EngineVoice(this, ENGINE_PROFILES[layout] ?? ENGINE_PROFILES['i6-turbo'], gain, pan);
    }

    createLoop({ type = 'bandpass', freq = 1000, q = 1, gain = 0 } = {}) {
        if (!this.ctx) return null;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = this.ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(f).connect(g).connect(this.sfx);
        src.start();
        return {
            filter: f, gain: g,
            set: (v, fr) => {
                const t = this.ctx.currentTime;
                g.gain.setTargetAtTime(v, t, 0.05);
                if (fr) f.frequency.setTargetAtTime(fr, t, 0.05);
            },
            stop: () => { try { src.stop(); } catch { } src.disconnect(); g.disconnect(); }
        };
    }

    // ---------- Efeitos pontuais ----------

    tone(freq, dur, { type = 'square', gain = 0.12, at = 0 } = {}) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime + at;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.01);
        g.gain.setValueAtTime(gain, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx);
        o.start(t); o.stop(t + dur + 0.05);
    }

    burst({ dur = 0.3, type = 'bandpass', from = 3000, to = 800, q = 1.5, gain = 0.3, at = 0, pan = 0 }) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime + at;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.playbackRate.value = 0.9 + Math.random() * 0.3;
        const f = ctx.createBiquadFilter();
        f.type = type; f.Q.value = q;
        f.frequency.setValueAtTime(from, t);
        f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(f).connect(g).connect(p).connect(this.sfx);
        src.start(t, Math.random()); src.stop(t + dur + 0.05);
    }

    thump(freq = 70, dur = 0.12, gain = 0.4, at = 0) {
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime + at;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(freq * 2, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.5);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx);
        o.start(t); o.stop(t + dur + 0.02);
    }

    /** Estalos no escape: alguns "pops" graves com chiado. */
    backfire(count = 3, gain = 0.35, pan = 0) {
        for (let i = 0; i < count; i++) {
            const at = i * (0.05 + Math.random() * 0.07);
            this.thump(55 + Math.random() * 30, 0.09, gain, at);
            this.burst({ dur: 0.07, type: 'lowpass', from: 2600, to: 500, q: 0.7, gain: gain * 0.8, at, pan });
        }
    }

    blowOff(gain = 0.22) {
        this.burst({ dur: 0.45, type: 'bandpass', from: 4200, to: 900, q: 2.2, gain });
        this.burst({ dur: 0.25, type: 'highpass', from: 6000, to: 3000, q: 0.7, gain: gain * 0.5 });
    }

    shiftClunk() {
        this.thump(110, 0.06, 0.18);
        this.burst({ dur: 0.05, type: 'bandpass', from: 1800, to: 900, q: 3, gain: 0.08 });
    }

    uiClick() { this.tone(1400, 0.05, { type: 'triangle', gain: 0.06 }); }
}

class EngineVoice {
    constructor(audio, profile, gain, pan) {
        this.audio = audio;
        const ctx = audio.ctx;
        this.ctx = ctx;
        this.profile = profile;
        this.out = ctx.createGain();
        this.out.gain.value = gain;
        this.panner = ctx.createStereoPanner();
        this.panner.pan.value = pan;
        this.out.connect(this.panner).connect(audio.sfx);

        if (audio.worklet) {
            this.node = new AudioWorkletNode(ctx, 'engine-processor', {
                numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
                processorOptions: profile
            });
            this.node.connect(this.out);
            this.p = {
                rpm: this.node.parameters.get('rpm'),
                load: this.node.parameters.get('load'),
                volume: this.node.parameters.get('volume')
            };
        } else {
            // Alternativa sem worklet: dente-de-serra + subharmônico distorcidos e filtrados.
            this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
            this.o2 = ctx.createOscillator(); this.o2.type = 'square';
            this.shaper = ctx.createWaveShaper();
            const curve = new Float32Array(1024);
            for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); }
            this.shaper.curve = curve;
            this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
            this.vol = ctx.createGain(); this.vol.gain.value = 0;
            const g2 = ctx.createGain(); g2.gain.value = 0.4;
            this.o1.connect(this.shaper); this.o2.connect(g2).connect(this.shaper);
            this.shaper.connect(this.lp).connect(this.vol).connect(this.out);
            this.o1.start(); this.o2.start();
        }

        if (profile.turbo) {
            this.whistle = ctx.createOscillator();
            this.whistle.type = 'sine';
            this.whistleGain = ctx.createGain();
            this.whistleGain.gain.value = 0;
            this.whistle.connect(this.whistleGain).connect(this.out);
            this.whistle.start();
            this.boost = 0;
        }
    }

    /** rpm, carga 0..1 (acelerador), volume 0..1. Chamado a cada frame. */
    update(rpm, load, volume, dt = 1 / 60, redline = 7000) {
        const t = this.ctx.currentTime;
        if (this.p) {
            this.p.rpm.setTargetAtTime(rpm, t, 0.015);
            this.p.load.setTargetAtTime(load, t, 0.03);
            this.p.volume.setTargetAtTime(volume * (0.55 + 0.45 * load), t, 0.03);
        } else {
            const fire = rpm / 60 * this.profile.cylinders / 2;
            this.o1.frequency.setTargetAtTime(fire, t, 0.015);
            this.o2.frequency.setTargetAtTime(fire / 2, t, 0.015);
            this.lp.frequency.setTargetAtTime(500 + load * 2500 + rpm * 0.2, t, 0.03);
            this.vol.gain.setTargetAtTime(volume * 0.2 * (0.5 + 0.5 * load), t, 0.03);
        }
        if (this.whistle) {
            const target = load * Math.min(1, Math.max(0, (rpm - 2000) / (redline - 2500)));
            this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 2.2 : 6));
            this.whistle.frequency.setTargetAtTime(1500 + this.boost * 5200 + rpm * 0.15, t, 0.03);
            this.whistleGain.gain.setTargetAtTime(this.boost * 0.022 * volume, t, 0.04);
        }
    }

    setPan(v) { this.panner.pan.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    setGain(v) { this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

    /** Na troca com turbo: zera a pressão (o som do blow-off é disparado à parte). */
    dumpBoost() {
        const had = this.boost ?? 0;
        if (this.whistle) this.boost = 0;
        return had;
    }

    dispose() {
        try {
            this.node?.disconnect();
            this.o1?.stop(); this.o2?.stop(); this.whistle?.stop();
        } catch { }
        this.out.disconnect();
        this.panner.disconnect();
    }
}
