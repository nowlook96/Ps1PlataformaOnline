import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createLgTv, createPlayStation } from './tv-models.js';
import { ScreenPainter } from './boot-screens.js';
import { createCrtMaterial } from './crt-shader.js';
import { InputManager } from './input.js';
import { padName } from './pad-map.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const State = {
    OFF: 'OFF', TV_ON: 'TV_ON', SONY: 'SONY', PS_LOGO: 'PS_LOGO',
    MENU: 'MENU', LOADING: 'LOADING', PLAYING: 'PLAYING'
};
const DURATION = { TV_ON: 1.6, SONY: 4.0, PS_LOGO: 3.2, LOADING: 1.3 };
const ROOM_CAMERA = { pos: new THREE.Vector3(0.45, 1.05, 1.75), target: new THREE.Vector3(0, 0.78, 0) };

let app = null;

export function init(stageEl, options) {
    dispose();
    app = new TvApp(stageEl, options);
}

export function dispose() {
    app?.dispose();
    app = null;
}

class TvApp {
    constructor(stage, { games, biosUrl, dataPath }) {
        this.stage = stage;
        this.games = games ?? [];
        this.biosUrl = biosUrl;
        this.dataPath = dataPath;
        this.host = stage.querySelector('#scene-host');
        this.emuFrame = stage.querySelector('#emu-frame');
        this.iframe = stage.querySelector('#emu');
        this.hint = stage.querySelector('#hint');
        this.padStatus = stage.querySelector('#pad-status');

        this.state = State.OFF;
        this.stateTime = 0;
        this.power = 0;           // animação da tela (0..1)
        this.selected = 0;
        this.currentGame = null;
        this.audio = null;
        this.cameraTween = null;

        this._buildRenderer();
        this._buildScene();
        this._bindUi();

        this.input = new InputManager({
            onAction: (a, src) => this._onAction(a, src),
            onPadsChanged: pads => this._updatePadStatus(pads)
        });
        this._updatePadStatus(this.input.connectedPads());

        this.clock = new THREE.Clock();
        this._loop = this._loop.bind(this);
        this.raf = requestAnimationFrame(this._loop);
    }

    // ---------- Construção ----------

    _buildRenderer() {
        const r = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 0.9;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.host.appendChild(r.domElement);
        this.renderer = r;

        this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
        this.camera.position.copy(ROOM_CAMERA.pos);

        this.controls = new OrbitControls(this.camera, r.domElement);
        this.controls.target.copy(ROOM_CAMERA.target);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.minDistance = 0.9;
        this.controls.maxDistance = 2.6;
        this.controls.minPolarAngle = Math.PI * 0.3;
        this.controls.maxPolarAngle = Math.PI * 0.55;
        this.controls.minAzimuthAngle = -Math.PI * 0.35;
        this.controls.maxAzimuthAngle = Math.PI * 0.35;

        this._onResize = () => this._resize();
        window.addEventListener('resize', this._onResize);
        this._resize();
    }

    _buildScene() {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x120d0a);
        scene.fog = new THREE.Fog(0x120d0a, 3, 7);
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.25;
        this.scene = scene;

        // Luzes: abajur de chão quente (luz principal), luar frio entrando pela janela,
        // ambiente baixa e o brilho da tela (área + pontual), que acompanha a cor da imagem.
        scene.add(new THREE.HemisphereLight(0x7d6f62, 0x140f0b, 0.18));

        const lampPos = new THREE.Vector3(-1.2, 0, -0.38);
        this.lampLight = new THREE.PointLight(0xffb46b, 2.4, 0, 2);
        this.lampLight.position.set(lampPos.x, 1.2, lampPos.z);
        this.lampLight.castShadow = true;
        this.lampLight.shadow.mapSize.set(2024, 2024);
        this.lampLight.shadow.camera.near = 0.05;
        this.lampLight.shadow.bias = -0.0015;
        this.lampLight.shadow.normalBias = 0.02;
        scene.add(this.lampLight);

        const moon = new THREE.DirectionalLight(0x8fa6ff, 0.55);
        moon.position.set(2.6, 2.8, 2.2);
        moon.target.position.set(0, 0.5, 0);
        moon.castShadow = true;
        moon.shadow.mapSize.set(2048, 2048);
        Object.assign(moon.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 9 });
        moon.shadow.bias = -0.0004;
        moon.shadow.normalBias = 0.02;
        scene.add(moon, moon.target);

        RectAreaLightUniformsLib.init();
        this.screenColor = new THREE.Color(0x9fb4ff);
        this.screenArea = new THREE.RectAreaLight(this.screenColor, 0, 0.6, 0.45);
        scene.add(this.screenArea);

        this.screenLight = new THREE.PointLight(0x9fb4ff, 0, 3, 1.8);
        this.screenLight.castShadow = true;
        this.screenLight.shadow.mapSize.set(1024, 1024);
        this.screenLight.shadow.camera.near = 0.05;
        this.screenLight.shadow.bias = -0.002;
        this.screenLight.shadow.normalBias = 0.02;
        scene.add(this.screenLight);

        // Amostra pequena da imagem da tela para colorir a luz que ela projeta na sala.
        this.sampleCanvas = Object.assign(document.createElement('canvas'), { width: 8, height: 6 });
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
        this.sampleFrame = 0;

        this._buildRoom();
        this._buildFloorLamp(lampPos);

        // TV sobre o rack.
        const rackTop = 0.6;
        this.tv = createLgTv();
        this.tv.group.position.set(0, rackTop + this.tv.bottomOffset, 0.02);
        scene.add(this.tv.group);

        // Tela com o shader CRT alimentado pelo canvas.
        this.painter = new ScreenPainter(this.games);
        this.screenTexture = new THREE.CanvasTexture(this.painter.canvas);
        this.screenTexture.colorSpace = THREE.SRGBColorSpace;
        this.crt = createCrtMaterial(this.screenTexture);
        this.tv.screen.material = this.crt;

        // PS1 na prateleira do rack.
        this.ps = createPlayStation();
        this.ps.group.position.set(-0.18, 0.3 + this.ps.height / 2 + 0.012, 0.08);
        this.ps.group.rotation.y = 0.08;
        scene.add(this.ps.group);

        // Cabo AV do PS1 até a traseira da TV.
        const cable = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.18, 0.33, -0.02),
            new THREE.Vector3(-0.2, 0.32, -0.2),
            new THREE.Vector3(-0.3, 0.45, -0.24),
            new THREE.Vector3(-0.22, 0.75, -0.35),
            new THREE.Vector3(-0.15, 0.85, -0.33)
        ]);
        const cableMesh = new THREE.Mesh(new THREE.TubeGeometry(cable, 40, 0.004, 8),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
        scene.add(cableMesh);

        // Sombras: tudo que é sólido projeta e recebe; tela, vidro e peças transparentes ficam de fora.
        for (const obj of [this.tv.group, this.ps.group, cableMesh]) {
            obj.traverse(o => {
                if (!o.isMesh || o === this.tv.screen || o.material.transparent) return;
                o.castShadow = true;
                o.receiveShadow = true;
            });
        }

        const screenWorld = new THREE.Vector3();
        this.tv.screen.getWorldPosition(screenWorld);
        this.screenLight.position.copy(screenWorld).add(new THREE.Vector3(0, 0, 0.4));
        this.screenArea.position.copy(screenWorld).add(new THREE.Vector3(0, 0, 0.03));
        this.screenArea.lookAt(screenWorld.clone().add(new THREE.Vector3(0, 0, 1)));
    }

    _buildFloorLamp(pos) {
        const metal = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.7, roughness: 0.35 });
        const lamp = new THREE.Group();
        lamp.position.copy(pos);

        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.025, 40), metal);
        base.position.y = 0.0125;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.08, 16), metal);
        pole.position.y = 0.025 + 0.54;
        for (const m of [base, pole]) { m.castShadow = true; m.receiveShadow = true; lamp.add(m); }

        // Cúpula de tecido translúcida, iluminada por dentro (não projeta sombra para não bloquear a própria luz).
        this.lampShadeMat = new THREE.MeshStandardMaterial({
            color: 0xd9bf94, emissive: 0xff9a4a, emissiveIntensity: 0.35, roughness: 0.95, side: THREE.DoubleSide
        });
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.28, 40, 1, true), this.lampShadeMat);
        shade.position.y = 1.2;
        lamp.add(shade);

        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
        bulb.position.y = 1.16;
        lamp.add(bulb);

        this.scene.add(lamp);
    }

    _buildRoom() {
        const scene = this.scene;
        const wood = woodTexture();
        wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
        wood.repeat.set(4, 4);

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
            new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const plaster = plasterTexture();
        plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;
        plaster.repeat.set(5, 2);
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 4),
            new THREE.MeshStandardMaterial({ color: 0x8a7560, map: plaster, roughness: 0.95 }));
        wall.position.set(0, 2, -0.75);
        wall.receiveShadow = true;
        scene.add(wall);

        // Rodapé de madeira.
        const baseboard = new THREE.Mesh(new THREE.BoxGeometry(10, 0.09, 0.015),
            new THREE.MeshStandardMaterial({ color: 0x3a2617, roughness: 0.6 }));
        baseboard.position.set(0, 0.045, -0.742);
        baseboard.castShadow = true; baseboard.receiveShadow = true;
        scene.add(baseboard);

        // Tapete em frente ao rack.
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5),
            new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0.1, 0.003, 0.95);
        rug.receiveShadow = true;
        scene.add(rug);

        // Rack de madeira escura com prateleira.
        const rackMat = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.55, metalness: 0.05 });
        const W = 1.2, H = 0.6, D = 0.5, t = 0.025;
        const board = (w, h, d, x, y, z) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rackMat);
            m.position.set(x, y, z);
            m.castShadow = true; m.receiveShadow = true;
            scene.add(m);
        };
        board(W, t, D, 0, H - t / 2, 0);              // tampo
        board(W, t, D, 0, 0.05, 0);                    // base
        board(t, H - 0.05, D, -W / 2 + t / 2, (H + 0.05) / 2, 0);
        board(t, H - 0.05, D, W / 2 - t / 2, (H + 0.05) / 2, 0);
        board(W - 2 * t, t, D - 0.02, 0, 0.3, 0);      // prateleira
        board(W, H - 0.05, t, 0, (H + 0.05) / 2, -D / 2 + t / 2);
        board(t, H - 0.05, D, 0.2, (H + 0.05) / 2, 0); // divisória
    }

    _bindUi() {
        const q = id => this.stage.querySelector(id);
        this._clicks = [
            [q('#btn-power'), () => this.togglePower()],
            [q('#btn-menu'), () => this._onAction('back', 'ui')],
            [q('#btn-fullscreen'), () => this.toggleFullscreen()]
        ];
        for (const [el, fn] of this._clicks) el.addEventListener('click', fn);

        // Clique na cena: botões de energia e itens do menu na tela.
        this.raycaster = new THREE.Raycaster();
        this._pointerDown = null;
        this._onPointerDown = e => { this._pointerDown = { x: e.clientX, y: e.clientY }; };
        this._onPointerUp = e => {
            if (!this._pointerDown) return;
            const moved = Math.hypot(e.clientX - this._pointerDown.x, e.clientY - this._pointerDown.y);
            this._pointerDown = null;
            if (moved < 6) this._handleSceneClick(e);
        };
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointerup', this._onPointerUp);

        // Mensagens do iframe do emulador.
        this._onMessage = e => {
            if (e.origin !== location.origin || e.data?.source !== 'ps1-player') return;
            if (e.data.type === 'back') this.exitGame();
            if (e.data.type === 'fullscreen') this.toggleFullscreen();
            if (e.data.type === 'ready') this.iframe.focus();
        };
        window.addEventListener('message', this._onMessage);

        this._onFsChange = () => {
            this.stage.classList.toggle('is-fullscreen', !!document.fullscreenElement);
            this._resize();
        };
        document.addEventListener('fullscreenchange', this._onFsChange);
    }

    _handleSceneClick(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObjects([this.tv.powerButton, this.ps.powerBtn, this.tv.screen], false);
        if (!hits.length) return;
        const hit = hits[0];

        if (hit.object === this.tv.powerButton || hit.object === this.ps.powerBtn) {
            this.togglePower();
        } else if (hit.object === this.tv.screen && this.state === State.MENU && hit.uv) {
            const i = this.painter.itemAtUv(hit.uv.x, hit.uv.y);
            if (i < 0) return;
            if (i === this.selected) this.startGame(this.games[i]);
            else this.selected = i;
        } else if (hit.object === this.tv.screen && (this.state === State.SONY || this.state === State.PS_LOGO)) {
            this._setState(State.MENU);
        }
    }

    // ---------- Estados ----------

    _setState(s) {
        this.state = s;
        this.stateTime = 0;
        if (s === State.SONY) this._playBootSound();
        this.hint.classList.toggle('hidden', s !== State.OFF);
    }

    togglePower() {
        this._ensureAudio();
        if (this.state === State.OFF) {
            this.tv.setLed(true);
            this._crtSound(true);
            this._setState(State.TV_ON);
        } else {
            if (this.state === State.PLAYING || this.state === State.LOADING) this._closeEmulator();
            this.tv.setLed(false);
            this.ps.setLed(false);
            this._crtSound(false);
            this._moveCamera(ROOM_CAMERA.pos, ROOM_CAMERA.target);
            this._setState(State.OFF);
        }
    }

    startGame(game) {
        if (!game) return;
        this.currentGame = game;
        this._setState(State.LOADING);

        // Enquadra a tela da TV e depois mostra o emulador por cima dela.
        const center = new THREE.Vector3();
        this.tv.screen.getWorldPosition(center);
        const fov = THREE.MathUtils.degToRad(this.camera.fov);
        const { w, h } = this.tv.screenSize;
        const fit = 0.94;
        const distH = (h / 2) / Math.tan(fov / 2) / fit;
        const distW = (w / 2) / (Math.tan(fov / 2) * this.camera.aspect) / fit;
        const dist = Math.max(distH, distW) + 0.018;
        this._moveCamera(center.clone().add(new THREE.Vector3(0, 0, dist)), center, () => this._openEmulator(game));
    }

    exitGame() {
        if (this.state !== State.PLAYING && this.state !== State.LOADING) return;
        this._closeEmulator();
        this._moveCamera(ROOM_CAMERA.pos, ROOM_CAMERA.target);
        this._setState(State.MENU);
    }

    _openEmulator(game) {
        if (this.state !== State.LOADING) return;
        const params = new URLSearchParams({ game: game.url, title: game.title, data: this.dataPath });
        if (this.biosUrl) params.set('bios', this.biosUrl);
        this.iframe.src = 'player.html?' + params.toString();
        this.emuFrame.classList.remove('hidden');
        this._positionEmulator();
        this._setState(State.PLAYING);
        this.iframe.focus();
    }

    _closeEmulator() {
        if (document.fullscreenElement === this.emuFrame) document.exitFullscreen();
        this.iframe.src = 'about:blank';
        this.emuFrame.classList.add('hidden');
        this.currentGame = null;
    }

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }
        const target = this.state === State.PLAYING ? this.emuFrame : this.stage;
        target.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { });
    }

    _onAction(action, source) {
        if (action === 'fullscreen') return this.toggleFullscreen();
        if (action === 'power') return this.togglePower();

        switch (this.state) {
            case State.OFF:
                if (action === 'confirm' || action === 'start') this.togglePower();
                break;
            case State.TV_ON:
            case State.SONY:
            case State.PS_LOGO:
                if (action === 'confirm' || action === 'start') this._setState(State.MENU);
                break;
            case State.MENU: {
                const n = this.games.length;
                if (!n) break;
                if (action === 'up') this.selected = (this.selected - 1 + n) % n;
                if (action === 'down') this.selected = (this.selected + 1) % n;
                if (action === 'confirm' || action === 'start') this.startGame(this.games[this.selected]);
                if (action !== 'back') this._beep(action === 'confirm' || action === 'start' ? 880 : 520);
                break;
            }
            case State.PLAYING:
            case State.LOADING:
                if (action === 'back' && source !== 'gamepad') this.exitGame();
                break;
        }
    }

    // ---------- Loop ----------

    _loop() {
        this.raf = requestAnimationFrame(this._loop);
        const dt = Math.min(this.clock.getDelta(), 0.1);
        this.stateTime += dt;
        const t = this.stateTime;

        this.input.poll(dt, this.state !== State.PLAYING);

        // Animação de energia da tela.
        const targetPower = this.state === State.OFF ? 0 : 1;
        const speed = targetPower > this.power ? 1.6 : 4;
        this.power += Math.sign(targetPower - this.power) * Math.min(Math.abs(targetPower - this.power), dt * speed);
        this.crt.uniforms.power.value = this.power;
        this.crt.uniforms.time.value += dt;

        let noise = 0, glow = 0;
        switch (this.state) {
            case State.OFF:
                this.painter.clear('#000');
                break;
            case State.TV_ON:
                this.painter.tvOn(t);
                noise = Math.max(0, 0.6 - t * 0.8);
                glow = 0.6;
                if (t > DURATION.TV_ON) { this.ps.setLed(true); this._setState(State.SONY); }
                break;
            case State.SONY:
                this.painter.sony(t);
                glow = t < 3.6 ? 1.2 : 0.3;
                if (t > DURATION.SONY) this._setState(State.PS_LOGO);
                break;
            case State.PS_LOGO:
                this.painter.psLogo(t);
                glow = 0.4;
                if (t > DURATION.PS_LOGO) this._setState(State.MENU);
                break;
            case State.MENU:
                this.painter.menu(this.selected, t);
                glow = 0.7;
                break;
            case State.LOADING:
            case State.PLAYING:
                this.painter.loading(this.currentGame?.title ?? '', t);
                this.ps.lid.rotation.y += dt * (this.state === State.LOADING ? 6 : 0);
                glow = 0.5;
                break;
        }
        this.crt.uniforms.noise.value = noise;
        this.screenTexture.needsUpdate = true;
        this._updateScreenGlow(glow);

        this._updateCamera(dt);
        if (this.state === State.PLAYING) this._positionEmulator();
        this.renderer.render(this.scene, this.camera);
    }

    /** Luz projetada pela tela: cor média da imagem atual + tremulação leve típica de CRT. */
    _updateScreenGlow(glow) {
        if (this.state === State.PLAYING) {
            // A imagem do jogo está no iframe; usa um azulado com variação para simular cenas mudando.
            const t = this.crt.uniforms.time.value;
            this._targetColor ??= new THREE.Color();
            this._targetColor.setHSL(0.6 + 0.05 * Math.sin(t * 0.7), 0.35, 0.6);
            this.screenColor.lerp(this._targetColor, 0.05);
        } else if (++this.sampleFrame % 4 === 0) {
            const ctx = this.sampleCtx;
            ctx.drawImage(this.painter.canvas, 0, 0, 8, 6);
            let d;
            try { d = ctx.getImageData(0, 0, 8, 6).data; } catch { return; }
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
            const n = d.length / 4 * 255;
            this._targetColor ??= new THREE.Color();
            this._targetColor.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
            // Normaliza o tom (o brilho vem do glow) para a luz não sumir em telas escuras.
            const max = Math.max(this._targetColor.r, this._targetColor.g, this._targetColor.b);
            if (max > 0.02) this._targetColor.multiplyScalar(1 / max);
            else this._targetColor.set(0x9fb4ff);
            this.screenColor.lerp(this._targetColor, 0.35);
        }

        const flicker = 1 + 0.04 * Math.sin(this.crt.uniforms.time.value * 60) * Math.random();
        const level = glow * this.power * flicker;
        this.screenLight.color.copy(this.screenColor);
        this.screenArea.color.copy(this.screenColor);
        this.screenLight.intensity = THREE.MathUtils.lerp(this.screenLight.intensity, level * 0.9, 0.15);
        this.screenArea.intensity = THREE.MathUtils.lerp(this.screenArea.intensity, level * 5, 0.15);
    }

    _moveCamera(pos, target, done) {
        this.controls.enabled = false;
        this.cameraTween = {
            fromPos: this.camera.position.clone(), toPos: pos.clone(),
            fromTarget: this.controls.target.clone(), toTarget: target.clone(),
            t: 0, duration: 1.2, done
        };
    }

    _updateCamera(dt) {
        const tw = this.cameraTween;
        if (tw) {
            tw.t = Math.min(1, tw.t + dt / tw.duration);
            const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
            this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
            this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
            this.camera.lookAt(this.controls.target);
            if (tw.t >= 1) {
                this.cameraTween = null;
                const inGame = this.state === State.LOADING || this.state === State.PLAYING;
                this.controls.enabled = !inGame;
                tw.done?.();
            }
            return;
        }
        if (this.controls.enabled) this.controls.update();
    }

    /** Posiciona o iframe exatamente sobre o retângulo projetado da tela da TV. */
    _positionEmulator() {
        if (document.fullscreenElement === this.emuFrame) {
            this.emuFrame.style.cssText = '';
            return;
        }
        const { w, h } = this.tv.screenSize;
        const corners = [[-w / 2, h / 2], [w / 2, -h / 2]].map(([x, y]) =>
            this.tv.screen.localToWorld(new THREE.Vector3(x, y, 0.018)).project(this.camera));
        const rect = this.renderer.domElement.getBoundingClientRect();
        const toPx = v => ({ x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height });
        const a = toPx(corners[0]), b = toPx(corners[1]);
        Object.assign(this.emuFrame.style, {
            left: a.x + 'px', top: a.y + 'px',
            width: (b.x - a.x) + 'px', height: (b.y - a.y) + 'px'
        });
    }

    _resize() {
        const w = this.host.clientWidth || window.innerWidth;
        const h = this.host.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _updatePadStatus(pads) {
        const label = this.padStatus.querySelector('span');
        this.padStatus.classList.toggle('connected', pads.length > 0);
        // O navegador só revela o joystick depois que algum botão é apertado com a página em foco.
        label.textContent = pads.length
            ? pads.length + ' controle(s): ' + padName(pads[0]).slice(0, 28)
            : 'sem controle (aperte um botão)';
        this.padStatus.title = pads.length
            ? pads.map(p => `${p.index + 1}: ${p.id} [${p.mapping || 'genérico'}]`).join('\n')
            : 'Conecte o joystick e aperte qualquer botão dele com esta página em foco.';
    }

    // ---------- Áudio (sintetizado, sem assets proprietários) ----------

    _ensureAudio() {
        if (!this.audio) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) this.audio = new Ctx();
        }
        this.audio?.resume?.();
    }

    _tone(freq, start, dur, type = 'sine', gain = 0.15) {
        const ac = this.audio;
        if (!ac) return;
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, ac.currentTime + start);
        g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + start);
        o.stop(ac.currentTime + start + dur + 0.05);
    }

    _crtSound(on) {
        if (on) {
            this._tone(60, 0, 0.25, 'square', 0.12);      // "tum" do degauss
            this._tone(15600, 0.1, 1.8, 'sine', 0.012);   // chiado do flyback
        } else {
            this._tone(120, 0, 0.15, 'triangle', 0.1);
        }
    }

    _playBootSound() {
        // Usa wwwroot/sounds/boot.mp3 se existir; senão um acorde sintetizado.
        const audio = new Audio('sounds/boot.mp3');
        audio.volume = 0.7;
        audio.play().catch(() => {
            const chord = [261.6, 329.6, 392.0, 523.3];
            chord.forEach((f, i) => this._tone(f, 0.25 + i * 0.04, 3.2, 'sine', 0.06));
            this._tone(1046.5, 0.9, 2.2, 'triangle', 0.03);
        });
    }

    _beep(freq) {
        this._tone(freq, 0, 0.08, 'square', 0.04);
    }

    // ---------- Limpeza ----------

    dispose() {
        cancelAnimationFrame(this.raf);
        this.input.dispose();
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('message', this._onMessage);
        document.removeEventListener('fullscreenchange', this._onFsChange);
        for (const [el, fn] of this._clicks) el.removeEventListener('click', fn);
        this.iframe.src = 'about:blank';
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.audio?.close?.();
    }
}

function plasterTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
        const v = 170 + Math.floor(Math.random() * 70);
        ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function rugTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 350;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5b1f1c';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 10;
    ctx.strokeRect(22, 22, c.width - 44, c.height - 44);
    ctx.strokeStyle = '#2b1f3a'; ctx.lineWidth = 6;
    ctx.strokeRect(44, 44, c.width - 88, c.height - 88);
    ctx.fillStyle = '#7a3a2a';
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(c.width / 2, c.height / 2, 150 - i * 26, 90 - i * 16, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 ? '#c9a46a' : '#3a2a45';
        ctx.lineWidth = 4;
        ctx.stroke();
    }
    for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.12).toFixed(2)})`;
        ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

function woodTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#4f321d' : '#61402a';
        ctx.fillRect(0, i * 64, 512, 62);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, i * 64 + 62, 512, 2);
    }
    for (let i = 0; i < 400; i++) {
        ctx.strokeStyle = 'rgba(30,15,5,' + (Math.random() * 0.15).toFixed(2) + ')';
        ctx.beginPath();
        const y = Math.random() * 512;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(170, y + Math.random() * 6 - 3, 340, y + Math.random() * 6 - 3, 512, y);
        ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
