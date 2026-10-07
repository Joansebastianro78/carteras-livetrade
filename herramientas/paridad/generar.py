"""Datos de prueba con los casos difíciles del limpiador.

Uso: generar.py <semilla> <n> <codigos: mixtos|enteros> <salida.json> [--sin col1,col2] [--con-pdv-id]

  --sin         columnas que no debe traer el archivo (tipo_linea, actividad_id,
                nombre_personalizado...), para probar el script sin ellas.
  --con-pdv-id  agrega la columna opcional punto_venta_id.
"""
import argparse, json, random
ap = argparse.ArgumentParser()
ap.add_argument("semilla", type=int); ap.add_argument("n", type=int)
ap.add_argument("modo", choices=["mixtos", "enteros"]); ap.add_argument("salida")
ap.add_argument("--sin", default=""); ap.add_argument("--con-pdv-id", action="store_true")
a = ap.parse_args()
n, modo = a.n, a.modo
R = random.Random(a.semilla)
daniar = lambda s: s.encode("utf-8").decode("cp1252", errors="ignore")
ETIQ = [
    "8.Número de identificación", "Fecha de Nacimiento de la persona dueña del negocio",
    "5.¿Con qué proveedores?", "5. ¿Con qué proveedores?", "¿Con que proveedores?", daniar("5.¿Con qué proveedores?"),
    daniar(daniar("¿Con qué proveedores?")), "¿Con qúe proveedores?",
    "11. Del total de ventas, ¿qué porcentaje proviene de la venta de cerveza?",
    "4.Del total de ventas, ¿qué porcentaje proviene de la venta de cerveza?",
    "¿Cuántos años tiene el negocio actual?", "2.1 ¿Cuántos años tiene el negocio actual?",
    "¿Su negocio presta servicio de domicilios?", "¿Su negocio presta servicio de domicilios",
    "¿Cuál es el valor total promedio de los costos y gastos de su negocio en un mes?",
    "¿Cuál es el ingreso total aproximado de ventas en un día?", "Edad del participante",
    "¿Cuáles son las barreras que impiden que su negocio crezca? (seleccione",
    "¿Qué formas de pago digital acepta actualmente?\t", "  ¿Qué   formas de pago digital acepta actualmente?",
    "3) Mobiliario adicional", "12 - Mobiliario adicional", None, "", "   ",
]
VALS = ["0123456", "12345678901", "", None, "Select", "Select|Coca-Cola", " select | x", "No|WhatsApp", "65 años", "150",
        "500.000", "5.000.000", "16", "2012-05-01", "2012-05-01 00:00:00", "2012-05-01 10:30", "2012-05-01T00:00",
        "https://s3.amazonaws.com/fotos/123.jpg", "HTTPS://X/Y", daniar("Sí"), "  texto  con espacios ",
        "texto\x07con control", "👍 bien", "0", "000", "123456789012345", "1234567890123456", "-5", "3.5", "Â", "â€"]
USUARIOS = [f"BAV{i:03d}" for i in range(1, 41)] + ["bav099", "  BAV002 ", None, "Usuario Prueba", "BAV 7"]
if modo == "mixtos":
    CODIGOS = [f"00{12000+i}" for i in range(80)] + [str(13000 + i) for i in range(80)] + [None, " 13005 ", "ABC-1"]
else:
    CODIGOS = [str(20000 + i) for i in range(150)] + [" 20003 ", "20004\t"]
DEPS = ["ATLANTICO", "CUNDINAMARCA", daniar("NARIÑO"), None]
# El mismo tipo de línea escrito de varias formas, líneas que no están en el
# orden fijo del script y filas sin tipo de línea.
LINEAS = (["Linea base"] * 6 + ["Línea Base", "linea  base ", daniar("Línea base")]
          + ["Linea de seguimiento"] * 3 + ["LINEA DE SEGUIMIENTO"]
          + ["Inscripcion avanza"] * 2 + ["Inscripción avanza"]
          + ["Sin clasificar", "Sin clasificar", "Otra línea", None, "", "  "])
ACTIVIDADES = ["12602", "12603", "12604", "12605", "12606", "13346", "13346", "12663", "9999", "99999",
               None, "", "012602", "ACT-1", " 12602 "]
filas = []
for i in range(n):
    c = R.choice(CODIGOS)
    nom = R.choice([f"Tienda {c.strip() if c else ''}", f"BV1-{daniar('Tienda Peña')} - {c}", None, "Sin código en el nombre"])
    if i % 400 == 7:  # fechas con otro formato o inválidas
        fecha = R.choice(["2026-09-05", "2026-02-30 10:00:00.000", " 2026-09-05 10:00:00.000", "05/09/2026"])
    else:
        fecha = None if R.random() < 0.03 else f"2026-09-{R.randint(1,28):02d} {R.randint(0,23):02d}:{R.randint(0,59):02d}:{R.randint(0,59):02d}.{R.randint(0,999):03d}"
    fila = {"codigo_bavaria": c, "nombre_personalizado": nom, "nombre_usuario": R.choice(USUARIOS),
            "departamento": R.choice(DEPS), "provincia": R.choice(["BOGOTA", "CALI", None]),
            "componente_etiqueta": R.choice(ETIQ), "componente_valor": R.choice(VALS), "fecha": fecha,
            "actividad_id": R.choice(ACTIVIDADES), "tipo_linea": R.choice(LINEAS)}
    if a.con_pdv_id:
        fila["punto_venta_id"] = R.choice([str(5230000 + R.randint(0, 60)), "0077", None, "PDV-9"])
    filas.append(fila)
    if R.random() < 0.02:
        filas.append(dict(filas[-1]))  # fila repetida idéntica
# Empate exacto entre dos variantes de la misma pregunta (misma cuenta, mismo largo).
for k in range(3):
    for e in ["¿Con qúe proveedores? ", "¿Con qué proveedores?"]:
        filas.append({**filas[k], "componente_etiqueta": e})
# Empate exacto entre dos formas del mismo tipo de línea, y entre dos líneas
# fuera del orden fijo con el mismo total.
for k in range(3):
    for linea in ["Linea X", "LINEA X"]:
        filas.append({**filas[k], "tipo_linea": linea})
for k in range(4):
    for linea in ["Zeta", "Alfa"]:
        filas.append({**filas[k], "tipo_linea": linea})
# Una celda que pasa el límite de Excel en Preguntas_Horizontal.
for k in range(3):
    filas.append({**filas[0], "componente_etiqueta": "Comentario largo", "componente_valor": ("x" * 12000) + str(k) + "🙂"})
filas.append({k: None for k in filas[0]})              # fila vacía: se descarta
filas.append({k: "  " for k in filas[0]})              # fila en blanco: se descarta
if modo == "mixtos":
    filas[0]["fecha"] = ""                             # la primera fecha vacía
quitar = [c for c in a.sin.split(",") if c]
filas = [{k: v for k, v in f.items() if k not in quitar} for f in filas]
json.dump(filas, open(a.salida, "w"), ensure_ascii=False)
print(a.salida, len(filas), "filas", "| columnas:", ", ".join(filas[0]))
