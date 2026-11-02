// Ayudas compartidas por las pestañas de Contabilidad.
// replaceChildren del navegador escribe «null» si recibe null y no entiende listas: esta versión descarta lo vacío y aplana las listas, como hace h().
export const llenar = (el, ...hijos) => el.replaceChildren(...hijos.flat(Infinity).filter((n) => n != null && n !== false));
