"""Corre el script ORIGINAL de Python sobre filas en JSON, como llegan de Athena.
Uso: python herramientas/paridad/referencia.py <datos.json> <salida.xlsx>

No reimplementa nada del script: solo reemplaza la lectura del Excel por las
filas del JSON, que entran por el mismo leer_archivo() de siempre."""
import contextlib, importlib.util, io, json, sys
from pathlib import Path
import pandas as pd

SCRIPT = Path(__file__).resolve().parent.parent / "limpiador_auditoria_bavaria.py"
spec = importlib.util.spec_from_file_location("limpiador", SCRIPT)
lim = importlib.util.module_from_spec(spec); spec.loader.exec_module(lim)

filas = json.load(open(sys.argv[1], encoding="utf-8"))
pd.read_excel = lambda *args, **kwargs: pd.DataFrame(filas, dtype=object)

with contextlib.redirect_stdout(io.StringIO()):
    r = lim.main([sys.argv[1], "-o", sys.argv[2]])
print("python", pd.__version__, "->", "ok" if r == 0 else f"falló ({r})")
