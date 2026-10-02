// Pista de arrancada na zona portuária ao pôr do sol (clima "Rockport"): asfalto com borracha da largada,
// muretas de concreto, postes, galpões, contêineres, guindastes, árvore de largada e pórtico de chegada.
// A corrida é no eixo +X: largada em x = 0, chegada em x = distance. Pista do jogador em z < 0.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './cars/car-kit.js';

export const LANE_Z = { player: -1.85, opponent: 1.85 };
const ROAD_W = 13, ROAD_START = -260, ROAD_END = 1400;

export class DragWorld {
    constructor(renderer, scene, { distance, quality = 1 }) {
        this.renderer = renderer;
        this.scene = scene;
        this.distance = distance;
        this.quality = quality;
        this.rand = mulberry32(1987);

        this._sky();
        this._lights();
        this._ground();
        this._road();
        this._barriers();
        this._poles();
        this._buildings();
        this._containers();
        this._cranes();
        this._skyline();
        this.tree = this._christmasTree();
        this.board = this._finishGantry();
        this._startGantry();
    }

    // ---------- Céu, luz e ambiente ----------

    _sky() {
        const sky = new Sky();
        sky.scale.setScalar(4500);
        const u = sky.material.uniforms;
        u.turbidity.value = 9;
        u.rayleigh.value = 2.4;
        u.mieCoefficient.value = 0.007;
        u.mieDirectionalG.value = 0.86;
        // Sol baixo, à frente e à esquerda da reta: luz dourada rasante nos carros.
        const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(125));
        u.sunPosition.value.copy(sun);
        this.sunDir = sun.clone();
        this.scene.add(sky);
        this.sky = sky;

        // Reflexos: mapa de ambiente gerado do próprio céu.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const envScene = new THREE.Scene();
        const envSky = new Sky();
        envSky.scale.setScalar(1000);
        Object.assign(envSky.material.uniforms.turbidity, { value: 9 });
        envSky.material.uniforms.rayleigh.value = 2.4;
        envSky.material.uniforms.mieCoefficient.value = 0.007;
        envSky.material.uniforms.mieDirectionalG.value = 0.86;
        envSky.material.uniforms.sunPosition.value.copy(sun);
        envScene.add(envSky);
        // Chão escuro no mapa de ambiente para a pintura não refletir céu por baixo.
        const envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: 0x2a2018 }));
        envGround.rotation.x = -Math.PI / 2;
        envGround.position.y = -5;
        envScene.add(envGround);
        this.envMap = pmrem.fromScene(envScene, 0.02).texture;
        this.scene.environment = this.envMap;
        this.scene.environmentIntensity = 0.85;
        pmrem.dispose();

        this.scene.fog = new THREE.FogExp2(0xc99a72, 0.0016);
        this.scene.background = new THREE.Color(0xc99a72);
    }

    _lights() {
        const hemi = new THREE.HemisphereLight(0xa9bddb, 0x5b4632, 0.55);
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xffc48a, 3.4);
        sun.castShadow = true;
        const size = this.quality > 0.7 ? 4096 : 2048;
        sun.shadow.mapSize.set(size, size);
        Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 220 });
        sun.shadow.bias = -0.0003;
        sun.shadow.normalBias = 0.03;
        this.scene.add(sun, sun.target);
        this.sun = sun;
    }

    /** A sombra do sol acompanha o ponto de interesse (os carros). */
    followShadow(x) {
        const d = this.sunDir;
        this.sun.target.position.set(x + 8, 0, 0);
        this.sun.position.set(x + 8 + d.x * 120, d.y * 120, d.z * 120);
        this.sun.target.updateMatrixWorld();
    }

    // ---------- Chão e pista ----------

    _ground() {
        const tex = canvasTexture(512, 512, (ctx, w, h) => {
            ctx.fillStyle = '#6f6253';
            ctx.fillRect(0, 0, w, h);
            noise(ctx, w, h, 26000, [[95, 84, 72], [120, 106, 90], [70, 62, 54]], 0.5, 3);
            ctx.strokeStyle = 'rgba(40,34,28,0.35)';
            ctx.lineWidth = 2;
            for (let i = 0; i <= 512; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
        }, { repeat: true });
        tex.repeat.set(400, 400);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, color: 0x9a8a78 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.02;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    _road() {
        const len = ROAD_END - ROAD_START;
        // Asfalto: cor, rugosidade e relevo gerados com o mesmo ruído.
        const seed = mulberry32(7);
        const grains = [];
        for (let i = 0; i < 60000; i++) grains.push([seed() * 1024, seed() * 1024, seed(), 1 + seed() * 2.2]);
        const draw = (palette, alpha) => (ctx, w, h) => {
            ctx.fillStyle = palette.base;
            ctx.fillRect(0, 0, w, h);
            for (const [x, y, v, s] of grains) {
                const c = v < 0.33 ? palette.a : v < 0.66 ? palette.b : palette.c;
                ctx.fillStyle = `rgba(${c},${alpha})`;
                ctx.fillRect(x, y, s, s);
            }
            ctx.strokeStyle = palette.crack;
            ctx.lineWidth = 2;
            const r = mulberry32(11);
            for (let i = 0; i < 7; i++) {
                ctx.beginPath();
                let x = r() * w, y = r() * h;
                ctx.moveTo(x, y);
                for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 70; y += (r() - 0.3) * 50; ctx.lineTo(x, y); }
                ctx.stroke();
            }
        };
        const map = canvasTexture(1024, 1024, draw({ base: '#3a3836', a: '58,56,54', b: '86,82,78', c: '28,27,26', crack: 'rgba(15,15,15,0.6)' }, 0.75), { repeat: true });
        const rough = canvasTexture(1024, 1024, draw({ base: '#d8d8d8', a: '200,200,200', b: '255,255,255', c: '150,150,150', crack: 'rgba(120,120,120,1)' }, 0.8), { repeat: true, srgb: false });
        const bump = canvasTexture(1024, 1024, draw({ base: '#808080', a: '60,60,60', b: '200,200,200', c: '30,30,30', crack: 'rgba(0,0,0,1)' }, 1), { repeat: true, srgb: false });
        for (const t of [map, rough, bump]) t.repeat.set(len / 7, ROAD_W / 7);
        const road = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_W),
            new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.92, bumpMap: bump, bumpScale: 1.2 }));
        road.rotation.x = -Math.PI / 2;
        road.position.set(ROAD_START + len / 2, 0, 0);
        road.receiveShadow = true;
        this.scene.add(road);

        // Borracha das largadas: duas faixas escuras em cada pista, sumindo depois de ~200 m.
        const rubber = canvasTexture(1024, 128, (ctx, w, h) => {
            const r = mulberry32(5);
            for (let i = 0; i < 260; i++) {
                const y = h * (0.12 + r() * 0.26) + (i % 2 ? h * 0.5 : 0);
                const len2 = w * (0.2 + r() * 0.8);
                const g = ctx.createLinearGradient(0, 0, len2, 0);
                g.addColorStop(0, `rgba(8,8,8,${0.18 + r() * 0.2})`);
                g.addColorStop(1, 'rgba(8,8,8,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, y, len2, 2 + r() * 5);
            }
        }, { srgb: false });
        const rubberMat = new THREE.MeshStandardMaterial({ color: 0x050505, alphaMap: rubber, transparent: true, depthWrite: false, roughness: 0.6 });
        for (const z of [LANE_Z.player, LANE_Z.opponent]) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(230, 2.2), rubberMat);
            m.rotation.x = -Math.PI / 2;
            m.position.set(-5 + 115, 0.004, z);
            m.receiveShadow = true;
            this.scene.add(m);
        }

        // Pintura: bordas brancas, divisória dupla amarela, linha de largada, quadriculado da chegada.
        const paint = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7 });
        const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b12a, roughness: 0.7 });
        const strip = (x0, x1, z, w, mat) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, w), mat);
            m.rotation.x = -Math.PI / 2;
            m.position.set((x0 + x1) / 2, 0.006, z);
            m.receiveShadow = true;
            this.scene.add(m);
        };
        strip(ROAD_START, ROAD_END, -ROAD_W / 2 + 0.4, 0.15, paint);
        strip(ROAD_START, ROAD_END, ROAD_W / 2 - 0.4, 0.15, paint);
        strip(ROAD_START, ROAD_END, -0.1, 0.1, yellow);
        strip(ROAD_START, ROAD_END, 0.1, 0.1, yellow);
        strip(-0.15, 0.15, -ROAD_W / 4, ROAD_W / 2 - 0.6, paint);
        strip(-0.15, 0.15, ROAD_W / 4, ROAD_W / 2 - 0.6, paint);

        const checker = canvasTexture(256, 32, (ctx, w, h) => {
            for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) {
                ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
                ctx.fillRect(x * 8, y * 8, 8, 8);
            }
        });
        checker.magFilter = THREE.NearestFilter;
        const fin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, ROAD_W - 0.8), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 }));
        fin.rotation.x = -Math.PI / 2;
        fin.rotation.z = Math.PI / 2;
        fin.position.set(this.distance, 0.007, 0);
        fin.receiveShadow = true;
        this.scene.add(fin);

        // Placas de distância (60 ft, 330 ft, 1/8 de milha, 1000 ft).
        for (const [m, label] of [[18.3, '60 FT'], [100.6, '330 FT'], [201.2, '1/8'], [304.8, '1000 FT']]) {
            const tex = canvasTexture(256, 128, (ctx, w, h) => {
                ctx.fillStyle = '#f2f0ea'; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#111'; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, w / 2, h / 2);
            });
            for (const s of [-1, 1]) {
                const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
                sign.position.set(m, 1.9, s * (ROAD_W / 2 + 1.0));
                sign.rotation.y = -Math.PI / 2;
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
                post.position.set(m + 0.02, 0.8, s * (ROAD_W / 2 + 1.0));
                sign.castShadow = post.castShadow = true;
                this.scene.add(sign, post);
            }
        }
    }

    _barriers() {
        // Mureta "New Jersey" extrudada ao longo da pista.
        const s = new THREE.Shape();
        s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.12, 0.3); s.lineTo(0.09, 0.82);
        s.lineTo(-0.09, 0.82); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.08); s.closePath();
        const len = ROAD_END - ROAD_START;
        const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 });
        geo.rotateY(Math.PI / 2);
        const tex = canvasTexture(512, 128, (ctx, w, h) => {
            ctx.fillStyle = '#a7a39b'; ctx.fillRect(0, 0, w, h);
            noise(ctx, w, h, 9000, [[150, 146, 138], [185, 180, 170], [120, 116, 110]], 0.5, 2);
            ctx.fillStyle = 'rgba(40,36,30,0.55)';
            ctx.fillRect(0, 0, 3, h);
            const g = ctx.createLinearGradient(0, h, 0, h * 0.6);
            g.addColorStop(0, 'rgba(50,40,30,0.5)'); g.addColorStop(1, 'rgba(50,40,30,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            // Faixas zebradas de segurança.
            for (let x = 0; x < w; x += 128) { ctx.fillStyle = 'rgba(200,40,30,0.75)'; ctx.fillRect(x + 64, 10, 64, 18); }
        }, { repeat: true });
        tex.repeat.set(1 / 3.0, 1);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
        for (const z of [-ROAD_W / 2 - 0.4, ROAD_W / 2 + 0.4]) {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(ROAD_START, 0, z);
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
        }
    }

    _poles() {
        // Postes com luminária de vapor de sódio (acesas ao entardecer).
        const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.85, roughness: 0.45 });
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 3 });
        const pole = new THREE.CylinderGeometry(0.09, 0.14, 10, 10);
        pole.translate(0, 5, 0);
        const arm = new THREE.BoxGeometry(0.1, 0.1, 2.2);
        arm.translate(0, 9.9, -1.1);
        const head = new THREE.BoxGeometry(0.35, 0.12, 0.7);
        head.translate(0, 9.82, -2.1);
        const bulb = new THREE.BoxGeometry(0.28, 0.02, 0.55);
        bulb.translate(0, 9.75, -2.1);
        const poleGeo = mergeGeometries([pole, arm, head]);
        const count = Math.ceil((ROAD_END - ROAD_START) / 45) * 2;
        const poles = new THREE.InstancedMesh(poleGeo, metal, count);
        const bulbs = new THREE.InstancedMesh(bulb, lampMat, count);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
        let i = 0;
        for (let x = ROAD_START + 10; x < ROAD_END; x += 45) {
            for (const s of [-1, 1]) {
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? Math.PI : 0);
                m.compose(new THREE.Vector3(x + (s > 0 ? 22 : 0), 0, s * (ROAD_W / 2 + 1.6)), q, one);
                poles.setMatrixAt(i, m);
                bulbs.setMatrixAt(i, m);
                i++;
            }
        }
        poles.count = bulbs.count = i;
        poles.castShadow = true;
        this.scene.add(poles, bulbs);
    }

    _buildings() {
        // Galpões de chapa corrugada, com UV em metros para a textura não esticar.
        const corrugated = (base, rust) => canvasTexture(512, 512, (ctx, w, h) => {
            ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
            for (let x = 0; x < w; x += 8) {
                const g = ctx.createLinearGradient(x, 0, x + 8, 0);
                g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0.10)');
                ctx.fillStyle = g; ctx.fillRect(x, 0, 8, h);
            }
            noise(ctx, w, h, 4000, [rust], 0.25, 3);
            const g = ctx.createLinearGradient(0, h, 0, h * 0.7);
            g.addColorStop(0, 'rgba(60,40,25,0.55)'); g.addColorStop(1, 'rgba(60,40,25,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = 'rgba(20,24,28,0.9)';
            for (let x = 30; x < w; x += 128) ctx.fillRect(x, 40, 70, 30);   // janelas altas (topo da parede)
            ctx.fillStyle = 'rgba(30,30,30,0.85)';
            ctx.fillRect(200, 300, 150, 212);                                   // portão de carga
        }, { repeat: true });
        const mats = [
            new THREE.MeshStandardMaterial({ map: corrugated('#8d8f8c', [120, 70, 40]), roughness: 0.75, metalness: 0.35 }),
            new THREE.MeshStandardMaterial({ map: corrugated('#6d7c86', [110, 70, 50]), roughness: 0.75, metalness: 0.35 }),
            new THREE.MeshStandardMaterial({ map: corrugated('#9b7f62', [90, 50, 30]), roughness: 0.8, metalness: 0.25 })
        ];
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 0.85 });
        const lists = mats.map(() => []);
        const roofs = [];
        const r = this.rand;
        for (const s of [-1, 1]) {
            let x = ROAD_START;
            while (x < ROAD_END + 200) {
                const w = 28 + r() * 60, d = 18 + r() * 30, h = 7 + r() * 16;
                const z = s * (ROAD_W / 2 + 18 + r() * 25 + d / 2);
                if (!(Math.abs(x) < 40 && s < 0)) {
                    lists[Math.floor(r() * mats.length)].push(boxWithMetricUv(w, h, d, x + w / 2, h / 2, z, 4));
                    // Telhado de duas águas.
                    const gable = new THREE.Shape([
                        new THREE.Vector2(-d / 2 - 0.4, 0), new THREE.Vector2(d / 2 + 0.4, 0), new THREE.Vector2(0, d * 0.14)
                    ]);
                    const roof = new THREE.ExtrudeGeometry(gable, { depth: w + 0.8, bevelEnabled: false });
                    roof.rotateY(-Math.PI / 2);
                    roof.translate(x + w + 0.4, h, z);
                    roofs.push(roof);
                }
                x += w + 6 + r() * 30;
            }
        }
        lists.forEach((list, i) => {
            if (!list.length) return;
            const m = new THREE.Mesh(mergeGeometries(list), mats[i]);
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
        });
        const roofMesh = new THREE.Mesh(mergeGeometries(roofs), roofMat);
        roofMesh.castShadow = true;
        this.scene.add(roofMesh);
    }

    _containers() {
        const tex = canvasTexture(256, 128, (ctx, w, h) => {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
            for (let x = 0; x < w; x += 6) { ctx.fillStyle = x % 12 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.4)'; ctx.fillRect(x, 0, 3, h); }
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
            noise(ctx, w, h, 1500, [[90, 50, 30]], 0.35, 2);
        });
        const geo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.3 });
        const colors = [0xb23a2a, 0x2a5fa8, 0x2f7d4a, 0xc9a227, 0x7a7d80, 0xd56a1f, 0x5b2f6e];
        const count = 220;
        const inst = new THREE.InstancedMesh(geo, mat, count);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
        const c = new THREE.Color();
        const r = this.rand;
        let i = 0;
        for (let stack = 0; stack < 40 && i < count; stack++) {
            const s = r() < 0.5 ? -1 : 1;
            const bx = ROAD_START + 60 + r() * (ROAD_END - ROAD_START - 100);
            const bz = s * (ROAD_W / 2 + 9 + r() * 6);
            const rows = 1 + Math.floor(r() * 3);
            const layers = 1 + Math.floor(r() * 3);
            for (let row = 0; row < rows; row++) for (let l = 0; l < layers && i < count; l++) {
                p.set(bx + (r() - 0.5) * 0.4, 1.3 + l * 2.6, bz + s * row * 2.5);
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.04);
                m.compose(p, q, sc);
                inst.setMatrixAt(i, m);
                inst.setColorAt(i, c.setHex(colors[Math.floor(r() * colors.length)]));
                i++;
            }
        }
        inst.count = i;
        inst.castShadow = inst.receiveShadow = true;
        this.scene.add(inst);
    }

    _cranes() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xc4512a, roughness: 0.7, metalness: 0.4 });
        const parts = [];
        const leg = (x, z, h) => { const g = new THREE.BoxGeometry(1.2, h, 1.2); g.translate(x, h / 2, z); parts.push(g); };
        for (const [cx, cz] of [[180, 140], [420, 160], [690, 145], [-60, 150]]) {
            leg(cx - 8, cz - 7, 42); leg(cx + 8, cz - 7, 42); leg(cx - 8, cz + 7, 42); leg(cx + 8, cz + 7, 42);
            const top = new THREE.BoxGeometry(18, 2.5, 16); top.translate(cx, 43, cz); parts.push(top);
            const boom = new THREE.BoxGeometry(2.2, 2.2, 95); boom.translate(cx, 47, cz - 25); parts.push(boom);
            const back = new THREE.BoxGeometry(2.2, 2.2, 30); back.translate(cx, 47, cz + 22); parts.push(back);
            const cab = new THREE.BoxGeometry(4, 3, 4); cab.translate(cx, 44, cz - 10); parts.push(cab);
            for (let k = 0; k < 6; k++) {
                const brace = new THREE.BoxGeometry(0.5, 20, 0.5);
                brace.rotateX(0.65 * (k % 2 ? 1 : -1));
                brace.translate(cx + (k < 3 ? -8 : 8), 12 + (k % 3) * 10, cz);
                parts.push(brace);
            }
        }
        const m = new THREE.Mesh(mergeGeometries(parts), mat);
        m.castShadow = true;
        this.scene.add(m);
    }

    _skyline() {
        // Prédios distantes com janelas começando a acender.
        const tex = canvasTexture(256, 512, (ctx, w, h) => {
            ctx.fillStyle = '#2a2a30'; ctx.fillRect(0, 0, w, h);
            const r = mulberry32(3);
            for (let y = 8; y < h; y += 14) for (let x = 6; x < w; x += 12) {
                const lit = r() < 0.22;
                ctx.fillStyle = lit ? `rgba(255,${190 + r() * 50 | 0},120,0.95)` : 'rgba(60,70,85,0.9)';
                ctx.fillRect(x, y, 7, 8);
            }
        }, { repeat: true });
        const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.4 });
        const list = [];
        const r = mulberry32(99);
        for (let i = 0; i < 70; i++) {
            const w = 25 + r() * 45, d = 25 + r() * 45, h = 40 + r() * 160;
            const x = 500 + r() * 1600, z = (r() < 0.5 ? -1 : 1) * (300 + r() * 700);
            list.push(boxWithMetricUv(w, h, d, x, h / 2, z, 30, 30));
        }
        this.scene.add(new THREE.Mesh(mergeGeometries(list), mat));
    }

    // ---------- Árvore de largada e pórticos ----------

    _christmasTree() {
        const g = new THREE.Group();
        g.position.set(-1.5, 0, 0);
        const dark = new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.6, roughness: 0.5 });
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 12), dark);
        pole.position.y = 1.1;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.62), dark);
        box.position.y = 2.75;
        g.add(pole, box);
        const bulb = new THREE.SphereGeometry(0.075, 16, 10);
        const make = color => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0, roughness: 0.3 });
        const rows = [
            ['stage', 0xfff2c0, 3.4], ['amber1', 0xffa000, 3.12], ['amber2', 0xffa000, 2.88],
            ['amber3', 0xffa000, 2.64], ['green', 0x18ff40, 2.36], ['red', 0xff1010, 2.12]
        ];
        const lights = {};
        for (const [name, color, y] of rows) {
            const mat = make(color);
            lights[name] = mat;
            // Visível dos dois lados (os carros chegam por trás e a câmera de introdução vê pela frente).
            for (const side of [-1, 1]) for (const dz of [-0.16, 0.16]) {
                const m = new THREE.Mesh(bulb, mat);
                m.position.set(0.12 * side, y, dz);
                g.add(m);
            }
        }
        this.scene.add(g);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return {
            group: g,
            /** Estado: { stage, amber: 0..3, green, red } */
            set({ stage = false, amber = 0, green = false, red = false } = {}) {
                lights.stage.emissiveIntensity = stage ? 3 : 0;
                lights.amber1.emissiveIntensity = amber >= 1 ? 6 : 0;
                lights.amber2.emissiveIntensity = amber >= 2 ? 6 : 0;
                lights.amber3.emissiveIntensity = amber >= 3 ? 6 : 0;
                lights.green.emissiveIntensity = green ? 7 : 0;
                lights.red.emissiveIntensity = red ? 7 : 0;
            }
        };
    }

    _truss(x, label, color) {
        const g = new THREE.Group();
        const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.4 });
        const span = ROAD_W + 3;
        for (const s of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.35), metal);
            leg.position.set(0, 3.5, s * span / 2);
            g.add(leg);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, span + 0.4), metal);
        beam.position.y = 7;
        g.add(beam);
        const tex = canvasTexture(1024, 160, (ctx, w, h) => {
            ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#fff'; ctx.font = 'italic 900 104px "Arial Black", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, w / 2, h / 2 + 4);
        });
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(span - 1, (span - 1) * 160 / 1024),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
        banner.rotation.y = -Math.PI / 2;
        banner.position.set(-0.27, 7, 0);
        g.add(banner);
        g.position.x = x;
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(g);
        return g;
    }

    _startGantry() {
        this._truss(-3, 'ARRANCADA DO PORTO', '#b3121b');
    }

    _finishGantry() {
        this._truss(this.distance, 'CHEGADA', '#111111');
        // Painéis de tempo (um por pista), atualizados no fim da corrida.
        const boards = {};
        for (const [lane, z] of Object.entries(LANE_Z)) {
            const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 192 });
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6 });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), mat);
            m.rotation.y = -Math.PI / 2;
            m.position.set(this.distance + 6, 4.4, z * 2.6);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 3.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
            frame.position.set(this.distance + 6.16, 4.4, z * 2.6);
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.8), new THREE.MeshStandardMaterial({ color: 0x333333 }));
            post.position.set(this.distance + 6.2, 1.9, z * 2.6);
            this.scene.add(m, frame, post);
            boards[lane] = { canvas, tex };
        }
        const draw = (lane, et, kmh) => {
            const { canvas, tex } = boards[lane];
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 512, 192);
            ctx.font = 'bold 84px "Courier New", monospace';
            ctx.textAlign = 'right';
            ctx.fillStyle = '#ff3b1f';
            ctx.fillText(et, 490, 90);
            ctx.fillStyle = '#ffb21f';
            ctx.font = 'bold 54px "Courier New", monospace';
            ctx.fillText(kmh, 490, 168);
            tex.needsUpdate = true;
        };
        const api = {
            show(lane, etSeconds, kmh) { draw(lane, etSeconds.toFixed(3), kmh.toFixed(0) + ' KM/H'); },
            clear() { for (const lane of Object.keys(boards)) draw(lane, '--.---', '--- KM/H'); }
        };
        api.clear();
        return api;
    }
}

// ---------- Utilidades ----------

/** Caixa com UV horizontal em metros (a textura repete a cada `tile` m) e vertical cobrindo a altura toda
 *  (ou repetindo a cada `tileY` m, se informado). */
function boxWithMetricUv(w, h, d, x, y, z, tile, tileY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
        const sx = nx > 0.5 ? d : w, sy = ny > 0.5 ? d : h;
        uv.setXY(i, uv.getX(i) * sx / tile, tileY ? uv.getY(i) * sy / tileY : uv.getY(i));
    }
    g.translate(x, y, z);
    return g;
}

function noise(ctx, w, h, count, colors, alpha, size) {
    for (let i = 0; i < count; i++) {
        const c = colors[i % colors.length];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(Math.random() * alpha).toFixed(3)})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * size, 1 + Math.random() * size);
    }
}

export function mulberry32(a) {
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
