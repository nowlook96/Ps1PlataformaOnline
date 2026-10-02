// Kit para montar carros procedurais "foto-realistas" em Three.js:
// carroceria extrudada a partir do perfil lateral (com caixas de roda), deformada em planta
// (bico arredondado, ombro, tumblehome), cabine com vidros, rodas detalhadas com cambagem e peças
// encaixadas na superfície por raycast. Cada modelo procedural (ex.: bmw-f31.js) só descreve medidas; carros do Blender usam glb-car.js.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- Materiais ----------

const shared = {};
function once(key, make) { return shared[key] ??= make(); }

export const Mat = {
    glass: () => once('glass', () => new THREE.MeshPhysicalMaterial({
        color: 0x06080a, metalness: 0, roughness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.04, envMapIntensity: 0.7
    })),
    gloss: () => once('gloss', () => new THREE.MeshPhysicalMaterial({
        color: 0x050505, metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05
    })),
    plastic: () => once('plastic', () => new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.62, metalness: 0 })),
    chrome: () => once('chrome', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.06 })),
    darkChrome: () => once('darkChrome', () => new THREE.MeshStandardMaterial({ color: 0x7d838b, metalness: 1, roughness: 0.14 })),
    alloy: () => once('alloy', () => new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.28 })),
    rubber: () => once('rubber', () => new THREE.MeshStandardMaterial({
        color: 0xffffff, map: tireTexture(), roughness: 0.88, metalness: 0, side: THREE.DoubleSide
    })),
    disc: () => once('disc', () => new THREE.MeshStandardMaterial({ color: 0x8a8d91, metalness: 0.9, roughness: 0.42 })),
    underbody: () => once('underbody', () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, side: THREE.DoubleSide })),
    lens: () => once('lens', () => new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 0, transparent: true, opacity: 0.07,
        clearcoat: 1, clearcoatRoughness: 0.01, depthWrite: false
    })),
    interior: () => once('interior', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }))
};

/** Pintura automotiva: base + verniz (clearcoat). */
export function paintMaterial(color, { metallic = false, map = null } = {}) {
    return new THREE.MeshPhysicalMaterial({
        color, map,
        metalness: metallic ? 0.55 : 0.0,
        roughness: metallic ? 0.34 : 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.035,
        envMapIntensity: 1.1
    });
}

/** Luz (farol, lanterna, LED): emissiva, cresce no bloom. */
export function lightMaterial(color, intensity = 2) {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
}

export function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

/** Textura de placa com o texto dado (padrão Mercosul estilizado). */
export function plateTexture(text) {
    return canvasTexture(512, 160, (ctx, w, h) => {
        ctx.fillStyle = '#f4f4f2';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#123a8c';
        ctx.fillRect(0, 0, w, 34);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BRASIL', w / 2, 25);
        ctx.fillStyle = '#111';
        ctx.font = 'bold 96px "Arial Narrow", Arial';
        ctx.fillText(text, w / 2, 132);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, w - 6, h - 6);
    });
}

function tireTexture() {
    // u = volta do pneu, v = perfil (0 = talão interno, 1 = talão externo). Ver createWheel.
    const t = canvasTexture(2048, 256, (ctx, w, h) => {
        ctx.fillStyle = '#1b1b1c';
        ctx.fillRect(0, 0, w, h);
        // Banda de rodagem: sulcos circunferenciais e lamelas.
        ctx.fillStyle = '#0c0c0c';
        for (const v of [0.43, 0.5, 0.57]) ctx.fillRect(0, v * h - 3, w, 6);
        for (let x = 0; x < w; x += 18) ctx.fillRect(x, 0.37 * h, 3, 0.06 * h), ctx.fillRect(x + 9, 0.58 * h, 3, 0.06 * h);
        // Letras em relevo no flanco externo.
        ctx.fillStyle = '#5d5d5e';
        ctx.font = 'bold 15px Arial';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 2; i++) {
            ctx.fillText('STANCE  RADIAL  225/35 ZR19  ·  DRAG SPEC', 60 + i * w / 2, 0.84 * h);
        }
        // Ruído de borracha.
        for (let i = 0; i < 9000; i++) {
            ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.03).toFixed(3)})`;
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
        }
    });
    return t;
}

// ---------- Carroceria ----------

/**
 * Perfil lateral da carroceria inferior.
 * top: pontos [x, y] do contorno superior, da frente (embaixo do para-choque) até a traseira.
 * arches: caixas de roda [{ x, cy, r }] de trás para frente; o contorno de baixo passa pela soleira (sillY).
 */
export function lowerBodyShape({ top, sillY, arches, rearBottom = [], frontBottom = [] }) {
    const s = new THREE.Shape();
    s.moveTo(top[0][0], top[0][1]);
    s.splineThru(top.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [x, y] of rearBottom) s.lineTo(x, y);
    for (const a of arches) {
        const th = Math.asin(THREE.MathUtils.clamp((sillY - a.cy) / a.r, -1, 1));
        s.lineTo(a.x - a.r * Math.cos(th), sillY);
        s.absarc(a.x, a.cy, a.r, Math.PI - th, th, true);
    }
    for (const [x, y] of frontBottom) s.lineTo(x, y);
    return s;
}

/** Contorno fechado suave (cabine, vidros). */
export function splineShape(points, closePoints = []) {
    const s = new THREE.Shape();
    s.moveTo(points[0][0], points[0][1]);
    s.splineThru(points.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [x, y] of closePoints) s.lineTo(x, y);
    return s;
}

/** Extruda o perfil na largura (eixo Z) centralizado, com chanfro arredondado. */
export function extrudeProfile(shape, width, { bevel = 0.05, bevelSeg = 5, steps = 12, curveSeg = 10 } = {}) {
    const depth = Math.max(0.01, width - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth, steps, curveSegments: curveSeg,
        bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: bevelSeg
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
}

/** Aplica fn(v) em cada vértice (v é um Vector3 reutilizado) e recalcula normais com vincos. */
export function deform(geo, fn, creaseDeg = 38) {
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        fn(v);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    const groups = geo.groups.map(g => ({ ...g }));
    const out = toCreasedNormals(geo, THREE.MathUtils.degToRad(creaseDeg));
    out.clearGroups();
    for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
    return out;
}

/** Separa os triângulos de uma geometria (não indexada) em várias, conforme classify(normal, centro, grupo). */
export function splitGeometry(geo, classify) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const attrs = Object.keys(src.attributes);
    const buckets = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), m = new THREE.Vector3();
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
    const pos = src.attributes.position;
    for (const g of groups) {
        for (let i = g.start; i < g.start + g.count; i += 3) {
            a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
            n.subVectors(c, b).cross(m.subVectors(a, b)).normalize();
            const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
            const key = classify(n, center, g.materialIndex);
            if (key == null) continue;
            if (!buckets.has(key)) buckets.set(key, Object.fromEntries(attrs.map(k => [k, []])));
            const bk = buckets.get(key);
            for (const k of attrs) {
                const at = src.attributes[k];
                for (let j = 0; j < 3; j++) for (let d = 0; d < at.itemSize; d++) bk[k].push(at.array[(i + j) * at.itemSize + d]);
            }
        }
    }
    const out = new Map();
    for (const [key, data] of buckets) {
        const bg = new THREE.BufferGeometry();
        for (const k of attrs) bg.setAttribute(k, new THREE.Float32BufferAttribute(data[k], src.attributes[k].itemSize));
        out.set(key, bg);
    }
    return out;
}

/** Ajusta repeat/offset para que UV = coordenadas do perfil (metros) caiba no retângulo [minX..maxX]×[minY..maxY]. */
export function fitProfileTexture(tex, minX, minY, maxX, maxY) {
    const w = maxX - minX, h = maxY - minY;
    tex.repeat.set(1 / w, 1 / h);
    tex.offset.set(-minX / w, -minY / h);
    return tex;
}

/**
 * Desenha em canvas usando coordenadas do perfil (metros). draw(ctx, X, Y, S) recebe conversores.
 * Devolve textura já ajustada para o UV das tampas da extrusão.
 */
export function profileCanvas(bounds, pxPerM, draw, opts) {
    const [minX, minY, maxX, maxY] = bounds;
    const w = Math.ceil((maxX - minX) * pxPerM), h = Math.ceil((maxY - minY) * pxPerM);
    const X = x => (x - minX) * pxPerM;
    const Y = y => h - (y - minY) * pxPerM;
    const tex = canvasTexture(w, h, ctx => draw(ctx, X, Y, pxPerM, w, h), opts);
    return fitProfileTexture(tex, minX, minY, maxX, maxY);
}

// ---------- Encaixe por raycast ----------

const ray = new THREE.Raycaster();

/** Encontra o ponto da superfície de `targets` a partir de `origin` na direção `dir` (coordenadas do carro). */
export function surfaceHit(targets, origin, dir) {
    ray.set(origin, dir.clone().normalize());
    ray.far = 10;
    const hits = ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    return { point: h.point.clone(), normal };
}

/**
 * Coloca `obj` encostado na superfície: frente do objeto (+Z local) apontando na normal,
 * afastado `offset` metros. `up` define o "para cima" do objeto.
 */
export function placeOnSurface(obj, hit, offset = 0.002, up = new THREE.Vector3(0, 1, 0)) {
    if (!hit) return obj;
    obj.position.copy(hit.point).addScaledVector(hit.normal, offset);
    const m = new THREE.Matrix4();
    const zAxis = hit.normal.clone().normalize();
    const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    m.makeBasis(xAxis, yAxis, zAxis);
    obj.quaternion.setFromRotationMatrix(m);
    return obj;
}

/** Painel plano (decalque) com cantos arredondados, frente em +Z. */
export function roundedPanel(w, h, r, material, depth = 0.01) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const geo = new THREE.ExtrudeGeometry(s, {
        depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: Math.min(depth * 0.5, r * 0.5), bevelSegments: 3, curveSegments: 8
    });
    geo.translate(0, 0, -depth);
    // UV da tampa em 0..1 para texturas (placa, grades).
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h);
    return new THREE.Mesh(geo, material);
}

export function roundedBox(w, h, d, r, material) {
    return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), material);
}

// ---------- Rodas ----------

/**
 * Roda completa: pneu (com estique de stance), aro com tala funda e lábio polido, raios, disco e pinça.
 * Eixo em Z, face externa em +Z. Retorna { group, spin } — gire `spin.rotation.z` para rodar.
 */
export function createWheel(o) {
    const {
        tireR = 0.32, tireW = 0.21, rimR = 0.241, rimW = 0.25, beadW = rimW * 0.96,
        spokes = 10, spokeStyle = 'split', faceMat = Mat.alloy(), lipMat = Mat.chrome(),
        dish = 0.045, caliperColor = 0xc81d25
    } = o;
    const group = new THREE.Group();
    const spin = new THREE.Group();
    group.add(spin);

    // Pneu: perfil do talão interno ao externo girado em volta do eixo.
    const hw = tireW / 2, hb = beadW / 2, R = tireR, r = rimR;
    const mid = r + (R - r) * 0.5;
    const prof = [
        [r - 0.006, -hb], [r + 0.012, -hb - 0.004], [mid, -(hb * 0.55 + hw * 0.45) - 0.004], [R - 0.022, -hw],
        [R - 0.006, -hw + 0.01], [R, -hw + 0.03], [R, hw - 0.03], [R - 0.006, hw - 0.01],
        [R - 0.022, hw], [mid, (hb * 0.55 + hw * 0.45) + 0.004], [r + 0.012, hb + 0.004], [r - 0.006, hb]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const tireGeo = new THREE.LatheGeometry(prof, 72);
    tireGeo.rotateX(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, Mat.rubber());
    spin.add(tire);

    // Cilindro interno do aro (barril).
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.004, r - 0.004, rimW * 0.94, 48, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.9, roughness: 0.45, side: THREE.DoubleSide }));
    barrel.rotation.x = Math.PI / 2;
    spin.add(barrel);

    // Lábio polido + degrau da tala funda (perfil girado).
    const zl = rimW / 2, zf = zl - dish;
    const lipPts = [
        [r * 0.8, zf - 0.004], [r * 0.81, zf + 0.002], [r * 0.835, zl - 0.012], [r * 0.86, zl - 0.002],
        [r * 0.9, zl], [r + 0.008, zl], [r + 0.016, zl - 0.005], [r + 0.014, zl - 0.014], [r - 0.002, zl - 0.02]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const lipGeo = new THREE.LatheGeometry(lipPts, 72);
    lipGeo.rotateX(Math.PI / 2);
    spin.add(new THREE.Mesh(lipGeo, lipMat));

    // Anel da face onde os raios encostam.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.79, 0.012, 10, 64), faceMat);
    ring.position.z = zf;
    spin.add(ring);

    // Raios: formato afinando para o centro, levemente côncavos.
    const spokeLen = r * 0.79;
    const mkSpoke = (wIn, wOut) => {
        const s = new THREE.Shape();
        s.moveTo(0.055, -wIn / 2); s.lineTo(spokeLen, -wOut / 2); s.lineTo(spokeLen, wOut / 2); s.lineTo(0.055, wIn / 2);
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 2 });
        g.translate(0, 0, -0.018);
        return g;
    };
    const spokeGeo = spokeStyle === 'five' ? mkSpoke(0.05, 0.075) : mkSpoke(0.016, 0.024);
    const count = spokeStyle === 'five' ? 5 : spokes;
    for (let i = 0; i < count; i++) {
        const offsets = spokeStyle === 'split' ? [-0.07, 0.07] : [0];
        for (const off of offsets) {
            const holder = new THREE.Group();
            holder.rotation.z = (i / count) * Math.PI * 2 + off;
            const sp = new THREE.Mesh(spokeGeo, faceMat);
            sp.rotation.y = -0.12;           // concavidade: centro afundado em relação ao aro
            sp.position.z = zf - 0.016;
            holder.add(sp);
            spin.add(holder);
        }
    }

    // Cubo, porcas e calota central.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.07, 0.04, 32), faceMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = zf - 0.012;
    spin.add(hub);
    const nutGeo = new THREE.CylinderGeometry(0.0075, 0.0075, 0.02, 6);
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const nut = new THREE.Mesh(nutGeo, Mat.chrome());
        nut.rotation.x = Math.PI / 2;
        nut.position.set(Math.cos(a) * 0.045, Math.sin(a) * 0.045, zf + 0.012);
        spin.add(nut);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 32), Mat.gloss());
    cap.rotation.x = Math.PI / 2;
    cap.position.z = zf + 0.01;
    spin.add(cap);

    // Disco de freio (gira) e pinça (fixa).
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.78, 0.026, 48), Mat.disc());
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -0.01;
    spin.add(disc);
    const caliper = roundedBox(0.075, 0.16, 0.06, 0.015,
        new THREE.MeshPhysicalMaterial({ color: caliperColor, roughness: 0.35, clearcoat: 0.8 }));
    caliper.position.set(-r * 0.62, r * 0.32, 0.0);
    caliper.rotation.z = 0.5;
    group.add(caliper);

    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group, spin, radius: tireR };
}

/**
 * Prende as quatro rodas no carro com cambagem. wheels: [{ x, z, side: ±1 }].
 * Retorna a lista { pivot, spin } para animar.
 */
export function mountWheels(root, wheelOpts, positions, { camberDeg = 0, y }) {
    const camber = THREE.MathUtils.degToRad(camberDeg);
    return positions.map(({ x, z }) => {
        const w = createWheel(wheelOpts);
        const pivot = new THREE.Group();
        pivot.position.set(x, y ?? w.radius, z);
        const side = Math.sign(z);
        // Face externa para fora do carro; topo inclinado para dentro (cambagem negativa).
        if (side < 0) w.group.rotation.y = Math.PI;
        pivot.rotation.x = side > 0 ? camber : -camber;
        pivot.add(w.group);
        root.add(pivot);
        return { pivot, spin: w.spin, radius: w.radius, side };
    });
}

/** Liner preto dentro da caixa de roda (esconde o "túnel" da extrusão), só acima da soleira. */
export function archLiner(x, cy, r, width, sillY) {
    // Depois de girar o cilindro 90° em X, a altura de um vértice é -r·cos(θ): o topo fica em θ = π.
    const start = Math.acos(THREE.MathUtils.clamp((cy - sillY) / r, -1, 1));
    const geo = new THREE.CylinderGeometry(r - 0.005, r - 0.005, width, 40, 1, true, start, Math.PI * 2 - start * 2);
    const m = new THREE.Mesh(geo, Mat.underbody());
    m.rotation.x = Math.PI / 2;
    m.position.set(x, cy, 0);
    return m;
}

/** Sombra de contato sob o carro (gradiente suave) para "assentar" o carro no chão. */
export function contactShadow(length, width) {
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(0,0,0,0.85)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }, { srgb: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(length * 1.12, width * 1.25),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.004;
    m.renderOrder = 1;
    return m;
}

export function enableShadows(root) {
    root.traverse(o => {
        if (!o.isMesh) return;
        const transparent = Array.isArray(o.material) ? o.material.some(m => m.transparent) : o.material.transparent;
        if (transparent) return;
        o.castShadow = true;
        o.receiveShadow = true;
    });
}

/**
 * Atalhos de encaixe por raycast para um modelo: front/back/side/top devolvem o ponto da superfície
 * já em coordenadas do grupo `body` (que está rebaixado `drop` metros); add() cola o objeto ali.
 * Chame root.updateMatrixWorld(true) antes de usar.
 */
export function createPlacer(body, targets, drop) {
    const cast = (o, d) => {
        const h = surfaceHit(targets, o, d);
        if (h) h.point.y += drop;
        return h;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const p = {
        front: (y, z) => cast(V(5, y - drop, z), V(-1, 0, 0)),
        back: (y, z) => cast(V(-5, y - drop, z), V(1, 0, 0)),
        side: (x, y, s) => cast(V(x, y - drop, 4 * s), V(0, 0, -s)),
        top: (x, z) => cast(V(x, 5, z), V(0, -1, 0)),
        add(obj, hit, offset = 0.004) {
            if (!hit) return obj;
            placeOnSurface(obj, hit, offset);
            body.add(obj);
            return obj;
        },
        /** Friso/vinco: tubo fino passando pelos pontos obtidos com hitAt(t), t de 0 a 1. */
        seam(hitAt, radius, material, samples = 16) {
            const pts = [];
            for (let i = 0; i <= samples; i++) {
                const h = hitAt(i / samples);
                if (h) pts.push(h.point.addScaledVector(h.normal, radius * 0.4));
            }
            if (pts.length > 2) body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), samples * 3, radius, 6), material));
        }
    };
    return p;
}

/**
 * Faixas e grafismos pintados direto no shader, em coordenadas do carro (sem UV):
 * stripes(pos, normal) devolve 0..1 de cobertura da segunda cor. Usado no Mustang do Navalha.
 */
export function addPaintGraphics(material, color, glslMask) {
    material.onBeforeCompile = shader => {
        shader.uniforms.graphicColor = { value: new THREE.Color(color) };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;\nvarying vec3 vCarNormal;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;\nvCarNormal = normal;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform vec3 graphicColor;
varying vec3 vCarPos;
varying vec3 vCarNormal;
float graphicMask(vec3 p, vec3 n) { ${glslMask} }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
float gm = clamp(graphicMask(vCarPos, normalize(vCarNormal)), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, graphicColor, gm);`);
    };
    material.customProgramCacheKey = () => 'graphics:' + glslMask;
    return material;
}

/**
 * Arte colorida pintada no shader (ex.: labaredas): o GLSL define `vec4 paintArt(vec3 p, vec3 n)`
 * em coordenadas do carro e devolve cor (rgb) e cobertura (a). Mistura por cima da pintura base.
 */
export function addPaintArt(material, glsl) {
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;\nvarying vec3 vCarNormal;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;\nvCarNormal = normal;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
varying vec3 vCarPos;
varying vec3 vCarNormal;
${glsl}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
vec4 art = paintArt(vCarPos, normalize(vCarNormal));
diffuseColor.rgb = mix(diffuseColor.rgb, art.rgb, clamp(art.a, 0.0, 1.0));`);
    };
    material.customProgramCacheKey = () => 'art:' + glsl.length;
    return material;
}
