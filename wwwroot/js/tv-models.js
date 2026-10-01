import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function roundedRectShape(w, h, r, cx = 0, cy = 0) {
    const s = new THREE.Shape();
    const x = cx - w / 2, y = cy - h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
}

function roundedRectPath(w, h, r, cx = 0, cy = 0) {
    const p = new THREE.Path();
    const x = cx - w / 2, y = cy - h / 2;
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
    return p;
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

function drawLgLogo(ctx, x, y, r) {
    // Círculo vermelho com o "rosto" estilizado da LG.
    ctx.fillStyle = '#a50034';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.3, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = r * 0.13; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(x - r * 0.05, y - r * 0.55); ctx.lineTo(x - r * 0.05, y + r * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, Math.PI * 0.05, Math.PI * 0.95, false); ctx.stroke();
    ctx.fillStyle = '#5a5d63';
    ctx.font = 'bold ' + Math.round(r * 1.35) + 'px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('LG', x + r * 1.25, y + r * 0.08);
}

/** TV CRT LG "Flatron" prata, estilo início dos anos 2000. */
export function createLgTv() {
    const group = new THREE.Group();
    group.name = 'LG_TV';

    const W = 0.80, H = 0.66, frontDepth = 0.08;
    const screenW = 0.60, screenH = 0.45, screenY = 0.055;

    const silver = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.55, roughness: 0.38 });
    const darkGray = new THREE.MeshStandardMaterial({ color: 0x2d2f33, metalness: 0.3, roughness: 0.6 });
    const backPlastic = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.1, roughness: 0.75 });

    // Moldura frontal com recorte para a tela.
    const bezelShape = roundedRectShape(W, H, 0.05);
    bezelShape.holes.push(roundedRectPath(screenW + 0.02, screenH + 0.02, 0.03, 0, screenY));
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
        depth: frontDepth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 4, curveSegments: 12
    });
    bezelGeo.translate(0, 0, -frontDepth);
    const bezel = new THREE.Mesh(bezelGeo, silver);
    bezel.castShadow = true;
    group.add(bezel);

    // Moldura interna escura ao redor do vidro.
    const innerShape = roundedRectShape(screenW + 0.05, screenH + 0.05, 0.035, 0, screenY);
    innerShape.holes.push(roundedRectPath(screenW, screenH, 0.025, 0, screenY));
    const inner = new THREE.Mesh(new THREE.ExtrudeGeometry(innerShape, { depth: 0.02, bevelEnabled: false }), darkGray);
    inner.position.z = -0.012;
    group.add(inner);

    // Tubo traseiro (caixa afunilada).
    const tubeDepth = 0.5;
    const tubeGeo = new THREE.BoxGeometry(W * 0.94, H * 0.94, tubeDepth);
    const pos = tubeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) < 0) {
            pos.setX(i, pos.getX(i) * 0.55);
            pos.setY(i, pos.getY(i) * 0.6 + 0.03);
        }
    }
    tubeGeo.computeVertexNormals();
    tubeGeo.translate(0, 0, -frontDepth - tubeDepth / 2 + 0.01);
    const tube = new THREE.Mesh(tubeGeo, backPlastic);
    tube.castShadow = true;
    group.add(tube);

    // Tela curva (plano subdividido com abaulamento).
    const screenGeo = new THREE.PlaneGeometry(screenW, screenH, 48, 36);
    const sp = screenGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
        const nx = sp.getX(i) / (screenW / 2), ny = sp.getY(i) / (screenH / 2);
        sp.setZ(i, 0.018 * (1 - nx * nx) * (1 - ny * ny));
    }
    screenGeo.computeVertexNormals();
    const screen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ color: 0x080808 }));
    screen.position.set(0, screenY, -0.02);
    screen.name = 'screen';
    group.add(screen);

    // Reflexo do vidro.
    const glass = new THREE.Mesh(screenGeo.clone(), new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false
    }));
    glass.position.set(0, screenY, -0.017);
    glass.renderOrder = 2;
    group.add(glass);

    // Faixa inferior: logo LG, FLATRON, grade de alto-falante.
    const bottomH = (screenY - screenH / 2) - (-H / 2) - 0.025;
    const panelTex = canvasTexture(1024, 128, (ctx, w, h) => {
        ctx.fillStyle = '#b9bcc2'; ctx.fillRect(0, 0, w, h);
        drawLgLogo(ctx, 70, h / 2, 30);
        ctx.fillStyle = '#4a4d52';
        ctx.font = 'italic bold 34px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('FLATRON', w / 2, h / 2 - 8);
        ctx.font = '15px Arial'; ctx.fillStyle = '#5e6166';
        ctx.fillText('ULTRA SLIM  •  STEREO', w / 2, h / 2 + 26);
        ctx.fillStyle = '#7d8086';
        for (let gx = 0; gx < 9; gx++) for (let gy = 0; gy < 4; gy++) {
            ctx.beginPath(); ctx.arc(250 + gx * 14, 34 + gy * 18, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(650 + gx * 14, 34 + gy * 18, 4, 0, Math.PI * 2); ctx.fill();
        }
    });
    const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(W - 0.08, bottomH),
        new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.4, roughness: 0.45 }));
    panel.position.set(0, -H / 2 + bottomH / 2 + 0.012, 0.0125);
    group.add(panel);

    // Botões frontais e LED.
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x8d9096, metalness: 0.6, roughness: 0.35 });
    const powerButton = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 24), btnMat);
    powerButton.rotation.x = Math.PI / 2;
    powerButton.position.set(W / 2 - 0.07, -H / 2 + 0.05, 0.016);
    powerButton.name = 'tvPower';
    group.add(powerButton);
    for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.006), btnMat);
        b.position.set(W / 2 - 0.25 + i * 0.03, -H / 2 + 0.05, 0.015);
        group.add(b);
    }
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 12), ledMat);
    led.position.set(W / 2 - 0.105, -H / 2 + 0.05, 0.016);
    group.add(led);

    // Pé.
    const foot = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.03, 0.4, 3, 0.01), darkGray);
    foot.position.set(0, -H / 2 - 0.015, -0.2);
    foot.castShadow = true; foot.receiveShadow = true;
    group.add(foot);

    return {
        group, screen, powerButton,
        screenSize: { w: screenW, h: screenH },
        bottomOffset: H / 2 + 0.03,
        setLed(on) {
            ledMat.emissive.set(on ? 0x22ff44 : 0xff1a1a);
            ledMat.emissiveIntensity = on ? 1.4 : 0.6;
        }
    };
}

/** PlayStation 1 (modelo SCPH) cinza. */
export function createPlayStation() {
    const group = new THREE.Group();
    group.name = 'PS1';

    const W = 0.27, H = 0.055, D = 0.19;
    const gray = new THREE.MeshStandardMaterial({ color: 0xc4c4be, roughness: 0.62, metalness: 0.05 });
    const darker = new THREE.MeshStandardMaterial({ color: 0xa6a6a0, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });

    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.01), gray);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);

    // Rebaixo traseiro.
    const back = new THREE.Mesh(new RoundedBoxGeometry(W * 0.98, H * 0.25, D * 0.25, 2, 0.005), darker);
    back.position.set(0, H / 2, -D * 0.36);
    group.add(back);

    // Tampa do disco (gira ao carregar o jogo).
    const lid = new THREE.Group();
    lid.position.set(-0.035, H / 2 + 0.003, 0.0);
    group.add(lid);
    const lidDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.07, 0.008, 64), gray);
    lidDisc.castShadow = true;
    lid.add(lidDisc);
    const lidRing = new THREE.Mesh(new THREE.TorusGeometry(0.069, 0.0018, 8, 64), darker);
    lidRing.rotation.x = Math.PI / 2;
    lid.add(lidRing);

    const logoTex = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        drawPsLogo(ctx, w / 2, h / 2, 70);
    });
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.5 }));
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(0, 0.0045, 0);
    lid.add(logo);

    // Botões no topo: OPEN (grande), POWER e RESET.
    const openBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 32), darker);
    openBtn.position.set(0.075, H / 2 + 0.002, -0.025);
    group.add(openBtn);
    const powerBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 24), darker);
    powerBtn.position.set(0.105, H / 2 + 0.002, 0.04);
    powerBtn.name = 'psPower';
    group.add(powerBtn);
    const resetBtn = powerBtn.clone();
    resetBtn.position.set(0.075, H / 2 + 0.002, 0.04);
    group.add(resetBtn);

    const ledMat = new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x00ff33, emissiveIntensity: 0 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.003, 10, 10), ledMat);
    led.position.set(0.122, H / 2 + 0.001, 0.04);
    group.add(led);

    // Portas de controle e memory card na frente.
    for (const x of [-0.07, 0.07]) {
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 0.004), black);
        port.position.set(x, -0.006, D / 2 + 0.001);
        group.add(port);
        const mc = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.004), black);
        mc.position.set(x, 0.013, D / 2 + 0.001);
        group.add(mc);
    }

    return {
        group, lid, powerBtn, height: H,
        setLed(on) { ledMat.emissiveIntensity = on ? 1.6 : 0; }
    };
}

/** Logo "PS" estilizado desenhado em canvas (sem assets proprietários). */
export function drawPsLogo(ctx, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    const colors = ['#f8b500', '#00a650', '#0076c0'];
    colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(s * (-0.35 + i * 0.38), s * (0.42 - i * 0.04), s * 0.3, s * 0.08, -0.12, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = '#e60012';
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, s * 0.5);
    ctx.lineTo(-s * 0.3, -s * 0.75);
    ctx.bezierCurveTo(s * 0.55, -s * 0.72, s * 0.55, -s * 0.05, -s * 0.06, -s * 0.08);
    ctx.lineTo(-s * 0.06, s * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}
