// Actividades económicas en palabras. Hacienda las entrega como código ("5610.0" o "561001"); la cajera necesita leer qué actividad es.
// Los códigos usan la clasificación CIIU 4: las primeras 4 cifras identifican la actividad en los dos formatos.
// Solo sirve para MOSTRAR: lo que viaja en la factura sigue siendo el código tal cual.
const NOMBRES = {
  '0111': 'Cultivo de cereales y legumbres',
  '0121': 'Cultivo de frutas',
  '0141': 'Cría de ganado bovino',
  '0146': 'Cría de aves de corral',
  '1010': 'Procesamiento y conservación de carne',
  '1071': 'Panadería y productos de panadería',
  '1104': 'Elaboración de bebidas no alcohólicas y aguas',
  '4100': 'Construcción de edificios',
  '4290': 'Construcción de obras de ingeniería civil',
  '4321': 'Instalaciones eléctricas',
  '4610': 'Venta al por mayor a cambio de una retribución',
  '4630': 'Venta al por mayor de alimentos, bebidas y tabaco',
  '4690': 'Venta al por mayor no especializada',
  '4711': 'Supermercados, pulperías y comercios de alimentos',
  '4719': 'Venta al por menor en comercios no especializados',
  '4721': 'Venta de alimentos en comercios especializados',
  '4722': 'Venta de bebidas en comercios especializados',
  '4730': 'Venta de combustible (estaciones de servicio)',
  '4772': 'Farmacias y venta de productos medicinales',
  '4921': 'Transporte de pasajeros dentro de la ciudad',
  '4922': 'Otro transporte de pasajeros por carretera',
  '4923': 'Transporte de carga por carretera',
  '5510': 'Hoteles y alojamiento',
  '5610': 'Restaurantes y servicio de comidas',
  '5621': 'Banquetes y catering (comidas por encargo)',
  '5629': 'Otros servicios de comidas',
  '5630': 'Bares y servicio de bebidas',
  '6201': 'Programación informática',
  '6202': 'Consultoría informática',
  '6419': 'Bancos y otros servicios financieros',
  '6810': 'Alquiler de inmuebles propios',
  '6910': 'Servicios jurídicos',
  '6920': 'Contabilidad y auditoría',
  '7010': 'Administración de empresas',
  '7020': 'Consultoría de gestión',
  '7110': 'Arquitectura e ingeniería',
  '7310': 'Publicidad',
  '7710': 'Alquiler de vehículos',
  '8121': 'Limpieza de edificios',
  '8411': 'Administración pública',
  '8510': 'Escuelas (preescolar y primaria)',
  '8521': 'Colegios (secundaria)',
  '8530': 'Universidades y enseñanza superior',
  '8549': 'Otros tipos de enseñanza',
  '8610': 'Hospitales y clínicas',
  '8620': 'Médicos y odontólogos',
  '8890': 'Asistencia social',
  '9101': 'Bibliotecas y archivos',
  '9411': 'Asociaciones empresariales y cámaras',
  '9491': 'Organizaciones religiosas',
  '9499': 'Asociaciones y organizaciones',
};

// "ACTIVIDADES DE RESTAURANTES" -> "Actividades de restaurantes"
function oracion(s) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const sinMarcaManual = (d) => (/^agregada a mano$/i.test(String(d ?? '').trim()) ? '' : String(d ?? '').trim());

// Nombre en palabras de un código. lista = actividades guardadas del cliente ([{codigo, descripcion, manual}]).
// Devuelve { nombre, codigo, texto } ; texto = "Restaurantes y servicio de comidas (5610.0)".
export function infoActividad(codigo, lista = []) {
  const cod = String(codigo ?? '').trim();
  if (!cod) return { nombre: '', codigo: '', texto: '' };
  const base = cod.replace(/\D/g, '').slice(0, 4);
  const guardada = (Array.isArray(lista) ? lista : []).find((x) => x && x.codigo === cod);
  let nombre = NOMBRES[base] || oracion(sinMarcaManual(guardada?.descripcion));
  if (!nombre) nombre = 'Actividad sin nombre en la lista';
  return { nombre, codigo: cod, texto: nombre + ' (' + cod + ')' };
}
export const textoActividad = (codigo, lista) => infoActividad(codigo, lista).texto;
