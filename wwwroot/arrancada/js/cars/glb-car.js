// Carros modelados no Blender (convertidos por Drag/CarrosBlender/exportar-glb.py).
// O .glb traz a carroceria ("body") e UMA roda ("wheel", centrada no cubo) + pinça opcional ("caliper");
// o .json ao lado traz eixos, bitola, raio da roda e escapes. Aqui a roda é clonada nas 4 posições,
// os materiais originais são trocados por materiais PBR do jogo (pelo nome) e o resultado tem a mesma
// interface dos carros procedurais (root, body, wheels, exhausts, brakeLights...).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Mat, paintMaterial, lightMaterial, contactShadow, addPaintGraphics, addPaintArt } from './car-kit.js';

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

function loadAsset(url) {
    if (!cache.has(url)) {
        cache.set(url, Promise.all([
            loader.loadAsync(url + '.glb'),
            fetch(url + '.json', { cache: 'no-cache' }).then(r => r.json())
        ]));
    }
    return cache.get(url);
}

/** Materiais do jogo, criados por carro (pintura e luzes mudam por carro). */
function materialSet(visual, opts) {
    const paint = paintMaterial(new THREE.Color(visual.paint ?? '#eef0f2'), { metallic: !!opts.metallicPaint });
    if (opts.graphics) addPaintGraphics(paint, visual.stripes ?? '#8d949c', opts.graphics);
    if (opts.art) addPaintArt(paint, opts.art);
    const glass = new THREE.MeshPhysicalMaterial({
        color: 0x161c22, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.5,
        clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.1, side: THREE.DoubleSide, depthWrite: false
    });
    const lens = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16,
        clearcoat: 1, side: THREE.DoubleSide, depthWrite: false
    });
    const tail = new THREE.MeshPhysicalMaterial({
        color: 0x7a0606, emissive: 0xff1a10, emissiveIntensity: 1.3, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.92
    });
    const head = lightMaterial(0xf2f6ff, 1.6);
    const angel = lightMaterial(0xcfe0ff, 3.0);
    const alloy = new THREE.MeshStandardMaterial({ color: 0xd0d3d8, metalness: 1, roughness: 0.22 });
    const darkAlloy = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.9, roughness: 0.3 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x6d7076, metalness: 0.9, roughness: 0.45 });
    const caliper = new THREE.MeshPhysicalMaterial({ color: opts.caliperColor ?? 0x1f4fbf, roughness: 0.35, clearcoat: 0.8 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.86 });
    const reflector = new THREE.MeshPhysicalMaterial({ color: 0x4a0000, roughness: 0.15, clearcoat: 1 });
    const amber = new THREE.MeshPhysicalMaterial({ color: 0xc46a00, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 });
    return {
        paint, glass, lens, tail, head, angel, alloy, darkAlloy, iron, caliper, rubber, tire, reflector, amber,
        chrome: Mat.chrome(), gloss: Mat.gloss(), plastic: Mat.plastic(), interior: Mat.interior()
    };
}

/** Troca o material importado pelo do jogo conforme a tabela [regex, chave] do modelo. */
function remap(mesh, rules, mats) {
    const swap = m => {
        for (const [re, key] of rules) {
            if (re.test(m.name)) return key === 'keep' ? tune(m) : mats[key];
        }
        return tune(m);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
}

function tune(m) {
    // Materiais sem regra (ex.: emblema): mantém a cor e só deixa o PBR razoável.
    if (m.isMeshStandardMaterial) {
        m.roughness = Math.min(m.roughness, 0.45);
        m.envMapIntensity = 1;
    }
    return m;
}

/**
 * Cria o carro. cfg: { url, rules, wheelRules, metallicPaint, graphics | art, caliperColor } (ver glb-models.js).
 * visual (do catálogo): paint, stripes, stance { rideDrop, camberDeg, wheelOffset }.
 */
export async function createGlbCar(cfg, visual = {}) {
    const [gltf, info] = await loadAsset(cfg.url);
    const stance = { rideDrop: 0, camberDeg: 0, wheelOffset: 0, ...(visual.stance ?? {}) };
    const mats = materialSet(visual, cfg);

    const root = new THREE.Group();
    root.name = info.id;
    const body = new THREE.Group();
    body.position.y = -stance.rideDrop;
    root.add(body);

    const find = name => gltf.scene.getObjectByName(name);
    const bodyMesh = find('body').clone();
    bodyMesh.position.set(0, 0, 0);
    bodyMesh.traverse(o => { if (o.isMesh) remap(o, cfg.rules, mats); });
    body.add(bodyMesh);

    // Rodas: clona a roda modelo (que é do lado info.wheelOuter) nas 4 posições, com cambagem.
    const wheelSrc = find('wheel');
    const caliperSrc = find('caliper');
    const camber = THREE.MathUtils.degToRad(stance.camberDeg);
    const halfTrack = info.trackHalf + stance.wheelOffset;
    const templateLeft = info.wheelOuter === 'left';
    const wheels = [];
    for (const x of [info.frontAxle, info.rearAxle]) {
        for (const zSign of [1, -1]) {   // +Z = lado direito (mesma ordem dos carros procedurais)
            const pivot = new THREE.Group();
            pivot.position.set(x, info.wheelRadius, zSign * halfTrack);
            pivot.rotation.x = zSign > 0 ? camber : -camber;   // topo inclinado para dentro
            const flip = new THREE.Group();
            const mirrored = templateLeft ? zSign > 0 : zSign < 0;
            if (mirrored) flip.rotation.y = Math.PI;
            const spin = new THREE.Group();
            const w = wheelSrc.clone();
            w.position.set(0, 0, 0);
            w.traverse(o => { if (o.isMesh) remap(o, [...(cfg.wheelRules ?? []), ...cfg.rules], mats); });
            spin.add(w);
            flip.add(spin);
            if (caliperSrc) {
                const c = caliperSrc.clone();
                c.position.set(0, 0, 0);
                c.traverse(o => { if (o.isMesh) o.material = mats.caliper; });
                flip.add(c);
            }
            pivot.add(flip);
            root.add(pivot);
            // side: sinal do giro em main.js (−ângulo × side) — a roda espelhada gira ao contrário.
            wheels.push({ pivot, spin, radius: info.wheelRadius, side: mirrored ? -1 : 1 });
        }
    }

    root.add(contactShadow(info.length, info.width));
    root.traverse(o => {
        if (!o.isMesh) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        if (list.some(m => m.transparent)) { o.castShadow = false; o.receiveShadow = true; return; }
        o.castShadow = true;
        o.receiveShadow = true;
    });

    return {
        root, body, wheels,
        exhausts: info.exhausts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
        length: info.length, width: info.width, height: info.height - stance.rideDrop,
        wheelbase: info.frontAxle - info.rearAxle,
        brakeLights: [mats.tail], headLights: [mats.head, mats.angel],
        frontAxle: info.frontAxle, rearAxle: info.rearAxle
    };
}
