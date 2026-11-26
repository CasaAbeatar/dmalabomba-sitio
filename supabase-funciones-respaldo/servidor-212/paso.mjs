import { latido } from './prueba-212.mjs';
const paso = process.argv[2];
let r;
if (paso === 'sucio') r = await latido({ app: '2.12.0', sms_sin_reenviar: 3, cargando: false, tipo_red: 'ninguna', red_validada: true, actualizacion_estado: 'fallo', actualizacion_detalle: 'sha_no_coincide', actualizacion_objetivo: '2.12.0' }, { bateria: 30 });
if (paso === 'limpio') r = await latido({ app: '2.12.0', sms_sin_reenviar: 0, cargando: true, tipo_red: 'wifi', red_validada: true, actualizacion_estado: 'ninguna' }, { bateria: 90 });
console.log(JSON.stringify(r));
