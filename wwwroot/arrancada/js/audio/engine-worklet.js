// Síntese de motor no AudioWorklet: cada explosão gera um pulso que passa por ressonâncias
// do escapamento. A ordem de ignição define o caráter (V8 cross-plane "borbulha", 6 em linha é liso).

class Biquad {
    constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(200, 1, 48000); }
    set(freq, q, sr) {
        const w = 2 * Math.PI * Math.min(freq, sr * 0.45) / sr;
        const a = Math.sin(w) / (2 * q);
        const cos = Math.cos(w);
        const a0 = 1 + a;
        this.b0 = a / a0; this.b1 = 0; this.b2 = -a / a0;   // passa-banda (ganho de pico 1)
        this.a1 = -2 * cos / a0; this.a2 = (1 - a) / a0;
    }
    run(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

class EngineProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
            { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'volume', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' }
        ];
    }

    constructor(options) {
        super();
        const o = options.processorOptions ?? {};
        this.cyl = o.cylinders ?? 4;
        this.pattern = o.pattern ?? [1, 0.95, 0.98, 0.93];
        this.res = (o.resonances ?? [[160, 2, 1], [480, 3, 0.5], [1300, 2.5, 0.2]]).map(([f, q, g]) => {
            const b = new Biquad();
            b.set(f, q, sampleRate);
            return { b, g, f, q };
        });
        this.drive = o.drive ?? 2.2;
        this.rough = o.rough ?? 0.15;
        this.phase = 0;
        this.idx = 0;
        this.env = 0;
        this.lp = 0;
        this.seed = 12345;
    }

    rand() {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    process(_, outputs, params) {
        const out = outputs[0];
        const ch0 = out[0];
        if (!ch0) return true;
        const rpm = params.rpm[0], load = params.load[0], vol = params.volume[0];
        const fire = rpm / 60 * this.cyl / 2;              // explosões por segundo
        const decay = Math.exp(-(260 + rpm * 0.12) / sampleRate);
        const lpK = 1 - Math.exp(-2 * Math.PI * (900 + load * 5200 + rpm * 0.35) / sampleRate);
        const amp = 0.55 + 0.45 * load;
        for (let i = 0; i < ch0.length; i++) {
            this.phase += fire / sampleRate;
            if (this.phase >= 1) {
                this.phase -= 1;
                this.idx = (this.idx + 1) % this.pattern.length;
                this.env = this.pattern[this.idx] * amp * (1 - this.rough + this.rough * 2 * this.rand());
            }
            const noise = (this.rand() * 2 - 1) * (0.25 + 0.5 * load);
            const exc = this.env * (1 + noise);
            this.env *= decay;
            let y = exc * 0.15;
            for (const r of this.res) y += r.b.run(exc) * r.g;
            y = Math.tanh(y * this.drive);
            this.lp += (y - this.lp) * lpK;
            const s = this.lp * vol;
            for (let c = 0; c < out.length; c++) out[c][i] = s;
        }
        return true;
    }
}

registerProcessor('engine-processor', EngineProcessor);
