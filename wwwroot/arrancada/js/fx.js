// Pós-processamento (bloom, gradação de cor dourada estilo Most Wanted, borrão radial de velocidade,
// aberração cromática, vinheta, granulado, fade) e partículas (fumaça de pneu e chamas de escape).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { canvasTexture } from './cars/car-kit.js';

const GradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        speed: { value: 0 },
        fade: { value: 0 },
        flash: { value: 0 },
        aspect: { value: 1 },
        center: { value: new THREE.Vector2(0.5, 0.52) }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float time, speed, fade, flash, aspect;
        uniform vec2 center;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
            vec2 dir = vUv - center;
            float edge = smoothstep(0.08, 0.65, length(dir * vec2(aspect, 1.0)));
            float strength = speed * 0.06 * edge;
            vec3 col = vec3(0.0);
            for (int i = 0; i < 12; i++) {
                float t = float(i) / 11.0;
                col += texture2D(tDiffuse, vUv - dir * strength * t).rgb;
            }
            col /= 12.0;
            float ca = (0.0012 + speed * 0.003) * edge;
            col.r = mix(col.r, texture2D(tDiffuse, vUv + dir * ca).r, 0.7);
            col.b = mix(col.b, texture2D(tDiffuse, vUv - dir * ca).b, 0.7);

            // Gradação: levemente dessaturado, quente e com contraste em "S".
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l), col, 0.84);
            col *= vec3(1.07, 1.0, 0.84);
            col = mix(col, col * col * (3.0 - 2.0 * col), 0.32);
            col += vec3(0.018, 0.012, 0.004) * (1.0 - l);

            float v = smoothstep(1.05, 0.3, length(dir * vec2(aspect * 0.8, 1.0)));
            col *= mix(0.62, 1.0, v);
            col += (hash(vUv * 1000.0 + time) - 0.5) * 0.035;
            col = mix(col, vec3(1.0, 0.96, 0.9), flash);
            col *= 1.0 - fade;
            gl_FragColor = vec4(col, 1.0);
        }`
};

export class Effects {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        const size = renderer.getSize(new THREE.Vector2());
        const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
        this.composer = new EffectComposer(renderer, target);
        this.renderPass = new RenderPass(scene, camera);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 2.2);
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        this.composer.addPass(this.grade);
        this.u = this.grade.uniforms;
    }

    setCamera(camera) { this.renderPass.camera = camera; }

    setSize(w, h) {
        this.composer.setSize(w, h);
        this.u.aspect.value = w / h;
    }

    render(dt) {
        this.u.time.value += dt;
        this.u.flash.value = Math.max(0, this.u.flash.value - dt * 3);
        this.composer.render(dt);
    }
}

// ---------- Partículas ----------

const SmokeShader = {
    vertexShader: /* glsl */`
        attribute float size;
        attribute float alpha;
        attribute float spin;
        varying float vAlpha;
        varying float vSpin;
        uniform float pixelScale;
        #include <fog_pars_vertex>
        void main() {
            vSpin = spin;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            // Some perto da câmera para não virar uma parede branca na tela.
            vAlpha = alpha * smoothstep(1.5, 5.0, -mv.z);
            gl_PointSize = min(size * pixelScale / -mv.z, 420.0);
            gl_Position = projectionMatrix * mv;
            vec4 mvPosition = mv;
            #include <fog_vertex>
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D map;
        uniform vec3 color;
        varying float vAlpha;
        varying float vSpin;
        #include <fog_pars_fragment>
        void main() {
            vec2 c = gl_PointCoord - 0.5;
            float s = sin(vSpin), co = cos(vSpin);
            vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
            vec4 t = texture2D(map, r);
            float fall = smoothstep(0.5, 0.22, length(c));   // borda redonda (sem quadrado do sprite)
            gl_FragColor = vec4(color * (0.75 + 0.25 * t.r), t.a * vAlpha * fall);
            #include <fog_fragment>
        }`
};

export class SmokeSystem {
    constructor(scene, max = 600) {
        this.max = max;
        this.items = [];
        const geo = new THREE.BufferGeometry();
        this.pos = new Float32Array(max * 3);
        this.size = new Float32Array(max);
        this.alpha = new Float32Array(max);
        this.spin = new Float32Array(max);
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('spin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
        const map = canvasTexture(128, 128, (ctx, w) => {
            for (let i = 0; i < 14; i++) {
                const x = w / 2 + (Math.random() - 0.5) * 40, y = w / 2 + (Math.random() - 0.5) * 40;
                const g = ctx.createRadialGradient(x, y, 0, x, y, 30 + Math.random() * 24);
                g.addColorStop(0, 'rgba(255,255,255,0.35)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, w, w);
            }
        }, { srgb: false });
        this.material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
                map: { value: map }, color: { value: new THREE.Color(0xd8cfc4) }, pixelScale: { value: 600 }
            }]),
            vertexShader: SmokeShader.vertexShader,
            fragmentShader: SmokeShader.fragmentShader,
            transparent: true, depthWrite: false, fog: true
        });
        this.material.uniforms.map.value = map;
        this.points = new THREE.Points(geo, this.material);
        this.points.frustumCulled = false;
        scene.add(this.points);
    }

    setPixelScale(heightPx, fovDeg) {
        this.material.uniforms.pixelScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    }

    emit(p, vel, amount = 1) {
        if (this.items.length >= this.max) this.items.shift();
        this.items.push({
            x: p.x, y: p.y, z: p.z, vx: vel.x, vy: vel.y, vz: vel.z,
            life: 0, max: 1.4 + Math.random() * 1.4, size: 0.5 + Math.random() * 0.4, grow: 1.6 + Math.random() * 1.2,
            a: 0.32 * amount, spin: Math.random() * 6, spinV: (Math.random() - 0.5) * 1.5
        });
    }

    update(dt) {
        const keep = [];
        for (const s of this.items) {
            s.life += dt;
            if (s.life >= s.max) continue;
            s.vx *= 1 - dt * 1.6; s.vz *= 1 - dt * 1.2; s.vy = s.vy * (1 - dt) + dt * 0.5;
            s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
            s.size += s.grow * dt;
            s.spin += s.spinV * dt;
            keep.push(s);
        }
        this.items = keep;
        for (let i = 0; i < this.max; i++) {
            const s = this.items[i];
            if (!s) { this.alpha[i] = 0; this.size[i] = 0; continue; }
            this.pos.set([s.x, s.y, s.z], i * 3);
            this.size[i] = s.size;
            const k = s.life / s.max;
            this.alpha[i] = s.a * Math.min(1, s.life * 6) * (1 - k) * (1 - k);
            this.spin[i] = s.spin;
        }
        const g = this.points.geometry;
        g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = true;
        g.attributes.alpha.needsUpdate = g.attributes.spin.needsUpdate = true;
    }
}

/** Chama de escape (troca de marcha / corte de giro): cones aditivos que brilham no bloom. */
export class ExhaustFlames {
    constructor(parent, points) {
        this.flames = points.map(p => {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
            });
            const inner = new THREE.MeshBasicMaterial({
                color: 0x7fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
            });
            const g = new THREE.Group();
            const outer = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 12, 1, true), mat);
            outer.rotation.z = Math.PI / 2;
            outer.position.x = -0.22;
            const core = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 10, 1, true), inner);
            core.rotation.z = Math.PI / 2;
            core.position.x = -0.1;
            g.add(outer, core);
            g.position.copy(p);
            parent.add(g);
            return { g, mat, inner, t: 0 };
        });
        this.light = new THREE.PointLight(0xff7a2a, 0, 4, 2);
        if (points[0]) this.light.position.copy(points[0]).add(new THREE.Vector3(-0.3, 0, 0));
        parent.add(this.light);
        this.time = 0;
    }

    pop(power = 1) {
        for (const f of this.flames) f.t = Math.max(f.t, 0.14 + Math.random() * 0.12) * power;
    }

    update(dt) {
        this.time += dt;
        let max = 0;
        for (const f of this.flames) {
            f.t = Math.max(0, f.t - dt);
            const k = Math.min(1, f.t / 0.12) * (0.75 + 0.25 * Math.sin(this.time * 90));
            f.mat.opacity = k * 0.9;
            f.inner.opacity = k;
            f.g.scale.set(0.6 + k, 0.7 + k * 0.6, 0.7 + k * 0.6);
            max = Math.max(max, k);
        }
        this.light.intensity = max * 6;
    }
}
