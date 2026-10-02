// BMW Série 3 Touring (F31) M Sport, Alpine White, versão stance (rebaixada, cambada, rodas de tala funda).
// Medidas reais: 4,62 m de comprimento, 1,81 m de largura, entre-eixos 2,81 m. Frente em +X, lado direito em +Z.
import * as THREE from 'three';
import {
    Mat, paintMaterial, lightMaterial, canvasTexture, plateTexture, lowerBodyShape, splineShape, extrudeProfile,
    deform, splitGeometry, profileCanvas, surfaceHit, placeOnSurface, roundedPanel, roundedBox, mountWheels,
    archLiner, contactShadow, enableShadows
} from './car-kit.js';

const L = { front: 2.31, rear: -2.31, frontAxle: 1.49, rearAxle: -1.32, width: 1.81, sill: 0.215, archR: 0.372, wheelCy: 0.33 };

export function createBmwF31(visual = {}) {
    const stance = { rideDrop: 0.075, camberDeg: -6.5, wheelInset: 0, ...(visual.stance ?? {}) };
    const paintColor = new THREE.Color(visual.paint ?? '#eef0f2');

    const root = new THREE.Group();
    root.name = 'BMW_F31';
    const body = new THREE.Group();
    body.position.y = -stance.rideDrop;
    root.add(body);

    const paint = paintMaterial(paintColor);
    const sidePaint = paintMaterial(paintColor, { map: bodySideTexture() });

    // ---------- Carroceria inferior ----------
    const shape = lowerBodyShape({
        top: [
            [2.2, 0.15], [2.29, 0.27], [2.315, 0.42], [2.305, 0.56], [2.27, 0.665], [2.2, 0.745], [2.08, 0.79],
            [1.8, 0.83], [1.35, 0.875], [0.92, 0.915], [0.6, 0.94], [0.0, 0.96], [-0.8, 0.98], [-1.6, 0.995],
            [-2.0, 0.99], [-2.2, 0.965], [-2.27, 0.88], [-2.3, 0.72], [-2.31, 0.58], [-2.31, 0.42], [-2.28, 0.3], [-2.2, 0.24]
        ],
        rearBottom: [[-1.85, L.sill]],
        sillY: L.sill,
        arches: [{ x: L.rearAxle, cy: L.wheelCy, r: L.archR }, { x: L.frontAxle, cy: L.wheelCy, r: L.archR }],
        frontBottom: [[1.98, L.sill], [2.12, 0.16]]
    });
    let lowerGeo = extrudeProfile(shape, L.width, { bevel: 0.07, bevelSeg: 6, steps: 14, curveSeg: 6 });
    const hw = L.width / 2;
    lowerGeo = deform(lowerGeo, v => {
        let f = 1;
        if (v.x > 1.72) f -= 0.11 * ((v.x - 1.72) / 0.6) ** 2;            // bico arredondado em planta
        if (v.x < -1.85) f -= 0.08 * ((-1.85 - v.x) / 0.46) ** 2;         // traseira
        if (v.y > 0.78) f *= 1 - 0.07 * ((v.y - 0.78) / 0.22) ** 2;        // ombro caindo para dentro
        f *= 1 + 0.009 * Math.max(0, 1 - Math.abs(v.y - 0.855) / 0.05);  // vinco lateral (linha de cintura)
        if (v.y < 0.3) f *= 1 - 0.035 * ((0.3 - v.y) / 0.15);             // saia recolhida embaixo
        v.z *= f;
        const zz = (v.z / hw) ** 2;
        v.x -= 0.12 * zz * THREE.MathUtils.smoothstep(v.x, 1.6, 2.3);     // frente curva em planta
        v.x += 0.07 * zz * THREE.MathUtils.smoothstep(-v.x, 1.8, 2.3);    // traseira curva em planta
        if (v.y > 0.7 && v.x > 0.9 && v.x < 2.15)                         // capô com leve abaulado
            v.y += 0.018 * Math.max(0, 1 - (v.z / 0.62) ** 2) * THREE.MathUtils.smoothstep(v.y, 0.7, 0.85);
    });
    const lower = new THREE.Mesh(lowerGeo, [sidePaint, paint]);
    body.add(lower);

    // ---------- Cabine (vidros, teto, colunas) ----------
    const ghShape = splineShape(
        [[0.98, 0.9], [0.86, 0.95], [0.45, 1.16], [0.05, 1.355], [-0.3, 1.415], [-1.0, 1.43], [-1.7, 1.41],
         [-2.02, 1.38], [-2.15, 1.3], [-2.21, 1.1], [-2.23, 0.93]],
        [[-2.2, 0.88], [0.98, 0.86]]
    );
    let ghGeo = extrudeProfile(ghShape, 1.6, { bevel: 0.075, bevelSeg: 6, steps: 12, curveSeg: 8 });
    ghGeo = deform(ghGeo, v => {
        const t = THREE.MathUtils.clamp((v.y - 0.95) / 0.48, 0, 1);
        let f = 1 - 0.2 * t;                                          // tumblehome
        if (v.x > 0.4) f *= 1 - 0.05 * Math.min(1, (v.x - 0.4) / 0.6);
        if (v.x < -1.95) f *= 1 - 0.07 * Math.min(1, (-1.95 - v.x) / 0.3);
        v.z *= f;
        v.x -= 0.06 * (v.z / 0.8) ** 2 * THREE.MathUtils.smoothstep(v.x, -0.1, 0.6);   // para-brisa curvo
        if (v.y > 1.3) v.y += 0.02 * Math.max(0, 1 - (v.z / 0.66) ** 2);             // teto abaulado
    }, 32);

    const ghParts = splitGeometry(ghGeo, (n, c, group) => {
        if (group === 0) return 'side';
        if (n.y > 0.8 && c.x < 0.02 && c.x > -2.06) return Math.abs(c.z) > 0.6 ? 'trim' : 'roof';
        if (Math.abs(n.z) > 0.5) return 'trim';
        return 'glass';
    });
    const sideMat = sideWindowMaterial(ghShape);
    const ghMats = { side: sideMat, roof: paint, trim: Mat.gloss(), glass: Mat.glass() };
    for (const [key, geo] of ghParts) body.add(new THREE.Mesh(geo, ghMats[key]));

    // Necessário para o raycast das peças.
    root.updateMatrixWorld(true);
    const targets = [lower];
    const front = (y, z) => surfaceHit(targets, new THREE.Vector3(3, y, z), new THREE.Vector3(-1, 0, 0));
    const back = (y, z) => surfaceHit(targets, new THREE.Vector3(-3, y, z), new THREE.Vector3(1, 0, 0));
    const side = (x, y, s) => surfaceHit(targets, new THREE.Vector3(x, y, 3 * s), new THREE.Vector3(0, 0, -s));
    const add = (obj, hit, off) => { placeOnSurface(obj, hit, off); obj.position.y -= 0; body.add(obj); return obj; };
    // As batidas foram feitas com o corpo já rebaixado; compensa para posicionar em coordenadas do "body".
    const fix = hit => hit && (hit.point.y += stance.rideDrop, hit);

    // ---------- Frente ----------
    const kidneyTex = slatTexture();
    for (const s of [-1, 1]) {
        const hit = fix(front(0.655 - stance.rideDrop, 0.122 * s));
        const g = new THREE.Group();
        const frame = roundedPanel(0.2, 0.13, 0.045, Mat.gloss(), 0.03);
        const slats = roundedPanel(0.175, 0.105, 0.035, new THREE.MeshStandardMaterial({ map: kidneyTex, roughness: 0.35, metalness: 0.2 }), 0.01);
        slats.position.z = 0.012;
        g.add(frame, slats);
        g.rotation.z = 0;
        add(g, hit, 0.004);
    }

    const headMat = lightMaterial(0xdfe9ff, 0.4);
    const angelMat = lightMaterial(0xd8e6ff, 3.2);
    for (const s of [-1, 1]) {
        const hit = fix(front(0.668 - stance.rideDrop, 0.6 * s));
        add(headlight(headMat, angelMat, s), hit, 0.006);
    }

    // Para-choque M Sport: entrada central, laterais com farol de neblina, placa e lábio.
    const honey = honeycombTexture();
    const intakeMat = new THREE.MeshStandardMaterial({ map: honey, roughness: 0.55, metalness: 0.1 });
    add(trapezoidPanel(0.7, 0.62, 0.15, intakeMat), fix(front(0.345 - stance.rideDrop, 0)), 0.003);
    for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.add(roundedPanel(0.24, 0.1, 0.03, intakeMat, 0.01));
        const fog = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), lightMaterial(0xfff4e0, 0.6));
        fog.position.set(-0.05 * s, 0, 0.008);
        g.add(fog);
        add(g, fix(front(0.33 - stance.rideDrop, 0.67 * s)), 0.004);
    }
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(visual.plate ?? 'STANCE'), roughness: 0.4 });
    add(roundedPanel(0.46, 0.115, 0.01, plateMat, 0.006), fix(front(0.48 - stance.rideDrop, 0)), 0.004);
    const roundel = new THREE.Mesh(new THREE.CircleGeometry(0.04, 32), new THREE.MeshStandardMaterial({ map: roundelTexture(), roughness: 0.3, metalness: 0.3 }));
    add(roundel, fix(front(0.755 - stance.rideDrop, 0)), 0.004);
    const lip = roundedBox(0.09, 0.02, 1.3, 0.008, Mat.gloss());
    lip.position.set(2.13, 0.155, 0);
    body.add(lip);

    // ---------- Traseira ----------
    const tailLens = new THREE.MeshPhysicalMaterial({ color: 0x5a0606, roughness: 0.08, clearcoat: 1, transmission: 0, metalness: 0.1 });
    const tailLed = lightMaterial(0xff1a12, 1.4);
    for (const s of [-1, 1]) {
        add(taillight(tailLens, tailLed, s), fix(back(0.885 - stance.rideDrop, 0.63 * s)), 0.004);
        const wrap = roundedPanel(0.16, 0.1, 0.03, tailLens, 0.015);
        const led = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.012), tailLed);
        led.position.z = 0.003;
        wrap.add(led);
        add(wrap, fix(side(-2.15, 0.885 - stance.rideDrop, s)), 0.003);
    }
    add(roundedPanel(0.46, 0.115, 0.01, plateMat, 0.006), fix(back(0.74 - stance.rideDrop, 0)), 0.004);
    add(roundel.clone(), fix(back(0.86 - stance.rideDrop, 0)), 0.004);
    const diffuser = trapezoidPanel(1.25, 1.1, 0.11, Mat.plastic());
    add(diffuser, fix(back(0.27 - stance.rideDrop, 0)), 0.004);
    for (const s of [-1, 1]) {
        const refl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.022), lightMaterial(0x8a0d0d, 0.3));
        add(refl, fix(back(0.43 - stance.rideDrop, 0.7 * s)), 0.003);
    }
    // Vincos da traseira: topo do para-choque e base da tampa.
    const seam = (y, zMax, r, mat) => {
        const pts = [];
        for (let z = -zMax; z <= zMax + 1e-6; z += zMax / 8) {
            const h = fix(back(y - stance.rideDrop, z));
            if (h) pts.push(h.point.addScaledVector(h.normal, 0.002));
        }
        if (pts.length > 2) body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 6), mat));
    };
    seam(0.585, 0.86, 0.006, Mat.plastic());
    seam(0.36, 0.8, 0.004, Mat.plastic());

    const exhausts = [];
    for (const s of [-1, 1]) {
        const hit = fix(back(0.27 - stance.rideDrop, 0.52 * s));
        const tip = new THREE.Group();
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 28, 1, true), Mat.chrome());
        pipe.material = Mat.chrome();
        pipe.rotation.z = Math.PI / 2;
        const inner = new THREE.Mesh(new THREE.CircleGeometry(0.042, 24), new THREE.MeshBasicMaterial({ color: 0x050505 }));
        inner.rotation.y = -Math.PI / 2;
        inner.position.x = 0.02;
        tip.add(pipe, inner);
        const x = hit ? hit.point.x : -2.27;
        tip.position.set(x - 0.02, 0.27, 0.52 * s);
        body.add(tip);
        exhausts.push(new THREE.Vector3(x - 0.09, 0.27, 0.52 * s));
    }

    // ---------- Teto: rack preto, aerofólio, antena ----------
    const top = (x, z) => surfaceHit(body.children.filter(o => o.isMesh), new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
    root.updateMatrixWorld(true);
    for (const s of [-1, 1]) {
        const pts = [];
        for (const x of [0.02, -0.4, -1.0, -1.6, -1.98]) {
            const h = top(x, 0.56 * s);
            if (h) pts.push(new THREE.Vector3(x, h.point.y + stance.rideDrop + 0.03, 0.56 * s));
        }
        if (pts.length > 1) {
            const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.013, 8), Mat.gloss());
            body.add(rail);
        }
    }
    const spoilerHit = top(-2.03, 0);
    if (spoilerHit) {
        const spoiler = roundedBox(0.18, 0.025, 1.08, 0.012, paint);
        spoiler.position.set(-2.09, spoilerHit.point.y + stance.rideDrop - 0.012, 0);
        spoiler.rotation.z = 0.12;
        body.add(spoiler);
        const brake3 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.32), tailLed);
        brake3.position.set(-2.18, spoilerHit.point.y + stance.rideDrop - 0.005, 0);
        body.add(brake3);
    }
    const finHit = top(-1.82, 0);
    if (finHit) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 3), Mat.gloss());
        fin.scale.set(2.4, 1, 0.6);
        fin.rotation.z = 0.5;
        fin.position.set(-1.82, finHit.point.y + stance.rideDrop + 0.03, 0);
        body.add(fin);
    }

    // ---------- Laterais: retrovisores e maçanetas ----------
    for (const s of [-1, 1]) {
        const hit = fix(side(0.66, 0.985 - stance.rideDrop, s));
        if (hit) {
            const mirror = new THREE.Group();
            const housing = roundedBox(0.11, 0.105, 0.19, 0.04, paint);
            housing.position.set(0, 0.06, 0.13 * s);
            const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.08), Mat.chrome());
            glass.rotation.y = -Math.PI / 2;
            glass.position.set(-0.056, 0.06, 0.13 * s);
            const arm = roundedBox(0.09, 0.04, 0.09, 0.015, Mat.gloss());
            arm.position.set(0, 0.015, 0.04 * s);
            mirror.add(housing, glass, arm);
            mirror.position.copy(hit.point);
            body.add(mirror);
        }
        for (const x of [0.06, -0.92]) {
            const h = fix(side(x, 0.885 - stance.rideDrop, s));
            if (!h) continue;
            const handle = roundedBox(0.16, 0.032, 0.03, 0.012, paint);
            handle.position.copy(h.point).addScaledVector(h.normal, 0.008);
            body.add(handle);
        }
    }

    // ---------- Rodas ----------
    for (const x of [L.frontAxle, L.rearAxle]) body.add(archLiner(x, L.wheelCy, L.archR, 1.56, L.sill));
    const track = 0.79 - stance.wheelInset;
    const wheels = mountWheels(root, {
        tireR: 0.322, tireW: 0.2, rimR: 0.241, rimW: 0.245, beadW: 0.25, spokeStyle: 'split', spokes: 10, dish: 0.05,
        caliperColor: 0x1f4fbf
    }, [
        { x: L.frontAxle, z: track }, { x: L.frontAxle, z: -track },
        { x: L.rearAxle, z: track + 0.01 }, { x: L.rearAxle, z: -track - 0.01 }
    ], { camberDeg: stance.camberDeg });

    root.add(contactShadow(4.62, 1.81));
    enableShadows(root);

    return {
        root, body, wheels, exhausts,
        length: 4.62, width: 1.81, height: 1.45 - stance.rideDrop, wheelbase: L.frontAxle - L.rearAxle,
        brakeLights: [tailLed],
        headLights: [angelMat, headMat],
        frontAxle: L.frontAxle, rearAxle: L.rearAxle
    };
}

// ---------- Peças ----------

function headlight(headMat, angelMat, side) {
    const m = (side < 0 ? -1 : 1) * 1.3;   // espelha e alarga
    const P = (x, y) => [x * m, y * 1.15];
    // Farol alongado afinando para o lado da grade. Na frente, +X local aponta para -Z do carro,
    // então a ponta externa (-X local) cai no lado direito; o lado esquerdo é espelhado.
    const g = new THREE.Group();
    const s = new THREE.Shape();
    const q = (a, b, c, d) => s.quadraticCurveTo(...P(a, b), ...P(c, d));
    s.moveTo(...P(-0.2, -0.065)); s.lineTo(...P(0.18, -0.03)); q(0.21, -0.02, 0.2, 0.01);
    s.lineTo(...P(0.16, 0.05)); q(0.15, 0.07, 0.12, 0.07); s.lineTo(...P(-0.17, 0.075));
    q(-0.215, 0.075, -0.215, 0.04); s.lineTo(...P(-0.215, -0.04)); q(-0.215, -0.068, -0.2, -0.065);
    const housingGeo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3 });
    housingGeo.translate(0, 0, -0.03);
    g.add(new THREE.Mesh(housingGeo, Mat.darkChrome()));
    // Dois anéis "angel eyes" com projetores.
    for (const x of [-0.115, 0.0]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.0045, 8, 40), angelMat);
        ring.position.set(x * m, 0.0, 0.004);
        const proj = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), Mat.chrome());
        proj.rotation.x = Math.PI / 2;
        proj.position.set(x * m, 0, -0.006);
        const lensDot = new THREE.Mesh(new THREE.CircleGeometry(0.016, 20), headMat);
        lensDot.position.set(x * m, 0, 0.0205);
        g.add(ring, proj, lensDot);
    }
    // Sobrancelha de LED.
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.24 * 1.3, 0.008, 0.006), angelMat);
    brow.position.set(-0.06 * m, 0.066, 0.002);
    brow.rotation.z = -0.03 * Math.sign(m);
    g.add(brow);
    const lens = new THREE.Mesh(new THREE.ShapeGeometry(s), Mat.lens());
    lens.position.z = 0.012;
    g.add(lens);
    return g;
}

function taillight(lensMat, ledMat, side) {
    const m = side < 0 ? -1 : 1;
    const P = (x, y) => [x * m, y];
    // Lanterna em "L" (F30/F31), parte externa mais alta em +X local. Na traseira, +X local = +Z do carro
    // (lado direito); o lado esquerdo é espelhado.
    const g = new THREE.Group();
    const s = new THREE.Shape();
    const q = (a, b, c, d) => s.quadraticCurveTo(...P(a, b), ...P(c, d));
    s.moveTo(...P(-0.17, -0.04)); s.lineTo(...P(0.17, -0.06)); q(0.19, -0.06, 0.19, -0.03);
    s.lineTo(...P(0.19, 0.055)); q(0.19, 0.07, 0.17, 0.07); s.lineTo(...P(-0.15, 0.045));
    q(-0.17, 0.043, -0.17, 0.02); s.lineTo(...P(-0.17, -0.04));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3 });
    geo.translate(0, 0, -0.02);
    g.add(new THREE.Mesh(geo, lensMat));
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.004), ledMat);
    bar1.position.set(0.0, 0.02, 0.008);
    bar1.rotation.z = 0.06 * m;
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.004), ledMat);
    bar2.position.set(0.15 * m, 0.0, 0.008);
    const bar3 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.004), ledMat);
    bar3.position.set(-0.01 * m, -0.03, 0.008);
    bar3.rotation.z = 0.06 * m;
    g.add(bar1, bar2, bar3);
    return g;
}

function trapezoidPanel(wTop, wBottom, h, material) {
    const s = new THREE.Shape();
    const r = 0.03;
    s.moveTo(-wBottom / 2 + r, -h / 2);
    s.lineTo(wBottom / 2 - r, -h / 2); s.quadraticCurveTo(wBottom / 2, -h / 2, wBottom / 2, -h / 2 + r);
    s.lineTo(wTop / 2, h / 2 - r); s.quadraticCurveTo(wTop / 2, h / 2, wTop / 2 - r, h / 2);
    s.lineTo(-wTop / 2 + r, h / 2); s.quadraticCurveTo(-wTop / 2, h / 2, -wTop / 2, h / 2 - r);
    s.lineTo(-wBottom / 2, -h / 2 + r); s.quadraticCurveTo(-wBottom / 2, -h / 2, -wBottom / 2 + r, -h / 2);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
    geo.translate(0, 0, -0.01);
    // UV de ShapeGeometry = coordenadas em metros; normaliza para a textura cobrir o painel.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
    return new THREE.Mesh(geo, material);
}

// ---------- Texturas ----------

function bodySideTexture() {
    // Linhas de porta, sombra da soleira e escurecimento em volta das caixas de roda, em coordenadas do perfil.
    return profileCanvas([-2.45, 0.1, 2.45, 1.05], 520, (ctx, X, Y, S, w, h) => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);

        const shade = (x, y, r, a) => {
            const g = ctx.createRadialGradient(X(x), Y(y), r * S * 0.9, X(x), Y(y), r * S * 1.18);
            g.addColorStop(0, `rgba(0,0,0,${a})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        };
        shade(L.frontAxle, L.wheelCy, L.archR, 0.35);
        shade(L.rearAxle, L.wheelCy, L.archR, 0.35);
        const sill = ctx.createLinearGradient(0, Y(0.2), 0, Y(0.34));
        sill.addColorStop(0, 'rgba(0,0,0,0.45)');
        sill.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sill;
        ctx.fillRect(0, Y(0.34), w, Y(0.2) - Y(0.34));

        ctx.strokeStyle = 'rgba(40,40,40,0.9)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const line = pts => {
            ctx.beginPath();
            ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
            for (const [x, y] of pts.slice(1)) ctx.lineTo(X(x), Y(y));
            ctx.stroke();
        };
        line([[0.8, 0.96], [0.82, 0.62], [0.86, 0.4], [0.9, 0.31]]);               // para-lama / porta dianteira
        line([[-0.33, 0.985], [-0.33, 0.3]]);                                     // entre portas
        ctx.beginPath();                                                           // traseira da porta contornando a roda
        ctx.moveTo(X(-1.3), Y(0.99));
        ctx.lineTo(X(-1.27), Y(0.76));
        ctx.quadraticCurveTo(X(-1.2), Y(0.62), X(-0.93), Y(0.5));
        ctx.lineTo(X(-0.9), Y(0.31));
        ctx.stroke();
        line([[0.9, 0.31], [-0.9, 0.3]]);                                          // base das portas
        line([[-2.24, 0.62], [-2.05, 0.6], [-1.75, 0.6]]);                         // tampa traseira / para-choque
        line([[2.22, 0.7], [1.95, 0.73]]);                                         // para-choque dianteiro

        // Emblema M no para-lama dianteiro.
        const bx = X(1.0), by = Y(0.6);
        [['#1c69d4', 0], ['#2b2d82', 1], ['#e22718', 2]].forEach(([c, i]) => {
            ctx.fillStyle = c;
            ctx.fillRect(bx + i * 7, by - 8, 6, 16);
        });
    });
}

function sideWindowMaterial(ghShape) {
    const outline = ghShape.getPoints(24);
    const bounds = [-2.32, 0.82, 1.06, 1.5];
    const draw = (glassFront, glassRear, trim) => (ctx, X, Y, S, w, h) => {
        ctx.fillStyle = trim;
        ctx.fillRect(0, 0, w, h);
        // Vidro = contorno da cabine recuado 4,5 cm (o traço grosso cobre a borda).
        ctx.save();
        ctx.beginPath();
        outline.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.closePath();
        ctx.clip();
        const grad = ctx.createLinearGradient(X(0.9), 0, X(-2.2), 0);
        grad.addColorStop(0, glassFront);
        grad.addColorStop(0.35, glassFront);
        grad.addColorStop(0.42, glassRear);
        grad.addColorStop(1, glassRear);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 0.09 * S;
        ctx.strokeStyle = trim;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = trim;
        ctx.fillRect(0, Y(0.985), w, h);                                          // abaixo da linha da janela
        ctx.fillRect(X(-0.37), 0, 0.085 * S, h);                                  // coluna B
        ctx.beginPath();                                                           // coluna C com "Hofmeister kink"
        ctx.moveTo(X(-1.27), Y(0.98)); ctx.lineTo(X(-1.36), Y(0.98));
        ctx.lineTo(X(-1.42), Y(1.42)); ctx.lineTo(X(-1.33), Y(1.42)); ctx.closePath(); ctx.fill();
        ctx.fillRect(X(-2.32), 0, X(-2.02) - X(-2.32), h);                        // coluna D
        ctx.beginPath();                                                           // vigia do retrovisor
        ctx.moveTo(X(0.98), Y(0.9)); ctx.lineTo(X(0.6), Y(0.98)); ctx.lineTo(X(0.62), Y(1.06)); ctx.closePath(); ctx.fill();
    };
    const map = profileCanvas(bounds, 300, draw('#1d2731', '#090c10', '#060606'));
    const rough = profileCanvas(bounds, 300, draw('#0a0a0a', '#0a0a0a', '#4a4a4a'), { srgb: false });
    return new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map, roughness: 1, roughnessMap: rough, metalness: 0,
        clearcoat: 0.6, clearcoatRoughness: 0.04, envMapIntensity: 0.75
    });
}

function slatTexture() {
    return canvasTexture(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#020202';
        ctx.fillRect(0, 0, w, h);
        for (let x = 6; x < w; x += 16) {
            const g = ctx.createLinearGradient(x, 0, x + 10, 0);
            g.addColorStop(0, '#0b0b0b'); g.addColorStop(0.5, '#3a3a3a'); g.addColorStop(1, '#0b0b0b');
            ctx.fillStyle = g;
            ctx.fillRect(x, 0, 10, h);
        }
    });
}

function honeycombTexture() {
    const t = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#010101';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#262626';
        ctx.lineWidth = 3;
        const r = 12;
        for (let row = -1; row < h / (r * 1.5) + 1; row++) {
            for (let col = -1; col < w / (r * 1.732) + 1; col++) {
                const cx = col * r * 1.732 + (row % 2 ? r * 0.866 : 0), cy = row * r * 1.5;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = Math.PI / 6 + i * Math.PI / 3;
                    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
    }, { repeat: true });
    return t;
}

function roundelTexture() {
    return canvasTexture(128, 128, (ctx, w) => {
        const c = w / 2;
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(c, c, c - 3, 0, Math.PI * 2); ctx.stroke();
        const r = c * 0.58;
        [['#f5f5f5', 0], ['#1c69d4', 1], ['#f5f5f5', 2], ['#1c69d4', 3]].forEach(([col, i]) => {
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.moveTo(c, c);
            ctx.arc(c, c, r, -Math.PI / 2 + i * Math.PI / 2, i * Math.PI / 2);
            ctx.fill();
        });
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    });
}
