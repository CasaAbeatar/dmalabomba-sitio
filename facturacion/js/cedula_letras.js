// Reglas puras de la identificación con letras (sin pantalla ni red): las usan ui_cedula.js y sus pruebas.
// Cédula jurídica alfanumérica (Lote 0). Hacienda la permite cuando el Registro Nacional lo comunique; mientras tanto queda APAGADA y todo funciona como siempre (solo números).
// Para encenderla basta poner ajustesCedula.juridicaConLetras = true (el sistema lo hará leyendo la misma bandera que usa el envío: fact.config cedula_juridica_letras).
export const ajustesCedula = { juridicaConLetras: false };
export const juridicaConLetras = (t) => t === '02' && ajustesCedula.juridicaConLetras === true;
export const llevaLetras = (t) => t === '05' || t === '06' || juridicaConLetras(t);
export const RE_JURIDICA_LETRAS = /^[0-9A-Z]{10}$/;
// Mensaje para una cédula jurídica con letras (vacío si está bien): 10 caracteres entre números y letras mayúsculas, sin guiones ni espacios
export function errorJuridicaLetras(d) {
  const t = String(d ?? '');
  if (RE_JURIDICA_LETRAS.test(t)) return '';
  if (/[^0-9A-Z]/.test(t)) return 'La cédula jurídica solo lleva números y letras mayúsculas, sin guiones ni espacios.';
  return t.length < 10 ? 'Faltan caracteres: la cédula jurídica tiene 10 entre números y letras.' : 'Sobran caracteres: la cédula jurídica tiene 10 entre números y letras.';
}
export const MAX_ID_LETRAS = 20;
// El número como se guarda: en 05 y 06 letras y números (sin espacios, guiones ni signos; letras en mayúsculas, como hace la base), hasta 20.
// En los demás tipos solo números; pero si la persona escribió letras se conservan (en mayúsculas) para avisarle en vez de borrarlas sin decir nada.
export function limpiarNumeroId(s, tipo) {
  const t = String(s ?? '').normalize('NFC');
  if (llevaLetras(tipo) || /[A-Za-z]/.test(t)) return t.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, juridicaConLetras(tipo) ? 10 : MAX_ID_LETRAS);
  return t.replace(/\D/g, '').slice(0, MAX_ID_LETRAS);
}
