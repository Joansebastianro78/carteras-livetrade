/**
 * Corre el limpiador de la app (src/lib/limpiadorAuditoria.ts) sobre filas en
 * JSON y escribe el Excel, para compararlo con el del script de Python.
 * Uso, desde la raíz del proyecto:
 *   npx tsx herramientas/paridad/paridad.ts <datos.json> <salida.xlsx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { escribirExcel, limpiarAuditoria } from "../../src/lib/limpiadorAuditoria";

async function main() {
  const [, , datos, salida] = process.argv;
  const filas = JSON.parse(readFileSync(datos, "utf8"));
  const r = limpiarAuditoria(filas, basename(datos));
  if (!r) throw new Error("Los datos no tienen filas.");
  writeFileSync(salida, Buffer.from(await escribirExcel(r.hojas)));
  console.log("port ->", JSON.stringify(r.resumen));
}

main();
