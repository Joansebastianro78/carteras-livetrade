# Paridad del limpiador de auditoría

La app no corre Python: usa `src/lib/limpiadorAuditoria.ts`, que es
`herramientas/limpiador_auditoria_bavaria.py` traducido función por función.
Si se cambia el script, hay que cambiar el port igual y comprobar que los dos
sigan dando el mismo Excel:

```
pip install pandas openpyxl
python herramientas/paridad/generar.py 11 3000 mixtos datos.json
python herramientas/paridad/referencia.py datos.json python.xlsx
npx tsx herramientas/paridad/paridad.ts datos.json app.xlsx
python herramientas/paridad/comparar.py python.xlsx app.xlsx
```

`generar.py` arma datos con los casos difíciles (tildes dañadas, preguntas
numeradas de varias formas, el mismo tipo de línea escrito de varias formas,
empates, vacíos, fechas en otro formato, celdas que pasan el límite de Excel).
El tercer argumento es `mixtos` (códigos con ceros a la izquierda, que quedan
como texto) o `enteros`. Con `--sin tipo_linea,actividad_id` (o cualquier otra
columna opcional) el archivo sale sin esas columnas, y con `--con-pdv-id` trae
`punto_venta_id`: conviene probar también así.

`referencia.py` no reimplementa nada: corre el script tal cual y solo le
cambia la lectura del Excel por las filas del JSON, que llegan como texto,
igual que desde Athena. `comparar.py` revisa celda por celda y también
anchos, paneles congelados, filtros y estilo de encabezados; la única celda
que no compara es la hora de "Generado" en Notas.
