import * as THREE from 'three';

// Material da tela CRT: curvatura, scanlines, ruído e animação de ligar/desligar.
export function createCrtMaterial(texture) {
    return new THREE.ShaderMaterial({
        uniforms: {
            map: { value: texture },
            power: { value: 0 },      // 0 = desligada, 1 = ligada (anima a linha que se expande)
            time: { value: 0 },
            noise: { value: 0 },      // 0..1 estática
            brightness: { value: 1 }
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform sampler2D map;
            uniform float power;
            uniform float time;
            uniform float noise;
            uniform float brightness;
            varying vec2 vUv;

            float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

            vec2 curve(vec2 uv) {
                uv = uv * 2.0 - 1.0;
                vec2 off = abs(uv.yx) / vec2(6.0, 5.0);
                uv = uv + uv * off * off;
                return uv * 0.5 + 0.5;
            }

            void main() {
                vec2 uv = curve(vUv);
                vec3 glass = vec3(0.035, 0.04, 0.038);

                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(glass * 0.5, 1.0);
                    return;
                }

                // Animação de ligar: ponto -> linha horizontal -> imagem cheia.
                float lineH = smoothstep(0.0, 0.35, power);   // largura da linha
                float openV = smoothstep(0.35, 1.0, power);   // abertura vertical
                float dy = abs(uv.y - 0.5);
                float dx = abs(uv.x - 0.5);
                float visible = step(dx, 0.5 * lineH) * step(dy, max(0.004, 0.5 * openV));
                float flash = (1.0 - openV) * step(0.01, power) * 2.0;

                // Pequena distorção de sincronia.
                float wobble = sin(uv.y * 240.0 + time * 9.0) * 0.0007;
                vec3 col = texture2D(map, vec2(uv.x + wobble, uv.y)).rgb;

                // Estática.
                float n = rand(uv * vec2(640.0, 480.0) + fract(time * 13.7));
                col = mix(col, vec3(n), noise);

                // Scanlines e máscara de abertura.
                float scan = 0.82 + 0.18 * sin(uv.y * 480.0 * 3.14159);
                float mask = 0.92 + 0.08 * sin(uv.x * 640.0 * 3.14159 * 0.66);
                col *= scan * mask * brightness;

                // Vinheta.
                vec2 v = uv * (1.0 - uv.yx);
                col *= clamp(pow(v.x * v.y * 18.0, 0.25), 0.0, 1.0);

                col = col + vec3(flash);
                col = mix(glass, col, visible);
                gl_FragColor = vec4(col * 1.25, 1.0);
                #include <colorspace_fragment>
            }`
    });
}
