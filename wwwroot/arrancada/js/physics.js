// Física da arrancada com passo fixo e determinística.
// É espelhada linha a linha em Drag/DragPhysics.cs: o servidor reexecuta a corrida a partir das
// entradas gravadas (acelerar/trocar) e decide o resultado. Use só + - * / min max aqui
// (nada de Math.exp/pow/sin) para o JS e o C# chegarem exatamente no mesmo número.

const G = 9.81;
const RHO = 1.225;
const RPM_PER_RADS = 9.549296585513721; // 60 / (2π)
const ROT_MASS = 1.04;                  // inércia das peças girando
const CLUTCH_S = 2.0;                   // tempo máximo de embreagem patinando na largada
const CLUTCH_DROP = 900;                // quanto o giro cai enquanto a embreagem patina
const SPIN_LOSS = 0.4;                  // perda de tração com o pneu destracionando
const PERFECT_RPM = 250;                // janela de troca perfeita (± rpm em volta do shiftRpm)
const SHIFT_RPM_FOLLOW = 0.06;          // quanto o giro cai por passo durante a troca

/** Códigos dos eventos gravados: [passo, código]. */
export const EV = { THROTTLE_OFF: 0, THROTTLE_ON: 1, SHIFT: 2 };

/** Aplica as peças instaladas (efeitos multiplicativos/aditivos) sobre a física base do carro. */
export function deriveCar(physics, parts = []) {
    const c = {
        ...physics,
        gears: physics.gears.slice(),
        torque: physics.torque.map(([r, t]) => [r, t])
    };
    for (const part of parts) {
        const e = part.effects ?? {};
        if (e.torqueMult) c.torque = c.torque.map(([r, t]) => [r, t * e.torqueMult]);
        if (e.massKg) c.massKg += e.massKg;
        if (e.gripMult) c.grip *= e.gripMult;
        if (e.shiftTimeMult) c.shiftTimeS *= e.shiftTimeMult;
        if (e.cdAMult) c.cdA *= e.cdAMult;
    }
    return c;
}

export function torqueAt(c, rpm) {
    const t = c.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
        if (rpm <= t[i][0]) {
            const k = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
            return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
        }
    }
    return t[t.length - 1][1];
}

export function newRunState(c) {
    return {
        x: 0, v: 0, rpm: c.idleRpm, gear: 0, shiftT: 0,
        launched: false, launchStep: -1, launchRpm: 0, clutchT: 0, jump: false,
        spin: 0, limiter: false, accel: 0,
        finished: false, finishTime: 0,
        shifts: 0, perfect: 0, lastShift: null, topSpeed: 0
    };
}

/**
 * Avança um passo. `k` é o índice do passo (o tempo zero é o início da contagem regressiva),
 * `greenStep` é o passo em que a luz verde acende.
 */
export function stepRun(s, c, throttle, shift, k, greenStep, hz, distance) {
    const dt = 1 / hz;
    s.lastShift = null;

    if (shift) {
        if (s.gear === 0) {
            if (!s.launched) {
                s.launched = true;
                s.gear = 1;
                s.launchStep = k;
                s.jump = k < greenStep;
                s.launchRpm = s.rpm;
                s.clutchT = 0;
                s.lastShift = 'launch';
            }
        } else if (s.gear < c.gears.length && s.shiftT <= 0) {
            const diff = s.rpm - c.shiftRpm;
            const perfect = diff >= -PERFECT_RPM && diff <= PERFECT_RPM;
            s.gear += 1;
            s.shifts += 1;
            if (perfect) s.perfect += 1;
            s.shiftT = perfect ? c.shiftTimeS * 0.5 : c.shiftTimeS;
            s.lastShift = perfect ? 'perfect' : diff < -1200 ? 'early' : diff < -PERFECT_RPM ? 'good' : 'late';
        }
    }

    let force = 0;
    s.limiter = false;

    if (s.gear === 0) {
        // Ponto morto: o motor sobe e desce livre (acelerando no lugar antes da largada).
        s.rpm += throttle ? 9000 * dt : -5000 * dt;
        if (s.rpm >= c.limiterRpm) { s.rpm = c.limiterRpm - 350; s.limiter = true; }
        if (s.rpm < c.idleRpm) s.rpm = c.idleRpm;
        s.spin = 0;
    } else {
        const ratio = c.gears[s.gear - 1] * c.finalDrive;
        const coupled = s.v / c.tireRadiusM * RPM_PER_RADS * ratio;
        if (s.shiftT > 0) {
            // Trocando: sem tração, o giro cai para o da nova marcha.
            s.shiftT -= dt;
            s.rpm += (coupled - s.rpm) * SHIFT_RPM_FOLLOW;
            s.spin = 0;
        } else {
            let rpm;
            if (s.clutchT < CLUTCH_S) {
                // Embreagem patinando: segura o giro perto do de largada até as rodas alcançarem o motor.
                s.clutchT += dt;
                const slip = s.launchRpm - CLUTCH_DROP * (s.clutchT / CLUTCH_S);
                if (coupled >= slip) s.clutchT = CLUTCH_S;
                rpm = Math.max(coupled, slip);
            } else {
                rpm = coupled * (1 + 0.25 * s.spin);
            }
            if (rpm < c.idleRpm) rpm = c.idleRpm;
            if (rpm >= c.limiterRpm) { rpm = c.limiterRpm; s.limiter = true; }
            s.rpm = rpm;

            if (throttle && !s.limiter) {
                const wheelF = torqueAt(c, rpm) * ratio * c.efficiency / c.tireRadiusM;
                const maxF = c.grip * c.massKg * G * c.driveWeight;
                if (wheelF > maxF) {
                    s.spin = Math.min(1, (wheelF - maxF) / maxF);
                    force = maxF * (1 - SPIN_LOSS * s.spin);
                } else {
                    s.spin = 0;
                    force = wheelF;
                }
            } else {
                s.spin = 0;
                force = throttle ? 0 : -ratio * 25;
            }
        }
    }

    const drag = 0.5 * RHO * c.cdA * s.v * s.v;
    const roll = s.v > 0 ? c.crr * c.massKg * G : 0;
    const a = (force - drag - roll) / (c.massKg * ROT_MASS);
    s.accel = a;
    s.v += a * dt;
    if (s.v < 0) s.v = 0;
    const prevX = s.x;
    s.x += s.v * dt;
    if (s.v > s.topSpeed) s.topSpeed = s.v;
    if (!s.finished && s.x >= distance) {
        s.finished = true;
        const frac = (distance - prevX) / (s.x - prevX);
        s.finishTime = (k + frac) * dt;
    }
}

/** Piloto automático do oponente: segura o giro de largada, larga após o tempo de reação e troca no giro do plano. */
export function botInput(s, c, plan, k, greenStep) {
    if (s.gear === 0) {
        return { throttle: s.rpm < plan.launchRpm, shift: k >= greenStep + plan.reactionSteps };
    }
    const target = plan.shiftRpm[s.gear - 1] ?? c.limiterRpm;
    return { throttle: true, shift: s.gear < c.gears.length && s.shiftT <= 0 && s.rpm >= target };
}

/** Roda uma corrida inteira do piloto automático (usado para calcular a janela ideal de largada). */
export function simulateBot(c, plan, greenStep, hz, distance, maxSteps) {
    const s = newRunState(c);
    for (let k = 0; k < maxSteps && !s.finished; k++) {
        const inp = botInput(s, c, plan, k, greenStep);
        stepRun(s, c, inp.throttle, inp.shift, k, greenStep, hz, distance);
    }
    return s;
}

/** Faixa de giro de largada que dá o melhor tempo (para pintar a faixa verde no conta-giros). */
export function launchWindow(c, hz, distance) {
    const plan = rpm => ({ launchRpm: rpm, reactionSteps: 0, shiftRpm: c.gears.map(() => c.shiftRpm) });
    const results = [];
    for (let rpm = 1500; rpm <= c.limiterRpm - 400; rpm += 250) {
        const s = simulateBot(c, plan(rpm), hz, hz, distance, hz * 40);
        results.push({ rpm, t: s.finished ? s.finishTime : 99 });
    }
    const best = Math.min(...results.map(r => r.t));
    const good = results.filter(r => r.t <= best + 0.07).map(r => r.rpm);
    return { min: Math.min(...good) - 125, max: Math.max(...good) + 125, bestEt: best - 1 };
}
