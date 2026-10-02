// Configuração dos carros vindos do Blender: arquivo, regras de material (nome original → material do jogo)
// e grafismos. Créditos e licenças em wwwroot/arrancada/modelos/CREDITOS.txt.
//   Chaves de material: paint, glass, lens, tail, head, angel, alloy, darkAlloy, iron, caliper, rubber, tire,
//   reflector, amber, chrome, gloss, plastic, interior, keep (mantém o original).

// BMW M4 F82 — por CuRvEmAsTeR, Blend Swap #16463 (antigo #81957), CC-BY 3.0 (fan art, uso não comercial).
export const BMW_M4 = {
    url: '/arrancada/modelos/bmw-m4',
    rules: [
        [/^car_paint/, 'paint'],
        [/^glass$/, 'glass'],
        [/^chrome_red$/, 'tail'],
        [/^chrome/, 'chrome'],
        [/^tire_rubber$/, 'tire'],
        [/^rim_screw/, 'chrome'],
        [/^rim/, 'alloy'],
        [/^(tailights|rearlight_red)$/, 'tail'],
        [/^Reflectors$/, 'reflector'],
        [/^light_blue$/, 'angel'],
        [/^light$/, 'head'],
        [/^Miror$/, 'chrome'],
        [/^Piano_Black$/, 'gloss'],
        [/^(Black_mat|Solid_black)$/, 'plastic'],
        [/^Interior$/, 'interior'],
        [/^Material$/, 'lens'],
        [/^BMW(Black|Blue|Silver|White)$/, 'keep']
    ],
    caliperColor: 0x1f4fbf
};

// Labaredas estilo hot rod (referência: wwwroot/Imgs/mustangAdesivos.jpg): núcleo amarelo, laranja, vermelho
// e contorno magenta, nascendo no para-lama dianteiro e lambendo para trás; mais um par no capô.
// u = distância a partir da raiz da chama (para trás), v = desvio lateral/vertical da linha central.
const FLAMES_ART = `
float tongue(float u, float v, float len, float base, float amp, float freq, float phase, float w0) {
    if (u > len) return 99.0;
    if (u < -0.12) return 99.0;                                               // nada no bico do carro
    if (u < 0.0) return length(vec2(u * 1.4, v)) / (w0 * 1.55);           // raiz arredondada
    float t = u / len;
    float yc = base * smoothstep(0.0, 0.45, u) + amp * sin(t * freq + phase) * t;
    float w = 1.25 * w0 * pow(1.0 - t, 0.75) * (1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.3, u)));
    return abs(v - yc) / max(w, 1e-4);
}
float flameField(float u, float v, float s) {
    float d = 99.0;
    d = min(d, tongue(u, v, 3.3 * s, 0.0, 0.09 * s, 4.0, 0.0, 0.1 * s));
    d = min(d, tongue(u - 0.1 * s, v, 2.6 * s, 0.09 * s, 0.08 * s, 4.5, 1.4, 0.07 * s));
    d = min(d, tongue(u - 0.15 * s, v, 2.3 * s, -0.08 * s, 0.07 * s, 5.0, 2.4, 0.065 * s));
    d = min(d, tongue(u - 0.45 * s, v, 1.7 * s, 0.16 * s, 0.06 * s, 5.5, 0.6, 0.05 * s));
    d = min(d, tongue(u - 0.4 * s, v, 1.5 * s, -0.15 * s, 0.05 * s, 6.0, 3.0, 0.045 * s));
    d = min(d, tongue(u - 0.9 * s, v, 1.1 * s, 0.21 * s, 0.04 * s, 6.5, 1.9, 0.035 * s));
    return d;
}
vec4 flameColor(float d) {
    float e = 0.07;
    vec3 c = vec3(1.0, 0.86, 0.25);                                          // núcleo amarelo
    c = mix(c, vec3(1.0, 0.46, 0.04), smoothstep(0.42 - e, 0.42 + e, d));   // laranja
    c = mix(c, vec3(0.86, 0.05, 0.04), smoothstep(0.72 - e, 0.72 + e, d));  // vermelho
    c = mix(c, vec3(0.62, 0.0, 0.22), smoothstep(0.97 - e, 0.97 + e, d));   // contorno magenta
    float a = 1.0 - smoothstep(1.16 - e * 0.5, 1.16 + e * 0.5, d);
    return vec4(pow(c, vec3(2.2)), a);                                      // cor em espaço linear
}
vec4 paintArt(vec3 p, vec3 n) {
    // Laterais: raiz atrás do farol, sobre a caixa de roda dianteira, até o para-lama traseiro.
    float side = smoothstep(0.5, 0.7, abs(n.z));
    float u = 1.95 - p.x;
    vec4 a = flameColor(flameField(u, p.y - 0.66, 1.0));
    a.a *= side;
    // Capô: um grupo de chamas de cada lado, saindo da borda dianteira.
    float top = smoothstep(0.55, 0.75, n.y) * step(0.9, p.x) * step(0.8, p.y);   // só no capô (não no para-choque)
    vec4 b = flameColor(flameField(2.25 - p.x, abs(p.z) - 0.42, 0.42));
    b.a *= top;
    return b.a > a.a ? b : a;
}
`;

// Ford Mustang (S197) — "Ford Mustang" por jlrazr, Blend Swap #17034, CC-BY 3.0.
export const MUSTANG_S197 = {
    url: '/arrancada/modelos/mustang-s197',
    art: FLAMES_ART,
    rules: [
        [/^pintura_carro$/, 'paint'],
        [/^vidrios$/, 'glass'],
        [/^vidrios_luces_rojas$/, 'tail'],
        [/^vidrios_luces$/, 'lens'],
        [/^aluminio_aros$/, 'alloy'],
        [/^llantas$/, 'tire'],
        [/^hule$/, 'rubber'],
        [/^negro$/, 'plastic'],
        [/^espejos$/, 'chrome'],
        [/^hierro$/, 'iron'],
        [/^ambar$/, 'amber'],
        [/^luz1$/, 'head']
    ],
    // Rodas escuras (gunmetal) no carro do Navalha; o resto do alumínio continua cromado.
    wheelRules: [[/^aluminio_aros$/, 'darkAlloy']],
    caliperColor: 0x222222
};
