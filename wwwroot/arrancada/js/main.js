// Arrancada do Porto — jogo de arrancada (drag race) em Three.js.
// Fluxo: carregamento → nome do piloto → menu → rival → introdução → árvore → corrida → resultado.
// A corrida roda em passo fixo (physics.js) e as entradas são gravadas e enviadas ao servidor,
// que reexecuta tudo e devolve o resultado oficial, o respeito ganho e o ranking.
import * as THREE from 'three';
import { api } from './api.js';
import { deriveCar, newRunState, stepRun, botInput, launchWindow, EV } from './physics.js';
import { createCarModel } from './cars/index.js';
import { DragWorld, LANE_Z } from './world.js';
import { Effects, SmokeSystem, ExhaustFlames } from './fx.js';
import { GameAudio } from './audio/sound.js';
import { RockMusic } from './audio/music.js';
import { DragInput } from './input.js';
import { Hud } from './hud.js';

const $ = s => document.querySelector(s);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmtEt = ms => ms == null ? '—' : (ms / 1000).toFixed(3) + ' s';
const MUSIC_KEY = 'arrancada.musica';

// ---------- Carro na pista (modelo 3D + estado da física + efeitos) ----------

class CarEntity {
    /** O modelo 3D pode vir de um .glb (carregamento assíncrono), por isso a criação passa por aqui. */
    static async create(game, def, lane, parts = []) {
        return new CarEntity(game, def, lane, parts, await createCarModel(def.model, def.visual));
    }

    constructor(game, def, lane, parts, model) {
        this.game = game;
        this.def = def;
        this.lane = lane;
        this.model = model;
        this.phys = deriveCar(def.physics, parts);
        this.root = this.model.root;
        this.root.position.z = lane;
        game.scene.add(this.root);
        this.flames = new ExhaustFlames(this.model.body, this.model.exhausts);
        this.engineLayout = def.engine?.layout ?? 'i6-turbo';
        this.baseY = this.model.body.position.y;   // altura da carroceria (rebaixamento do modelo)
        this.reset();
    }

    reset() {
        this.state = newRunState(this.phys);
        this.wheelAngle = 0;
        this.rearSpin = 0;
        this.pitch = 0; this.pitchVel = 0;
        this.coasting = false;
        this.throttle = false;
        this.brake = 0;
        this.limiterT = 0;
        this.syncPosition();
    }

    get x() { return this.root.position.x; }
    get centerX() { return this.root.position.x + (this.model.frontAxle + this.model.rearAxle) / 2; }

    syncPosition() { this.root.position.x = this.state.x - this.model.frontAxle; }

    /** Depois da chegada: tira o pé e freia (só visual, fora da física oficial). */
    coast(dt) {
        const s = this.state;
        s.v = Math.max(0, s.v - 7.5 * dt);
        s.x += s.v * dt;
        const ratio = this.phys.gears[Math.max(0, s.gear - 1)] * this.phys.finalDrive;
        s.rpm = Math.max(this.phys.idleRpm, s.v / this.phys.tireRadiusM * 9.5493 * ratio);
        s.accel = -7.5;
        s.spin = 0;
    }

    update(dt, time) {
        const s = this.state, m = this.model;
        this.syncPosition();

        // Rodas: rolando + patinando (traseiras).
        this.wheelAngle += s.v / m.wheels[0].radius * dt;
        this.rearSpin += s.spin * 38 * dt;
        for (const [i, w] of m.wheels.entries()) {
            const extra = i >= 2 ? this.rearSpin : 0;
            w.spin.rotation.z = -(this.wheelAngle + extra) * w.side;
        }

        // Suspensão: agacha na aceleração, mergulha na troca/frenagem (mola amortecida).
        const target = THREE.MathUtils.clamp(s.accel * 0.0048, -0.035, 0.055);
        this.pitchVel += ((target - this.pitch) * 140 - this.pitchVel * 15) * dt;
        this.pitch += this.pitchVel * dt;
        m.body.rotation.z = this.pitch;
        const idle = s.v < 3 ? 1 - s.v / 3 : 0;
        m.body.rotation.x = Math.sin(time * s.rpm / 60 * 0.5) * 0.0012 * idle + s.spin * 0.006;
        m.body.position.y = this.baseY + Math.sin(time * 31) * 0.0006 * idle;

        // Luzes de freio.
        const brakeOn = this.coasting && s.v > 0.5;
        this.brake += ((brakeOn ? 1 : 0) - this.brake) * Math.min(1, dt * 10);
        for (const mat of m.brakeLights) mat.emissiveIntensity = 1.3 + this.brake * 5;

        this.flames.update(dt);

        // Fumaça dos pneus traseiros.
        if (s.spin > 0.05 && s.v < 40) {
            const rate = s.spin * 70 * dt;
            for (let n = 0; n < Math.ceil(rate); n++) {
                if (Math.random() > rate) continue;
                for (const side of [-1, 1]) {
                    this.game.smoke.emit(
                        new THREE.Vector3(this.x + m.rearAxle - 0.2, 0.18, this.lane + side * 0.78),
                        new THREE.Vector3(-1.5 - Math.random() * 2, 0.3 + Math.random() * 0.6, side * (0.6 + Math.random())),
                        0.6 + s.spin * 0.6);
                }
            }
        }
    }

    dispose() {
        this.game.scene.remove(this.root);
    }
}

// ---------- Jogo ----------

class Game {
    constructor() {
        this.view = $('#view');
        this.screens = {
            loading: $('#screen-loading'), name: $('#screen-name'), menu: $('#screen-menu'),
            opponents: $('#screen-opponents'), garage: $('#screen-garage'), ranking: $('#screen-ranking'),
            result: $('#screen-result')
        };
        this.fadeEl = $('#fade');
        this.mode = 'loading';
        this.time = 0;
        this.audio = new GameAudio();
        this.music = new RockMusic(this.audio);
        this.musicOn = (() => { try { return localStorage.getItem(MUSIC_KEY) !== '0'; } catch { return true; } })();
        this.hud = new Hud($('#hud'));
        this.input = new DragInput({ onMenu: (code, src) => this._menuKey(code, src) });
        this.input.bindTouch($('#touch-throttle'), $('#touch-shift'));
        this.opponents = new Map();
        this.menuIndex = 0;
    }

    // ---------- Inicialização ----------

    async boot() {
        const text = $('#loading-text');
        await nextFrame();
        try {
            this.catalog = await api.catalog();
        } catch (e) {
            text.textContent = 'Não foi possível carregar o jogo: ' + e.message;
            return;
        }
        this.track = this.catalog.track;

        text.textContent = 'Montando o porto...';
        await nextFrame();
        this._initRenderer();
        this.world = new DragWorld(this.renderer, this.scene, { distance: this.track.distanceM, quality: this.quality });
        this.smoke = new SmokeSystem(this.scene);

        text.textContent = 'Tirando o carro da garagem...';
        await nextFrame();
        if (api.token) {
            try { this.profile = await api.me(); } catch (e) { if (e.status === 401) api.setToken(null); }
        }
        await this._buildPlayerCar();
        // Já baixa o carro do primeiro rival enquanto o jogador está no menu.
        const firstOpp = this.catalog.opponents.find(o => o.available);
        if (firstOpp) this._opponentCar(firstOpp).then(o => { o.root.visible = false; });

        this._bindUi();
        this._resize();
        // Compila os shaders antes de mostrar a cena (evita engasgo no primeiro frame).
        this.renderer.compile(this.scene, this.camera);
        this.clock = new THREE.Clock();
        this.renderer.setAnimationLoop(() => this._frame());

        this.screens.loading.classList.add('hidden');
        if (this.profile) this.showMenu(); else this.showName();
        this.fade(false);
    }

    _initRenderer() {
        const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        const dpr = window.devicePixelRatio || 1;
        this.quality = Math.min(window.innerWidth, window.innerHeight) < 600 ? 0.6 : 1;
        r.setPixelRatio(Math.min(dpr, this.quality < 1 ? 1.25 : 1.5));
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 0.82;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.view.appendChild(r.domElement);
        this.renderer = r;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3200);
        this.camera.position.set(-8, 1.6, -3);
        this.fx = new Effects(r, this.scene, this.camera);
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.fx.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.smoke?.setPixelScale(h * this.renderer.getPixelRatio(), this.camera.fov);
    }

    async _buildPlayerCar() {
        const id = this.profile?.carId ?? this.catalog.starterCar;
        const def = this.catalog.cars.find(c => c.id === id) ?? this.catalog.cars[0];
        if (this.player?.def.id === def.id) return;
        const parts = (this.profile?.installedParts?.[def.id] ?? []).map(p => this.catalog.parts.find(x => x.id === p)).filter(Boolean);
        const car = await CarEntity.create(this, def, LANE_Z.player, parts);
        this.player?.dispose();
        this.player = car;
        this.launch = launchWindow(this.player.phys, this.track.stepsPerSecond, this.track.distanceM);
    }

    _opponentCar(opp) {
        if (!this.opponents.has(opp.id)) {
            const def = this.catalog.cars.find(c => c.id === opp.car);
            this.opponents.set(opp.id, CarEntity.create(this, def, LANE_Z.opponent));
        }
        return this.opponents.get(opp.id);
    }

    // ---------- Telas ----------

    show(name) {
        for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
        document.body.classList.toggle('racing', name === null);
    }

    fade(on) {
        this.fadeEl.classList.toggle('on', on);
        return wait(on ? 700 : 0);
    }

    toast(text, ms = 2600) {
        const t = $('#toast');
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => t.classList.remove('show'), ms);
    }

    showName() {
        this.mode = 'name';
        this._prepareShowroom();
        this.show('name');
        setTimeout(() => $('#name-input').focus(), 50);
    }

    showMenu() {
        this.mode = 'menu';
        this.hud.show(false);
        $('#intro').classList.add('hidden');
        this._prepareShowroom();
        const p = this.profile;
        $('#m-name').textContent = p.name;
        $('#m-respect').textContent = p.respect.toLocaleString('pt-BR');
        $('#m-rank').textContent = '#' + p.rank;
        $('#m-wins').textContent = `${p.wins}/${p.races}`;
        $('#m-best').textContent = p.bestEtMs ? (p.bestEtMs / 1000).toFixed(3) + 's' : '—';
        $('#m-car').textContent = this.player.def.name;
        $('#m-car-desc').textContent = this.player.def.description ?? '';
        this.show('menu');
        this._highlightMenu(this.menuIndex);
        this._setRaceMusic(false);
    }

    _prepareShowroom() {
        for (const o of this.opponents.values()) o.then(car => { if (this.mode !== 'race' && this.mode !== 'intro' && this.mode !== 'result') car.root.visible = false; });
        this.player.reset();
        this.player.root.position.x = -this.player.model.frontAxle - 30;
        this.player.state.x = this.player.root.position.x + this.player.model.frontAxle;
        this.world.tree.set({});
        this.world.board.clear();
        this.camMode = 'showroom';
    }

    _highlightMenu(i) {
        const items = [...document.querySelectorAll('.mitem')];
        this.menuIndex = (i + items.length) % items.length;
        items.forEach((el, k) => el.classList.toggle('sel', k === this.menuIndex));
    }

    async _menuGo(action) {
        this.audio.uiClick();
        switch (action) {
            case 'race': return this.showOpponents();
            case 'garage': return this.showGarage('cars');
            case 'shop': return this.showGarage('parts');
            case 'ranking': return this.showRanking();
            case 'switch': {
                if (!this._confirmSwitch) {
                    this._confirmSwitch = true;
                    setTimeout(() => { this._confirmSwitch = false; }, 3500);
                    return this.toast('Clique de novo para confirmar. Este piloto deixa de ficar salvo neste navegador.', 3500);
                }
                this._confirmSwitch = false;
                api.setToken(null);
                this.profile = null;
                return this.showName();
            }
            case 'room':
                this.music.stop();
                await this.fade(true);
                location.href = '/';
                return;
        }
    }

    showOpponents() {
        this.mode = 'sub';
        const list = $('#opp-list');
        list.replaceChildren();
        for (const o of this.catalog.opponents) {
            const car = this.catalog.cars.find(c => c.id === o.car);
            const card = document.createElement('button');
            card.className = 'card' + (o.available ? '' : ' locked');
            const h = document.createElement('h4'); h.textContent = o.available ? o.name : '???';
            const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = o.available ? car?.name ?? '' : 'Rival desconhecido';
            const p = document.createElement('p'); p.textContent = o.available ? `${o.bio} Vitória: +${o.respectWin} de respeito.` : o.bio;
            card.append(h, sub, p);
            if (!o.available) {
                const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'EM BREVE';
                card.append(tag);
                card.disabled = true;
            } else {
                card.addEventListener('click', () => this.startRace(o));
            }
            list.append(card);
        }
        this.show('opponents');
        list.querySelector('.card:not(.locked)')?.focus();
    }

    showGarage(kind) {
        this.mode = 'sub';
        const list = $('#garage-list');
        list.replaceChildren();
        const owned = new Set(this.profile.ownedCars);
        const names = { engine: 'Motor', turbo: 'Turbo', transmission: 'Câmbio', tires: 'Pneus', weight: 'Peso', aero: 'Aerodinâmica' };
        const fx = e => [
            e.torqueMult && `+${Math.round((e.torqueMult - 1) * 100)}% torque`,
            e.massKg && `${e.massKg} kg`,
            e.gripMult && `+${Math.round((e.gripMult - 1) * 100)}% aderência`,
            e.shiftTimeMult && `${Math.round((1 - e.shiftTimeMult) * 100)}% troca mais rápida`,
            e.cdAMult && `${Math.round((1 - e.cdAMult) * 100)}% menos arrasto`
        ].filter(Boolean).join(' · ');
        if (kind === 'cars') {
            $('#garage-title').textContent = 'GARAGEM';
            $('#garage-sub').textContent = 'Compra de carros com respeito: em breve.';
            for (const c of this.catalog.cars) {
                const mine = owned.has(c.id);
                list.append(this._card(c.name, mine ? 'SEU CARRO' : `${c.price.toLocaleString('pt-BR')} de respeito`, c.description, mine ? '' : 'EM BREVE', !mine));
            }
        } else {
            $('#garage-title').textContent = 'OFICINA';
            $('#garage-sub').textContent = 'Peças de desempenho: em breve. Ganhe respeito nas corridas para comprar.';
            for (const p of this.catalog.parts) {
                list.append(this._card(p.name, `${names[p.category] ?? p.category} · ${p.price.toLocaleString('pt-BR')} de respeito`, fx(p.effects ?? {}), 'EM BREVE', true));
            }
        }
        this.show('garage');
    }

    _card(title, sub, text, tag, locked) {
        const card = document.createElement('div');
        card.className = 'card' + (locked ? ' locked' : '');
        const h = document.createElement('h4'); h.textContent = title;
        const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub;
        const p = document.createElement('p'); p.textContent = text ?? '';
        card.append(h, s, p);
        if (tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; card.append(t); }
        return card;
    }

    async showRanking() {
        this.mode = 'sub';
        this.show('ranking');
        const body = $('#ranking-body');
        body.replaceChildren();
        try {
            const board = await api.leaderboard(20);
            this._fillRanking(body, board.top);
            $('#ranking-foot').textContent = `${board.totalPlayers} piloto(s) no mundo` + (board.playerRank ? ` · você está em #${board.playerRank}` : '');
        } catch (e) {
            $('#ranking-foot').textContent = e.message;
        }
    }

    _fillRanking(body, rows) {
        body.replaceChildren();
        for (const r of rows) {
            const tr = document.createElement('tr');
            if (r.isYou) tr.className = 'you';
            for (const v of [r.rank, r.name, r.totalRespect.toLocaleString('pt-BR'), r.wins, r.bestEtMs ? (r.bestEtMs / 1000).toFixed(3) : '—']) {
                const td = document.createElement('td');
                td.textContent = String(v);
                tr.append(td);
            }
            body.append(tr);
        }
    }

    // ---------- Entrada / interface ----------

    _bindUi() {
        $('#name-form').addEventListener('submit', async e => {
            e.preventDefault();
            this._unlockAudio();
            const btn = e.target.querySelector('button');
            btn.disabled = true;
            $('#name-error').textContent = '';
            try {
                this.profile = await api.createPlayer($('#name-input').value);
                await this._buildPlayerCar();
                this.showMenu();
            } catch (err) {
                $('#name-error').textContent = err.message;
            } finally {
                btn.disabled = false;
            }
        });
        document.querySelectorAll('.mitem').forEach((el, i) => {
            el.addEventListener('click', () => { this._unlockAudio(); this._highlightMenu(i); this._menuGo(el.dataset.go); });
            el.addEventListener('mouseenter', () => this._highlightMenu(i));
        });
        document.querySelectorAll('[data-back]').forEach(el => el.addEventListener('click', () => { this.audio.uiClick(); this.showMenu(); }));
        $('#r-again').addEventListener('click', () => this.startRace(this.lastOpponent));
        $('#r-menu').addEventListener('click', () => this.showMenu());
        $('#btn-music').addEventListener('click', () => this.toggleMusic());
        $('#btn-music').classList.toggle('off', !this.musicOn);
        window.addEventListener('pointerdown', () => this._unlockAudio(), { once: false });
        $('#hud-help').innerHTML =
            'Segure <kbd>↑</kbd>/<kbd>W</kbd> para acelerar e deixar o giro na <b style="color:#22d35b">faixa verde</b>.<br>' +
            'Na luz <b style="color:#22d35b">verde</b>, aperte <kbd>ESPAÇO</kbd> para engatar e largar.<br>' +
            'Troque a marcha com <kbd>ESPAÇO</kbd> quando as luzes piscarem <b style="color:#3fd0ff">azul</b>.';
    }

    _unlockAudio() {
        this.audio.unlock().then(ok => {
            if (!ok) return;
            if (this.musicOn && !this.music.playing) this.music.start();
            if (!this.playerEngine) this._ensureEngines();
        });
    }

    _ensureEngines() {
        if (!this.audio.ctx || this.playerEngine) return;
        this.playerEngine = this.audio.createEngine(this.player.engineLayout, { gain: 0.9, pan: -0.1 });
        this.squeal = this.audio.createLoop({ type: 'bandpass', freq: 1900, q: 6 });
        this.wind = this.audio.createLoop({ type: 'lowpass', freq: 450, q: 0.5 });
    }

    toggleMusic() {
        this._unlockAudio();
        this.musicOn = !this.musicOn;
        try { localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0'); } catch { }
        $('#btn-music').classList.toggle('off', !this.musicOn);
        if (this.musicOn) this.music.start(); else this.music.stop();
    }

    _setRaceMusic(racing) {
        this.audio.setMusicVolume(racing ? 0.22 : 0.55);
    }

    _menuKey(code) {
        this._unlockAudio();
        if (code === 'KeyM' && this.mode !== 'name') return this.toggleMusic();
        if (this.mode === 'menu') {
            if (code === 'ArrowUp') this._highlightMenu(this.menuIndex - 1);
            if (code === 'ArrowDown') this._highlightMenu(this.menuIndex + 1);
            if (code === 'Enter' || code === 'PadConfirm') document.querySelectorAll('.mitem')[this.menuIndex]?.click();
        } else if (this.mode === 'sub') {
            if (code === 'Escape' || code === 'Backspace') this.showMenu();
            if (code === 'PadConfirm' || code === 'Enter') {
                const focused = document.activeElement;
                if (focused?.classList.contains('card')) focused.click();
            }
        } else if (this.mode === 'intro') {
            if (code === 'Enter' || code === 'PadConfirm' || code === 'Escape') this._endIntro();
        } else if (this.mode === 'race' && code === 'Escape') {
            this.abortRace();
        } else if (this.mode === 'result') {
            if (code === 'Enter' || code === 'PadConfirm') $('#r-again').click();
            if (code === 'Escape') this.showMenu();
        }
    }

    // ---------- Corrida ----------

    async startRace(opp) {
        if (this._starting) return;
        this._starting = true;
        document.activeElement?.blur?.();   // nenhum botão com foco durante a corrida
        this._unlockAudio();
        this.lastOpponent = opp;
        try {
            const race = await api.startRace(opp.id);
            await this.fade(true);
            this.race = race;
            this.opponent = await this._opponentCar(opp);
            this.opponent.root.visible = true;
            this.player.reset();
            this.opponent.reset();
            this.world.tree.set({});
            this.world.board.clear();
            this.k = 0;
            this.acc = 0;
            this.events = [];
            this.lastThrottle = false;
            this.finishSent = false;
            this.playerDnf = false;
            this.result = null;
            this.endTimer = 0;
            this.input.clear();
            this.smoke.items.length = 0;
            this._ensureEngines();
            if (!this.oppEngine || this.oppEngineLayout !== this.opponent.engineLayout) {
                this.oppEngine?.dispose();
                this.oppEngine = this.audio.createEngine(this.opponent.engineLayout, { gain: 0.8, pan: 0.45 });
                this.oppEngineLayout = this.opponent.engineLayout;
            }
            this.hud.setup({ car: this.player.phys, launch: this.launch, opponentName: opp.name.toUpperCase() });
            this.show(null);
            this._beginIntro(opp);
            this.fade(false);
        } catch (e) {
            this.toast(e.message);
        } finally {
            this._starting = false;
        }
    }

    _beginIntro(opp) {
        this.mode = 'intro';
        this.introT = 0;
        this.camMode = 'intro';
        $('#intro-name').textContent = opp.name.toUpperCase();
        $('#intro-car').textContent = this.opponent.def.name;
        $('#intro-bio').textContent = opp.bio ?? '';
        $('#intro').classList.remove('hidden');
        this._setRaceMusic(true);
    }

    _endIntro() {
        if (this.mode !== 'intro') return;
        $('#intro').classList.add('hidden');
        this.mode = 'race';
        this.camMode = 'chase';
        this.camBack = 6.4;
        this.hud.show(true);
        $('#hud-help').classList.remove('hidden');
        this.hud.message('PREPARE-SE', 'warn', 1.4);
        this.input.clear();
    }

    abortRace() {
        this.mode = 'menu';
        this.race = null;
        this.toast('Corrida abandonada.');
        this.showMenu();
    }

    _stepRace() {
        const race = this.race, hz = race.stepsPerSecond, D = race.distanceM;
        const k = this.k, green = race.greenStep;
        const ps = this.player.state, os = this.opponent.state;

        if (!ps.finished && !this.playerDnf) {
            const thr = this.input.throttle;
            if (thr !== this.lastThrottle) {
                this.events.push([k, thr ? EV.THROTTLE_ON : EV.THROTTLE_OFF]);
                this.lastThrottle = thr;
            }
            const shift = this.input.consumeShift();
            if (shift) this.events.push([k, EV.SHIFT]);
            stepRun(ps, this.player.phys, thr, shift, k, green, hz, D);
            this.player.throttle = thr;
            if (ps.lastShift) this._onShift(this.player, ps.lastShift, k);
            if (ps.finished) this._onPlayerFinish();
        } else {
            this.player.coast(1 / hz);
        }

        if (!os.finished) {
            const inp = botInput(os, this.opponent.phys, race.opponentPlan, k, green);
            stepRun(os, this.opponent.phys, inp.throttle, inp.shift, k, green, hz, D);
            this.opponent.throttle = inp.throttle;
            if (os.lastShift) this._onShift(this.opponent, os.lastShift, k);
            if (os.finished) this._onOpponentFinish();
        } else {
            this.opponent.coast(1 / hz);
        }

        // Árvore de largada.
        const t = (k - green) / hz;
        const tree = { stage: k < green + hz * 2, amber: t >= -1.5 ? (t >= -1 ? (t >= -0.5 ? 3 : 2) : 1) : 0, green: t >= 0, red: ps.jump };
        if (t >= 0) tree.amber = 0;
        this.world.tree.set(tree);
        this.hud.setTree(tree);
        for (const at of [-1.5, -1, -0.5]) if (k === green + Math.round(at * hz)) this.audio.tone(720, 0.14, { gain: 0.1 });
        if (k === green) {
            this.audio.tone(1250, 0.4, { gain: 0.12 });
            if (!ps.launched) this.hud.message('VAI!', 'great', 0.8);
        }

        // Sem largar por muito tempo: encerra.
        if (!ps.launched && k > green + hz * 15 && !this.playerDnf) {
            this.playerDnf = true;
            this._sendResult();
        }
        this.k++;
    }

    _onShift(car, kind, k) {
        const isPlayer = car === this.player;
        const race = this.race;
        if (kind === 'launch') {
            if (!isPlayer) return;
            $('#hud-help').classList.add('hidden');
            const reaction = (k - race.greenStep) / race.stepsPerSecond;
            if (car.state.jump) this.hud.message('QUEIMOU A LARGADA!', 'bad', 2.2);
            else if (reaction < 0.2) this.hud.message('LARGADA PERFEITA!', 'great');
            else if (reaction < 0.35) this.hud.message('BOA LARGADA', 'good');
            else this.hud.message('LARGADA LENTA', 'warn');
            if (!car.state.jump) {
                const r = car.state.launchRpm;
                if (r < this.launch.min - 300) setTimeout(() => this.hud.message('GIRO BAIXO NA LARGADA', 'warn'), 900);
                else if (r > this.launch.max + 300) setTimeout(() => this.hud.message('PATINOU DEMAIS', 'warn'), 900);
            }
            this.audio.shiftClunk();
            return;
        }
        const engine = isPlayer ? this.playerEngine : this.oppEngine;
        car.flames.pop(kind === 'late' ? 1.3 : 1);
        if (isPlayer) {
            this.audio.shiftClunk();
            const boost = engine?.dumpBoost?.() ?? 0;
            if (boost > 0.25) this.audio.blowOff(0.12 + boost * 0.15);
            this.audio.backfire(2 + Math.floor(Math.random() * 2), 0.22);
            const msgs = {
                perfect: ['TROCA PERFEITA!', 'good'], good: ['BOA TROCA', 'great'],
                early: ['CEDO DEMAIS', 'warn'], late: ['PASSOU DO PONTO', 'bad']
            };
            const [text, cls] = msgs[kind];
            this.hud.message(text, cls, 0.9);
            if (kind === 'perfect') this.fx.u.flash.value = 0.12;
        } else {
            this.audio.backfire(2, 0.12 * this._oppVolume(), 0.5);
        }
    }

    _onPlayerFinish() {
        const ps = this.player.state, race = this.race;
        const et = ps.finishTime - ps.launchStep / race.stepsPerSecond;
        this.world.board.show('player', et, ps.topSpeed * 3.6);
        this.player.coasting = true;
        const ahead = !this.opponent.state.finished && !ps.jump;
        this.hud.message(ahead ? 'CHEGOU NA FRENTE!' : 'CHEGADA', ahead ? 'great' : 'warn', 2);
        this._sendResult();
    }

    _onOpponentFinish() {
        const os = this.opponent.state, race = this.race;
        const et = os.finishTime - os.launchStep / race.stepsPerSecond;
        this.world.board.show('opponent', et, os.topSpeed * 3.6);
        this.opponent.coasting = true;
    }

    async _sendResult() {
        if (this.finishSent) return;
        this.finishSent = true;
        const race = this.race;
        try {
            this.result = await api.finishRace(race.raceId, this.events);
            this.profile = this.result.profile;
        } catch (e) {
            this.result = { error: e.message };
        }
    }

    _updateRace(dt) {
        const hz = this.race.stepsPerSecond;
        this.acc += dt;
        let n = 0;
        while (this.acc >= 1 / hz && n < 80) {
            this._stepRace();
            this.acc -= 1 / hz;
            n++;
        }
        if (n === 80) this.acc = 0;

        const ps = this.player.state, os = this.opponent.state;
        const done = (ps.finished || this.playerDnf) && (os.finished || this.k > this.race.maxSteps);
        if (done) {
            this.endTimer += dt;
            if (this.endTimer > 2.4 && this.result) this._showResult();
        }

        const greenT = (this.k - this.race.greenStep) / hz;
        this.hud.update(dt, {
            rpm: ps.limiter ? ps.rpm - Math.random() * 350 : ps.rpm, gear: ps.gear, kmh: ps.v * 3.6,
            prelaunch: !ps.launched, me: ps.x, opp: os.x, distance: this.race.distanceM,
            time: ps.finished ? ps.finishTime - this.race.greenStep / hz : greenT < 0 ? null : greenT
        });
    }

    _showResult() {
        if (this.mode !== 'race') return;
        this.mode = 'result';
        this.camMode = 'result';
        this.hud.show(false);
        const r = this.result;
        if (r.error) {
            this.toast(r.error, 4000);
            this.showMenu();
            return;
        }
        const title = $('#r-title');
        title.textContent = r.won ? 'VITÓRIA' : r.player.jumpStart ? 'QUEIMOU' : 'DERROTA';
        title.className = r.won ? 'win' : 'lose';
        const oppName = this.lastOpponent.name;
        $('#r-sub').textContent = r.won
            ? `Você deixou ${oppName} para trás.`
            : r.player.jumpStart ? 'Largou antes da luz verde: corrida perdida.' : `${oppName} levou essa. Revanche?`;
        $('#r-opp').textContent = oppName.toUpperCase();
        const rows = [
            ['Tempo total', r.player.totalMs, r.opponent.totalMs, true],
            ['ET (tempo de pista)', r.player.etMs, r.opponent.etMs, true],
            ['Reação', r.player.reactionMs, r.opponent.reactionMs, true],
            ['Velocidade final', r.player.topSpeedKmh, r.opponent.topSpeedKmh, false],
            ['Trocas perfeitas', r.player.perfectShifts, r.opponent.perfectShifts, false]
        ];
        const tbody = $('#r-times');
        tbody.replaceChildren();
        for (const [label, a, b, time] of rows) {
            const tr = document.createElement('tr');
            const fmt = v => v == null ? '—' : time ? (v / 1000).toFixed(3) + ' s' : label.startsWith('Vel') ? v.toFixed(1) + ' km/h' : String(v);
            const better = a != null && b != null && (time ? a < b : a > b);
            for (const [v, cls] of [[label, ''], [fmt(a), better ? 'win' : ''], [fmt(b), !better && a !== b && b != null ? 'win' : '']]) {
                const td = document.createElement('td');
                td.textContent = v;
                if (cls) td.className = cls;
                tr.append(td);
            }
            tbody.append(tr);
        }
        const lines = $('#r-lines');
        lines.replaceChildren();
        for (const l of r.respectLines) {
            const li = document.createElement('li');
            const s = document.createElement('span'); s.textContent = l.label;
            const b = document.createElement('b'); b.textContent = '+' + l.amount;
            li.append(s, b);
            lines.append(li);
        }
        $('#r-gain').textContent = r.respectGained;
        $('#r-total').textContent = `Total: ${r.profile.respect.toLocaleString('pt-BR')} de respeito · #${r.profile.rank} no mundo` +
            (r.newBestEt ? ' · NOVO RECORDE PESSOAL!' : '');
        this._fillRanking($('#r-ranking'), r.leaderboard.top);
        this.show('result');
        this._setRaceMusic(false);
        if (r.won) this.audio.tone(660, 0.15, { type: 'triangle', gain: 0.1 }), this.audio.tone(990, 0.3, { type: 'triangle', gain: 0.1, at: 0.15 });
    }

    // ---------- Câmera ----------

    _updateCamera(dt) {
        const cam = this.camera, p = this.player;
        const s = p.state;
        let fov = 50;
        let speedFx = 0;
        if (this.camMode === 'showroom') {
            this.orbit = (this.orbit ?? 0.6) + dt * 0.12;
            const c = new THREE.Vector3(p.centerX, 0.55, p.lane);
            cam.position.set(c.x + Math.cos(this.orbit) * 6.4, 1.15 + Math.sin(this.orbit * 0.7) * 0.25, c.z + Math.sin(this.orbit) * 6.4);
            cam.lookAt(c.x + Math.sin(this.orbit) * 1.2, 0.6, c.z);
            fov = 38;
        } else if (this.camMode === 'intro') {
            this.introT += dt;
            const o = this.opponent;
            const oc = new THREE.Vector3(o.centerX, 0.6, o.lane);
            const pc = new THREE.Vector3(p.centerX, 0.6, p.lane);
            const t = this.introT;
            const lerpShot = (a, b, k, la, lb) => {
                const e = k * k * (3 - 2 * k);
                cam.position.lerpVectors(a, b, e);
                cam.lookAt(new THREE.Vector3().lerpVectors(la, lb, e));
            };
            const V = (x, y, z) => new THREE.Vector3(x, y, z);
            if (t < 2.8) {
                lerpShot(V(oc.x + 6.2, 0.45, oc.z + 3.6), V(oc.x + 4.3, 0.7, oc.z + 2.2), t / 2.8, oc.clone().add(V(0.8, 0, 0)), oc);
                fov = 34;
            } else if (t < 5) {
                lerpShot(V(oc.x - 2.5, 0.8, oc.z + 4.6), V(oc.x - 5.4, 1.2, oc.z + 2.6), (t - 2.8) / 2.2, oc.clone().add(V(-1.5, 0, 0)), oc.clone().add(V(-2.2, 0, 0)));
                fov = 36;
            } else if (t < 6.6) {
                const chase = V(pc.x - 6.4, 1.6, pc.z - 0.2);
                lerpShot(V(pc.x + 2.5, 2.6, pc.z - 4.5), chase, (t - 5) / 1.6, pc, V(pc.x + 8, 0.9, pc.z + 0.6));
                fov = 44;
            } else {
                this._endIntro();
            }
            // O rival acelera em ponto morto para provocar.
            const blip = Math.max(0, Math.sin(t * 2.4)) ** 4;
            o.state.rpm = o.phys.idleRpm + blip * 4200;
            o.throttle = blip > 0.2;
            if (blip > 0.9 && !this._blipped) { this._blipped = true; o.flames.pop(0.7); }
            if (blip < 0.1) this._blipped = false;
        } else if (this.camMode === 'chase') {
            const v = s.v;
            const back = 6.3 + v * 0.018 + Math.max(0, s.accel) * 0.06;
            this.camBack += (back - this.camBack) * Math.min(1, dt * 3);
            const shake = 0.006 + v * 0.0005 + s.spin * 0.025 + (s.limiter ? 0.012 : 0) + (s.launched && s.v < 8 ? 0.01 : 0);
            const t = this.time;
            const sx = (Math.sin(t * 37) + Math.sin(t * 23.3)) * shake;
            const sy = (Math.sin(t * 41.7) + Math.sin(t * 17.1)) * shake;
            cam.position.set(p.x + p.model.rearAxle - this.camBack + 1.3, 1.55 - v * 0.002 + sy, p.lane - 0.25 + sx);
            cam.lookAt(p.x + 9, 0.85 + sy * 0.5, p.lane + 0.55);
            fov = 50 + Math.min(15, v * 0.28);
            speedFx = THREE.MathUtils.clamp((v - 12) / 55, 0, 1);
        } else if (this.camMode === 'result') {
            this.orbit = (this.orbit ?? 0) + dt * 0.1;
            const c = new THREE.Vector3(p.centerX, 0.6, p.lane);
            cam.position.set(c.x + Math.cos(this.orbit) * 7, 1.4, c.z + Math.sin(this.orbit) * 7);
            cam.lookAt(c);
            fov = 40;
        }
        if (Math.abs(cam.fov - fov) > 0.01) {
            cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
            cam.updateProjectionMatrix();
        }
        this.fx.u.speed.value += (speedFx - this.fx.u.speed.value) * Math.min(1, dt * 5);
    }

    // ---------- Áudio contínuo ----------

    _updateAudio(dt) {
        if (!this.playerEngine) return;
        const ps = this.player.state;
        const inRace = this.mode === 'race' || this.mode === 'intro' || this.mode === 'result';
        const vol = this.mode === 'race' ? 1 : this.mode === 'result' ? 0.5 : 0.35;
        const rpm = ps.limiter ? ps.rpm - Math.random() * 400 : ps.rpm;
        this.playerEngine.update(rpm, this.player.throttle ? 1 : 0.05, vol, dt, this.player.phys.limiterRpm);
        if (ps.limiter && Math.random() < dt * 8) { this.player.flames.pop(0.5); this.audio.backfire(1, 0.12); }
        this.squeal?.set(Math.min(0.32, ps.spin * 0.45) * (this.mode === 'race' ? 1 : 0), 1700 + ps.spin * 900);
        this.wind?.set(Math.min(0.3, (ps.v / 70) ** 2 * 0.3), 300 + ps.v * 8);

        if (this.oppEngine) {
            const os = this.opponent?.state;
            if (os && inRace && this.opponent.root.visible) {
                this.oppEngine.update(os.rpm, this.opponent.throttle ? 1 : 0.05, this._oppVolume(), dt, this.opponent.phys.limiterRpm);
                this.oppEngine.setPan(THREE.MathUtils.clamp(0.45 - (this.opponent.x - this.player.x) * 0.01, -0.2, 0.7));
            } else {
                this.oppEngine.update(800, 0, 0, dt);
            }
        }
    }

    _oppVolume() {
        if (!this.opponent) return 0;
        const d = this.opponent.x - this.player.x;
        return 0.15 + 0.85 / (1 + (d / 14) ** 2);
    }

    // ---------- Laço principal ----------

    _frame() {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        this.time += dt;
        this.input.poll();

        if (this.mode === 'race' && this.race) this._updateRace(dt);
        else if (this.mode === 'result') { this.player.coast(dt); this.opponent?.coast(dt); }

        this.player.update(dt, this.time);
        if (this.opponent?.root.visible) this.opponent.update(dt, this.time);
        this.smoke.update(dt);
        this._updateCamera(dt);
        this._updateAudio(dt);
        this.world.followShadow(this.player.x);
        this.fx.render(dt);
    }
}

const game = new Game();
// ?debug: expõe o jogo no console e permite avançar o tempo manualmente (útil para testes automáticos).
if (new URLSearchParams(location.search).has('debug')) {
    window.__game = game;
    game.advance = (seconds, step = 1 / 60) => {
        for (let t = 0; t < seconds; t += step) {
            game.clock.getDelta();
            game.clock.oldTime -= step * 1000;
            game._frame();
        }
    };
}
game.boot().catch(e => {
    console.error(e);
    const t = document.querySelector('#loading-text');
    if (t) t.textContent = 'Erro ao iniciar: ' + e.message;
});
