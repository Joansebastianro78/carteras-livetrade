# Cartera LiveTrade

Consulta pública de cartera por usuario + cédula, con mapa de ruteo y descarga
en Excel, más un panel de administración para cargar la plantilla maestra.

Next.js 15 (App Router) · Tailwind CSS 4 · React-Leaflet 5 · SheetJS · Supabase.

---

## 1. Instalación

```bash
npm install
cp .env.local.example .env.local   # y completar los valores
npm run dev
```

SheetJS ya no se publica en el registro de npm: la última versión ahí es la
0.18.5. El `package.json` instala el tarball oficial desde `cdn.sheetjs.com`,
que es la fuente autoritativa. Si tu red bloquea ese dominio, hay que
autorizarlo o hospedar el tarball internamente.

## 2. Supabase

1. Crear el proyecto en supabase.com.
2. Abrir **SQL Editor** y ejecutar, en orden: `supabase/schema.sql`,
   `supabase/admins.sql` y `supabase/gestion.sql`.
3. En **Project Settings → API**, copiar la *Project URL* y la **service_role**
   key hacia `.env.local`.

### Sobre las llaves

El documento original proponía consultar Supabase desde el navegador con la
*anon key* y una política `USING (true)`. Eso deja la tabla completa —cédulas,
celulares, nombres y direcciones de terceros— legible para cualquiera que abra
las DevTools: basta un `select *` sin filtro.

Aquí las consultas pasan por rutas de servidor (`/api/cartera`,
`/api/admin/upload`) que usan la service_role key, y la tabla queda con RLS
activo y **cero políticas** para `anon`. Por eso no existe
`NEXT_PUBLIC_SUPABASE_ANON_KEY` en el entorno: el navegador nunca habla
directo con la base.

## 3. Rutas

| Ruta | Qué hace |
|---|---|
| `/` | Formulario, mapa y lista. Descarga en Excel (columnas A–G) o en imagen. |
| `/admin` | Login y cargador de la plantilla maestra. |
| `POST /api/cartera` | Devuelve los puntos de un `usuario` + `cedula`. |
| `POST /api/admin/login` | Valida contra `public.admins`, deja cookie firmada (8 h). |
| `POST /api/admin/upload` | UPSERT de un lote de hasta 1000 filas. |
| `GET/PATCH/DELETE /api/admin/puntos` | Buscar, editar o borrar un punto. |
| `GET/POST /api/admin/purgar` | Resumen por ciclo y borrado masivo. |
| `GET/POST/PATCH /api/admin/usuarios` | Listar, crear y activar administradores. |

### Administradores

Viven en `public.admins`, con la clave guardada como hash bcrypt. La comparación
ocurre dentro de Postgres mediante la función `verificar_admin`, así que el hash
nunca sale del motor ni pasa por la aplicación.

```sql
-- crear o cambiarle la clave a alguien
select public.crear_admin('joan', 'clave-larga-y-unica', 'Joan');

-- revocar acceso sin borrar el histórico
update public.admins set activo = false where usuario = 'alguien';

-- quién entró y cuándo
select usuario, nombre, activo, ultimo_login from public.admins order by usuario;
```

El middleware protege `/admin` y `/api/admin/*` con una cookie httpOnly firmada
con HMAC-SHA256 que lleva el usuario dentro. Cada carga queda registrada en
`cargas_cartera.cargado_por`.

El login responde el mismo mensaje para usuario inexistente y clave errada, para
no confirmar qué usuarios existen.

## 4. Lo que encontré en `101_BOGOTA_12_SEP.xlsx`

Revisé las 1.339 filas antes de escribir el importador. Cuatro cosas cambiaron
el diseño:

**Coordenadas sin punto decimal.** Nueve filas traen valores como `473669` en
vez de `4.73669`, o `-7408943176` en vez de `-74.08943176`. El importador las
divide entre 10 hasta que caen dentro de Colombia y marca la fila con
`coord_corregida = true`.

El detalle importa: si el tope de corrección fuera ±90/±180 (el rango mundial),
`473669` se detendría en `47.3669`, que es una latitud perfectamente válida…
en Francia. Por eso `normalizar.ts` usa los límites de Colombia. Si la
operación sale del país, hay que ajustar `LIMITE_LAT` y `LIMITE_LNG`.

**`RUTA` y `num de ruta` no son lo mismo.** `num de ruta` es la ruta asignada a
la persona (1 valor por vendedor); `RUTA` es la agrupación de visita dentro de
la cartera, con valores de 0 a 17. Los marcadores se colorean por `RUTA`, que es
la que tiene poca cardinalidad y sí distingue algo en pantalla. Colorear por
`num de ruta` daría 125 colores indistinguibles.

**96 filas tienen `ccuser = 'LIBRE'`.** Son puntos sin vendedor asignado. Se
guardan, pero `/api/cartera` rechaza explícitamente `LIBRE` como credencial.

**Tipos.** `CELULAR` y `BAVARIA` se guardan como texto: si van a `bigint` o se
leen con `raw: false`, `573132486266` termina como `5.73e+11` y el botón de
llamar deja de servir. `FECHA V3`, `HORA V3` y `MOTIVO DUEÑO` vienen vacías en
todo el archivo; las columnas existen igual para cuando el origen las llene.

El esquema también cambia `NUMERIC(10,8)` por `double precision` para las
coordenadas, y usa `usuario` en vez de `user` porque `user` es palabra reservada
en Postgres y obliga a comillas dobles en cada consulta.

## 5. El panel

Tres pestañas.

**Cargar plantilla.** Tres modos, elegidos antes de soltar el archivo:

| Modo | Qué hace | Cuándo |
|---|---|---|
| Cargar la plantilla completa | UPSERT: crea lo nuevo y reescribe la fila entera de lo existente. Requiere CICLO. | El archivo maestro del ciclo. |
| Actualizar solo lo que traiga el archivo | Escribe únicamente las columnas presentes en el Excel, sobre puntos que ya existen. No crea nada. | Reasignar vendedores, corregir direcciones o coordenadas en bloque. |
| Agregar únicamente los nuevos | INSERT de lo que no exista; deja intacto lo demás. | Sumar puntos a un ciclo en curso. |

El modo actualizar es el que resuelve la corrección masiva: basta un Excel con
`ID` y las columnas a cambiar. Si lleva `CICLO`, el emparejamiento es exacto; si
no, el mismo ID se cambia en todos los ciclos donde exista, y el panel lo
advierte antes de aplicar.

Antes de ejecutar, el panel muestra qué columnas reconoció, cuáles ignoró y
cuántas filas trae. Vale la pena mirarlo: en modo actualizar una celda vacía
cuenta como cambio y deja el campo en blanco.

Ninguno de los tres modos borra filas. Para sacar puntos hay que usar la pestaña
de editar cartera.

**Editar cartera.** Búsqueda por ID, código Bavaria, nombre, dirección, usuario
o cédula; edición de los campos operativos de un punto; borrado individual; y
borrado masivo por ciclo o de todo.

Los campos editables son una lista blanca del lado del servidor. `id_pdv` y
`ciclo` quedan fuera a propósito: son la llave con la que la siguiente carga
reconoce el punto, y cambiarlos a mano crearía un duplicado en el próximo UPSERT.
Los estados de visita que escribe LiveTrade también quedan fuera, para no
descuadrar el origen.

El borrado masivo pide escribir la frase exacta —el nombre del ciclo, o
`ELIMINAR TODA LA CARTERA`— porque no hay papelera ni respaldo automático. Todo
borrado y toda edición quedan en `auditoria_cartera` con el usuario que la hizo.

**Administradores.** Crear, cambiar clave, desactivar y reactivar. Guardas
puestas: nadie puede desactivarse a sí mismo, y el sistema no permite quedarse
sin ningún administrador activo. Escribir un usuario que ya existe reemplaza su
clave, que es la única forma de recuperarla.

Todo administrador puede hacer todo, incluido crear otros administradores y
borrar la cartera completa. No hay roles. Si el equipo crece y necesitas que
alguien solo cargue archivos sin poder borrar, hay que agregar una columna `rol`
a `admins` y validarla en cada ruta.

## 6. Carga y duplicados

La clave natural es `(id_pdv, ciclo)`, con índice único. Cargar dos veces el
mismo archivo actualiza en vez de duplicar. Verifiqué que en el archivo de
ejemplo esa pareja no se repite en ninguna de las 1.339 filas.

El Excel se lee en el navegador y se envía al servidor en lotes de 500 filas.
Los modos actualizar y agregar hacen una consulta por lote para saber qué ya
existe, en vez de una por fila.

Todas las filas de un lote se envían con el mismo juego de claves. PostgREST
arma un solo INSERT con la unión de las claves del lote y pone `null` donde una
fila no trae la clave; si un campo aparece en una sola fila, el resto del lote
intenta escribir `null` ahí, y en una columna `not null` eso tumba el lote
entero. `uniformar()` en la ruta de carga rellena los huecos con el valor por
defecto de la columna antes de enviar.
La barra de progreso mide lotes confirmados, no una animación: si el lote 3
falla, la pantalla dice cuántas filas alcanzaron a guardarse.

## 7. Descarga en imagen

Además del Excel, el vendedor puede bajar su cartera como un PNG: encabezado,
mapa con los puntos numerados y la lista con dirección, tarea y celular. Está
pensado para mandar por WhatsApp o tener a mano sin datos.

Se dibuja con la API de canvas, sin librerías. html2canvas no servía: el mapa de
Leaflet son cientos de nodos superpuestos y el resultado salía cortado en móvil.
Los tiles se piden con `crossOrigin="anonymous"` porque sin eso el canvas queda
contaminado y `toBlob` falla; si el servidor de tiles no responde con cabeceras
CORS, se dibuja una retícula de fondo y la descarga igual funciona.

La imagen lista hasta 40 puntos; más allá de eso remite al Excel.

## 8. Mapa

El basemap es OpenStreetMap, sin llave. La captura que compartiste usa un estilo
de CARTO que exige API key, y por eso sale el marcado de agua "API KEY REQUIRED"
sobre todo el mapa. Si prefieres el gris claro de CARTO, hay que registrar una
cuenta y cambiar la URL del `TileLayer` en `src/components/Mapa.tsx`.

Leaflet toca `window` al importarse, así que el mapa se carga con
`dynamic(..., { ssr: false })` desde `MapaCliente.tsx`. En el App Router esa
opción solo se permite dentro de un componente de cliente; de ahí la envoltura.

## 9. Pendientes conocidos

- El limitador de intentos vive en memoria del proceso. Con varias instancias en
  Vercel, cada una lleva su propia cuenta. Para algo serio, Upstash Redis.
- La descarga arma el archivo en el navegador. Con carteras de cientos de miles
  de filas convendría generarla en el servidor y entregar un enlace.
- No hay borrado de ciclos viejos. Cuando la tabla crezca, conviene un job que
  archive los ciclos cerrados.
- No hay recuperación de clave de administrador: se cambia desde el SQL Editor
  con `crear_admin`. Con más de cinco u ocho administradores, vale la pena mover
  todo esto a Supabase Auth en vez de mantener la tabla propia.
