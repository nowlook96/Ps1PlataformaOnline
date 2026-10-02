// Registro dos modelos 3D de carros. Para um carro novo: crie o modelo (procedural com car-kit.js ou .glb
// convertido por Drag/CarrosBlender/exportar-glb.py + entrada em glb-models.js) e registre aqui com o
// mesmo nome usado no campo "model" do Drag/catalog.json. A criação é assíncrona (os .glb vêm pela rede).
import { createBmwF31 } from './bmw-f31.js';
import { createGlbCar } from './glb-car.js';
import { BMW_M4, MUSTANG_S197 } from './glb-models.js';

const models = {
    'bmw-f31': async visual => createBmwF31(visual),
    'bmw-m4': visual => createGlbCar(BMW_M4, visual),
    'mustang-s197': visual => createGlbCar(MUSTANG_S197, visual)
};

export async function createCarModel(model, visual) {
    const make = models[model];
    if (!make) throw new Error('Modelo de carro desconhecido: ' + model);
    return make(visual ?? {});
}

export function hasCarModel(model) {
    return model in models;
}
