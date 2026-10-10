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
   `supabase/admins.sql`, `supabase/roles.sql`, `supabase/gestion.sql`,
   `supabase/territorio.sql` y `supabase/panel.sql`.

   En un proyecto que ya estaba andando basta con ejecutar `supabase/panel.sql`
   una vez. Crea dos tablas: `actividad_panel` (la actividad reciente del
   Inicio) y `revision_fotos` (las marcas de la auditoría de imágenes). Se
   puede volver a correr sin problema. Mientras no se ejecute, el panel
   funciona igual: el Inicio no muestra los cambios de usuarios,
   mantenimiento, tableros y temas, y las fotos no se pueden marcar; las dos
   cosas lo avisan en pantalla.
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
| `/admin` | Login y panel completo, con menú lateral: Inicio, cargar, editar, consultores, departamento y ciudad, las dos auditorías, tableros, mantenimiento, temas y usuarios. |
| `/backoffice` | Acceso de consulta: buscar un consultor, filtrar por departamento o ciudad, las dos auditorías y los tableros. |
| `POST /api/cartera` | Devuelve los puntos de un `usuario` + `cedula`. |
| `POST /api/admin/login` | Valida contra `public.admins`, deja cookie firmada (8 h). |
| `POST /api/admin/upload` | UPSERT de un lote de hasta 1000 filas. |
| `GET/PATCH/DELETE /api/admin/puntos` | Buscar, editar o borrar un punto. |
| `GET/POST /api/admin/purgar` | Resumen por ciclo y borrado masivo. |
| `GET/POST/PATCH /api/admin/usuarios` | Listar, crear, activar o desactivar y cambiarle el perfil a un usuario del panel. |
| `GET /api/admin/consultores` | Buscar un consultor o traer su cartera completa. |
| `GET/POST /api/admin/mantenimiento` | Leer y cambiar la ventana de mantenimiento. |
| `GET/POST /api/admin/tema` | Leer y cambiar los temas de temporada. |
| `GET/POST/PATCH/DELETE /api/admin/tableros` | Tableros de Power BI. El GET lo puede llamar también el perfil BackOffice; el resto, no. |
| `GET /api/admin/territorio` | Departamentos y ciudades con su conteo, o una página de puntos de una región. Lo usa el BackOffice. |
| `POST/GET /api/admin/auditoria` | Lanza la consulta de auditoría en Athena, informa su estado y entrega los resultados en páginas de 1000. La usan los tres perfiles. |
| `POST/GET /api/admin/auditoria-imagenes` | Lo mismo, con la consulta de las fotos de inicio de visita. La usan los tres perfiles. |
| `GET/POST /api/admin/revision-fotos` | Las marcas «Correcta» y «Para revisar» de la auditoría de imágenes, con quién las puso. La usan los tres perfiles. |
| `GET /api/admin/resumen` | Cifras del Inicio y estado del encabezado (si la consulta está en mantenimiento). Con `?lista=sin-ubicacion` o `?lista=libres`, los puntos para las descargas de «Para revisar». El BackOffice solo lee el encabezado. |
| `GET /api/admin/actividad` | Actividad reciente del Inicio: cargas, ediciones y borrados, y lo de `actividad_panel`. Solo administradores. |
| `POST /api/admin/upload/previa` | Antes de aplicar una carga: cuántas filas del archivo ya existen y cuántas son nuevas. No cambia nada. |

### Filtro por departamento y ciudad

Sección **Departamento y ciudad**, en `/backoffice` y en el panel `/admin`:
la ven los tres perfiles (BackOffice, administrador y superadministrador). Se elige un departamento,
todos los departamentos, o una ciudad directamente, y opcionalmente un ciclo; salen todos los puntos de esa
región en el mapa y en una lista con buscador, con un desglose por ciudad (o
por departamento, cuando se piden todos) que además sirve de leyenda de colores.

El Excel de este módulo trae **solo las columnas que tienen el encabezado en
azul en la plantilla maestra**, en el mismo orden y con el mismo nombre: 26
columnas, sin ID, HORA V1, USUARIO V1, HORA V2, USUSARIO V2, DURACION V1, RUTA,
LATITUD, LONGITUD, num de ruta ni persona. La lista vive en
`COLUMNAS_EXCEL_TERRITORIO` (`src/lib/territorio.ts`): si cambian los colores
de la plantilla, se cambia ahí y nada más. Las fechas salen como fecha de Excel.

`supabase/territorio.sql` agrega dos columnas calculadas,
`departamento_clave` y `ciudad_clave`, que quitan tildes, puntos y espacios
repetidos: así "Bogotá", "BOGOTA" y "bogota " caen en la misma opción del
filtro. Las calcula la base sola en cada carga y cada edición. Ojo: "BOGOTA" y
"BOGOTA D.C." siguen siendo dos opciones distintas, porque son textos distintos.

Los puntos se piden en páginas de 1000 (Supabase no devuelve más por
consulta, y una sola respuesta grande pasaría del límite de Vercel). Por
encima de 30.000 puntos el filtro pide acotar por ciudad o ciclo, y el Excel
solo se habilita cuando llegaron todas las páginas.

### Tableros de Power BI

Un administrador pega el enlace del informe en su sección **Tableros** y el
perfil BackOffice lo ve en la suya. Solo se guarda el enlace: el informe vive
en Power BI con sus permisos, así que quien no tenga acceso allá tampoco lo ve
acá, y esta app nunca toca los datos del informe.

Se aceptan únicamente direcciones de `powerbi.com`. Un `<iframe>` corre dentro
de nuestra página, así que aceptar cualquier dominio sería dejar que alguien
monte ahí una pantalla falsa de inicio de sesión. Al pegar, sirve tanto la URL
pelada como el bloque `<iframe>` que entrega el botón Insertar de Power BI: se
le extrae el `src`.

Con enlaces `autoAuth=true` cada persona ve el informe con su propia cuenta de
Microsoft y necesita sesión abierta en ese mismo navegador. Si el informe no
carga dentro de la página —tenant que bloquea la incrustación, cookies de
terceros deshabilitadas— el visor tiene el botón **Abrir en Power BI**.

### Temas de temporada

Adornos que salen solos en las fechas especiales: telarañas, araña y calabaza
en Halloween; nieve y una tira de luces en Navidad; farolitos el Día de las
Velitas; papelitos en Año Nuevo; corazones en Amor y Amistad.

Los rangos de fechas viven en `src/lib/temas.ts`, no en la base: son los mismos
todos los años y así nadie tiene que moverlos cada diciembre. Agregar una fecha
nueva es añadir una entrada a ese arreglo con su rango y su adorno; el panel la
recoge sola. En la tabla `tema` (una sola fila) queda solo lo que el
administrador decide: el modo (automático, fijo o apagado) y qué temas apagó.

La capa de adornos es `position: fixed` con `pointer-events: none`, así que
nunca tapa un botón; se anima con CSS y no con un bucle de JavaScript; en
celular dibuja la mitad de las partículas y los adornos van más pequeños; y con
`prefers-reduced-motion` las partículas desaparecen y los adornos se quedan
quietos.

### Usuarios del panel

Viven en `public.admins`, con la clave guardada como hash bcrypt. La comparación
ocurre dentro de Postgres mediante la función `verificar_admin`, así que el hash
nunca sale del motor ni pasa por la aplicación.

Hay tres perfiles, en la columna `admins.rol`:

- `superadmin`: todo lo del administrador y, además, el único que puede
  desactivar, cambiarle la clave o cambiarle el perfil a otro superadministrador.
  También es el único que puede crear superadministradores; si no, cualquier
  admin se ascendería y la jerarquía no serviría de nada.
- `admin`: el panel completo, incluido crear usuarios y borrar cartera.
- `backoffice`: solo `/backoffice`, para consultar la cartera de un consultor y
  descargarla. El middleware le responde 403 en cualquier otra ruta de
  `/api/admin`, así que la restricción no depende de que la interfaz esconda
  botones.

Las tres reglas del superadministrador se validan en `/api/admin/usuarios`, no
en la interfaz: los botones que no aplican salen deshabilitados, pero aunque
alguien llame la API a mano recibe 403.

**Cambiar el perfil.** Un administrador o un superadministrador le cambia el
perfil a otro usuario desde su fila en **Administradores**, sin tocarle la
clave (pide confirmación). Reglas, también validadas en la API:

- nadie se cambia el perfil a sí mismo;
- dar o quitar el perfil de superadministrador solo lo hace otro
  superadministrador (un admin ni siquiera ve esa opción);
- siempre queda al menos un administrador activo.

Cada cambio queda en la actividad del Inicio, con el perfil de antes y el
nuevo.

**Sesiones abiertas.** La cookie dura 8 horas y lleva el perfil adentro. Para
que un cambio de perfil o una desactivación no esperen a que venza, el
middleware confirma en la base, en cada petición, que el usuario sigue activo
y con el mismo perfil. Lo recuerda medio minuto para no consultar la base a
cada clic, así que el cambio se aplica como mucho unos 30 segundos después: la
sesión se cierra y el login le explica por qué («Tu perfil cambió…» o «Tu
usuario fue desactivado…»). Antes de sacar a alguien vuelve a preguntar, así
que a quien reactivan o le cambian el perfil y entra de nuevo enseguida no lo
saca un dato viejo. Si la base no contesta, sigue con lo que dice la cookie,
como antes, para no dejar a nadie por fuera por un problema ajeno.

```sql
-- crear o cambiarle la clave a alguien (el cuarto argumento es el perfil)
select public.crear_admin('joan', 'clave-larga-y-unica', 'Joan');
select public.crear_admin('soporte1', 'otra-clave-larga', 'Soporte 1', 'backoffice');
select public.crear_admin('jefe@empresa.com', 'clave-larga-aqui', 'Jefe', 'superadmin');

-- revocar acceso sin borrar el histórico
update public.admins set activo = false where usuario = 'alguien';

-- quién entró y cuándo
select usuario, nombre, rol, activo, ultimo_login from public.admins order by rol, usuario;
```

El middleware protege `/admin`, `/backoffice` y `/api/admin/*` con una cookie
httpOnly firmada con HMAC-SHA256 que lleva el usuario y el rol dentro, y lo
confirma contra la base como se explica arriba. Cada carga queda registrada en
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
la persona (1 valor por consultor); `RUTA` es la agrupación de visita dentro de
la cartera, con valores de 0 a 17. Los marcadores se colorean por `RUTA`, que es
la que tiene poca cardinalidad y sí distingue algo en pantalla. Colorear por
`num de ruta` daría 125 colores indistinguibles.

**96 filas tienen `ccuser = 'LIBRE'`.** Son puntos sin consultor asignado. Se
guardan, pero `/api/cartera` rechaza explícitamente `LIBRE` como credencial.

**Tipos.** `CELULAR` y `BAVARIA` se guardan como texto: si van a `bigint` o se
leen con `raw: false`, `573132486266` termina como `5.73e+11` y el botón de
llamar deja de servir. `FECHA V3`, `HORA V3` y `MOTIVO DUEÑO` vienen vacías en
todo el archivo; las columnas existen igual para cuando el origen las llene.

El esquema también cambia `NUMERIC(10,8)` por `double precision` para las
coordenadas, y usa `usuario` en vez de `user` porque `user` es palabra reservada
en Postgres y obliga a comillas dobles en cada consulta.

## 5. El panel

`/admin` y `/backoffice` comparten el mismo armazón (`src/components/PanelShell.tsx`):
un menú lateral con las secciones agrupadas (Cartera, Auditorías, Reportes,
Configuración), y arriba la fecha y la hora de Colombia y si la consulta está
abierta o en mantenimiento. En el celular el menú se abre con el botón de las tres rayas.
En pantallas grandes se puede ocultar con el botón que está junto al nombre de
la app, para darle todo el ancho a mapas y tablas, y se vuelve a mostrar con
«Menú» arriba a la izquierda; queda como cada quien lo dejó en su navegador
(cookie `cartera_menu`).
Cada sección tiene su dirección (`/admin#auditoria`, `/admin#usuarios`…), así
que se puede guardar o compartir el enlace y el botón Atrás del navegador
funciona. Las secciones de cada panel están en `PanelAdmin.tsx` y
`PanelBackOffice.tsx`; agregar una es sumar una entrada a esa lista.

Abajo del menú están el usuario con su perfil, **Apariencia**, «Ver consulta»
(o «Panel completo» para un administrador dentro del BackOffice) y Salir.

**Modo claro, oscuro o automático.** Cada quien lo elige en **Apariencia**;
«Auto» sigue al sistema operativo. Queda en una cookie de ese navegador
(`cartera_modo`, un año), no en la cuenta. El servidor la lee y pinta la
página ya en su modo, sin un parpadeo claro al entrar. Solo aplica al panel,
al BackOffice y a su login: la consulta de los consultores siempre se ve clara,
aunque quien la abra tenga elegido el oscuro (el middleware marca las páginas
del panel con un encabezado y el layout solo aplica el modo a esas). Los
colores son variables CSS en `src/app/globals.css`: el bloque
`:root[data-modo="oscuro"]` define la versión oscura de cada una, y las piezas
comunes del panel (`tarjeta`, `boton`, `chip`, `tabla`…) están ahí mismo. Los
mapas conservan sus capas de siempre.

**Inicio.** Lo primero al entrar: los puntos asignados (conteo general de
toda la cartera, todos los ciclos, sin los LIBRE), los consultores con al
menos un punto (usuario + cédula, como en el buscador del BackOffice), los
puntos sin coordenadas del ciclo actual y el último cargue; atajos;
el resumen de la última auditoría de datos consultada desde ese navegador; la
actividad reciente; los puntos por departamento; y «Para revisar», con las
descargas de los puntos sin coordenadas y de los LIBRE, y las observaciones
del último cargue. La actividad junta las cargas (`cargas_cartera`), las
ediciones y borrados (`auditoria_cartera`) y, con `supabase/panel.sql`, los
cambios de usuarios, mantenimiento, tableros y temas (`actividad_panel`).

**Cargar plantilla.** Va en cuatro pasos: qué quieres hacer, el archivo,
revisar y aplicar. Nada cambia en la cartera hasta el último. Tres modos,
elegidos antes de soltar el archivo:

| Modo | Qué hace | Cuándo |
|---|---|---|
| Cargar la plantilla completa | UPSERT: crea lo nuevo y reescribe la fila entera de lo existente. Requiere CICLO. | El archivo maestro del ciclo. |
| Actualizar solo lo que traiga el archivo | Escribe únicamente las columnas presentes en el Excel, sobre puntos que ya existen. No crea nada. | Reasignar consultores, corregir direcciones o coordenadas en bloque. |
| Agregar únicamente los nuevos | INSERT de lo que no exista; deja intacto lo demás. | Sumar puntos a un ciclo en curso. |

El modo actualizar es el que resuelve la corrección masiva: basta un Excel con
`ID` y las columnas a cambiar. Si lleva `CICLO`, el emparejamiento es exacto; si
no, el mismo ID se cambia en todos los ciclos donde exista, y el panel lo
advierte antes de aplicar.

En el paso de revisar, el panel compara el archivo con la cartera
(`/api/admin/upload/previa`) y dice cuántos puntos son nuevos y cuántos ya
existen, cómo queda la cartera después, qué columnas reconoció y cuáles
ignoró, y las filas con observaciones, que se pueden bajar en Excel
(`Observaciones_<archivo>.xlsx`). Vale la pena mirarlo: en modo actualizar una
celda vacía cuenta como cambio y deja el campo en blanco.

Ninguno de los tres modos borra filas. Para sacar puntos hay que usar la sección
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

**Usuarios del panel** (sección Administradores). Crear, cambiar clave,
cambiar el perfil desde la fila, desactivar y reactivar. Guardas puestas: nadie puede desactivarse a sí mismo, y el sistema no
permite quedarse sin ningún administrador activo (los perfiles BackOffice no
cuentan para ese mínimo). Escribir un usuario que ya existe reemplaza su clave,
que es la única forma de recuperarla, y le deja el perfil que esté marcado.

Los perfiles son `superadmin`, `admin` y `backoffice`. Cada fila de la lista
trae un botón **Cambiar clave** que carga ese usuario en el formulario de abajo;
guardar reemplaza su clave, que sigue siendo la única forma de recuperarla.

Si algún día hace falta otro perfil —por ejemplo alguien que cargue archivos
pero no pueda borrar—, el sitio donde se decide qué rutas ve cada uno es
`API_BACKOFFICE` en `src/middleware.ts`.

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

Además del Excel, el consultor puede bajar su cartera como un PNG: encabezado,
mapa con los puntos numerados y la lista con dirección, tarea y celular. Está
pensado para mandar por WhatsApp o tener a mano sin datos.

Se dibuja con la API de canvas, sin librerías. html2canvas no servía: el mapa de
Leaflet son cientos de nodos superpuestos y el resultado salía cortado en móvil.
Los tiles se piden con `crossOrigin="anonymous"` porque sin eso el canvas queda
contaminado y `toBlob` falla; si el servidor de tiles no responde con cabeceras
CORS, se dibuja una retícula de fondo y la descarga igual funciona.

La imagen lista hasta 40 puntos; más allá de eso remite al Excel.

## 8. Mapa

Todos los mapas (el del consultor, el del filtro por departamento y ciudad, y
la imagen que se descarga) tienen un botón **Capas** abajo a la izquierda,
como el de Google Maps. Cualquier perfil, consultores incluidos, elige ahí cómo
ver el mapa; la elección queda guardada en su navegador y se aplica a todos los
mapas y a la imagen PNG. El catálogo vive en `src/lib/mapaBase.ts` y el botón
en `src/components/CapasMapa.tsx`.

| Capa | Fuente | Llave |
|---|---|---|
| Calles | Mapbox `streets-v12` | `NEXT_PUBLIC_MAPBOX_TOKEN` |
| Satélite | Mapbox `satellite-streets-v12` | `NEXT_PUBLIC_MAPBOX_TOKEN` |
| Claro | Mapbox `light-v11` | `NEXT_PUBLIC_MAPBOX_TOKEN` |
| MapLibre | MapLibre GL con el estilo Liberty de OpenFreeMap | ninguna |
| OpenStreetMap | tiles de OSM; solo aparece si no hay token de Mapbox | ninguna |

- **Mapbox** se activa con `NEXT_PUBLIC_MAPBOX_TOKEN` en el entorno (en Vercel
  también, y volviendo a desplegar: las variables `NEXT_PUBLIC_` se escriben en
  el código al compilar). El token es público (`pk.`) y se ve en el navegador:
  se protege restringiéndolo por dominio en account.mapbox.com. Los mapas usan
  la Static Tiles API con tiles de 512 px, y la imagen descargada la Static
  Images API (una petición por imagen). Las dos tienen cupo gratis mensual y
  luego se cobran.
- **MapLibre GL** dibuja un mapa vectorial en el navegador con WebGL, usando el
  servicio público de OpenFreeMap: sin llave ni límite de vistas, pero sin
  garantía de disponibilidad. La librería (`maplibre-gl` 5 y
  `@maplibre/maplibre-gl-leaflet`) solo se descarga cuando alguien elige esa
  capa. Va en la versión 5 a propósito: la 6 carga su worker desde un archivo
  aparte con una ruta que el bundler de Next no sigue. Si el equipo no tiene
  WebGL, el mapa vuelve a la capa por defecto y lo avisa. La imagen PNG no
  tiene equivalente en MapLibre: con esa capa elegida sale con Calles.
- Para agregar o quitar capas se edita `CAPAS` en `mapaBase.ts`; el botón las
  recoge solo.

Leaflet toca `window` al importarse, así que el mapa se carga con
`dynamic(..., { ssr: false })` desde `MapaCliente.tsx`. En el App Router esa
opción solo se permite dentro de un componente de cliente; de ahí la envoltura.

## 9. Auditoría (Athena)

Sección **Auditorías → Datos**, en `/backoffice` y en `/admin`, para los tres
perfiles. En pantalla no se nombra Athena. Al abrirla ejecuta en Athena la
consulta de `src/lib/consultaAuditoria.ts`
(validaciones de cédula, fechas de nacimiento, «Select» sin responder, rangos
de costos, ventas, porcentajes y años) y muestra los hallazgos con un desglose
por motivo y un buscador. La consulta trae además `actividad_id` y
`tipo_linea`: a qué línea pertenece cada respuesta (Linea base, Inscripcion
avanza, Linea de seguimiento o Sin clasificar), que sale del `CASE` sobre la
actividad. Si se agrega una actividad nueva, se agrega ahí.

La pantalla tiene arriba los filtros (fechas, con atajos «Hoy», «Últimos 7
días» y «Este mes»; consultor; tipo de línea; buscador) con los que están
puestos a la vista y un botón para quitarlos; después las cifras (hallazgos,
consultores, PDV con hallazgos y sin fecha), las barras «Por motivo», que
también filtran, y la tabla de hallazgos de 50 en 50 (en el celular, tarjetas
y una barra fija con «Filtros» y «Excel limpio»). Lo último que se consultó
queda resumido en el Inicio de ese navegador.

**Rango de fechas** («Desde» y «Hasta», los dos opcionales): delimita toda la
sección —los hallazgos, los conteos por motivo y las dos descargas— a los
hallazgos cuya `fecha` cae en esos días, ambos incluidos. Un hallazgo sin
fecha queda fuera de cualquier rango y la pantalla dice cuántos son. El
consultor, el tipo de línea, el motivo y el buscador solo afinan lo que se ve;
no recortan los Excel. Sin rango, todo
funciona como siempre. La fecha se toma tal como la entrega la consulta, sin
convertir zona horaria (igual que en la auditoría de imágenes, más abajo).

Dos descargas, en el botón «Excel limpio» y su flecha, las dos con los
hallazgos del rango de fechas (sin rango, todos). Con rango, el nombre del archivo lo lleva en lugar del día de hoy:
`..._2026-09-05_a_2026-09-10.xlsx`.

- **Excel limpio** (`auditoria_bavaria_puntos_limpia_<fecha>.xlsx`): los
  resultados de Athena pasan por el limpiador de auditoría Bavaria (tildes
  dañadas, espacios, la misma pregunta escrita de varias formas, el tipo de
  línea de cada respuesta) y salen sus ocho hojas: Resumen_Usuarios,
  Usuario_x_Pregunta, Usuario_x_Codigo, Resumen_Preguntas, Resumen_Tipo_Linea,
  Preguntas_Horizontal, Detalle_por_Codigo y Notas, con su mismo formato. Se
  arma en el navegador; con decenas de miles de filas tarda unos segundos. Si
  hay rango de fechas, queda escrito en «Notas», en «Archivo de origen».
- **Datos sin limpiar**: las diez columnas de la consulta tal cual, más
  `motivo_auditoria`. La columna `fila_excel` del Excel limpio apunta a la
  fila de este archivo si se descargan de la misma consulta y con las mismas
  fechas.

**El limpiador.** La app no corre Python: `src/lib/limpiadorAuditoria.ts` es
`herramientas/limpiador_auditoria_bavaria.py` traducido función por función,
incluidos los detalles de pandas que cambian el resultado (orden de empates,
formato de fechas, redondeo, corte de textos largos). Se comparó celda por
celda contra el script con datos de prueba de hasta 40.000 filas, con pandas 3
y 2.2, y salen iguales; el procedimiento está en `herramientas/paridad/`.
**Si se cambia el script, hay que cambiar el port igual** y volver a comparar.
La configuración (`UNIR_PREGUNTAS_SIN_NUMERO`, `RENOMBRAR_PREGUNTAS`,
`SEPARADOR`, `PATRON_USUARIO`, `ORDEN_TIPO_LINEA`) está arriba de ese archivo,
con los mismos nombres. La hoja horizontal va por código y tipo de línea (la
opción `--horizontal-por visita` del script no está en la app).

El Excel limpio usa ExcelJS, que se descarga solo al pedirlo: la edición
gratuita de SheetJS no escribe estilos ni paneles congelados.

**Configuración.** En `.env.local` y en Vercel (y volver a desplegar):

```
ATHENA_ACCESS_KEY_ID=...
ATHENA_SECRET_ACCESS_KEY=...
```

Región, workgroup, base de datos y carpeta de resultados ya vienen con los de
la conexión de DBeaver (`us-east-1`, `workgroup647`, `livetradebi`,
`s3://mkt-bi-athena-read-cliente-id-647/athena/`); se cambian con
`ATHENA_REGION`, `ATHENA_WORKGROUP`, `ATHENA_DATABASE` y `ATHENA_OUTPUT`. Las
variables van con `ATHENA_` y no con `AWS_` porque Vercel reserva esos nombres.

**Cómo funciona.**

- La consulta corre en Athena por su cuenta: la ruta la lanza y responde de
  una vez, y el navegador pregunta el estado cada 1 a 3 segundos. Así ninguna
  llamada choca con el límite de tiempo de las funciones de Vercel.
- Los resultados llegan en páginas de 1000 filas (lo máximo de Athena por
  llamada). Por encima de 200.000 filas la pantalla pide usar DBeaver.
- El navegador nunca manda SQL. La ruta solo corre esta consulta, y el id
  que le entrega al navegador va firmado con `ADMIN_SECRET` (HMAC), junto
  con el nombre de la consulta: solo se
  leen las ejecuciones que lanzó la propia ruta, así que quien tenga sesión no
  puede leer otras consultas del workgroup pasando su id. No se compara el
  texto de la consulta que devuelve Athena con el enviado, porque no hay
  garantía de que lo devuelva idéntico.
- Si Athena rechaza algo, la pantalla muestra su mensaje y el detalle queda en
  el log del servidor con la etiqueta `[athena ...]`.
- **Costo.** Athena cobra por datos leídos. Si la misma consulta corrió hace
  menos de 10 minutos, Athena reutiliza ese resultado sin volver a leer las
  tablas (`ATHENA_REUSO_MINUTOS`; 0 lo apaga). «Volver a consultar» siempre
  pide datos nuevos. Si el workgroup no admite reutilización, se ejecuta
  normal.
- **Permisos de AWS.** El usuario necesita `athena:StartQueryExecution`,
  `athena:GetQueryExecution` y `athena:GetQueryResults` en el workgroup;
  lectura del catálogo de Glue de `livetradebi`; lectura de los buckets de las
  tablas; y lectura y escritura en la carpeta de resultados. Lo recomendable
  es un usuario de IAM solo para esta app, con exactamente eso, y no las llaves
  de una persona.
- Si se cambia la consulta, revisar `motivoAuditoria()` en
  `src/lib/auditoria.ts`, que explica en pantalla qué regla hizo salir cada
  fila.

### Auditoría de imágenes

Sección **Auditorías → Imágenes**, en `/backoffice` y en `/admin`, para los
tres perfiles. Corre en Athena la consulta de `src/lib/consultaImagenes.ts`:
la foto con la que cada consultor inició la visita (`foto_visita_inicio`),
con el PDV, su código, el consultor y la fecha de la visita (`fecha_inicio`).
**La campaña está fija en la consulta (`campana_id = 2423`)**: para auditar
otra se cambia en ese archivo.

- **Rango de fechas** («Desde» y «Hasta», los dos opcionales): delimita toda
  la sección —la galería, los conteos y el Excel— a las visitas de esos días,
  ambos incluidos. El calendario ofrece los días entre la primera y la última
  visita. Una visita sin fecha, o con una fecha que no se entiende, queda
  fuera de cualquier rango y la pantalla dice cuántas son.
- La fecha se toma **tal como la entrega Athena, sin convertir zona horaria**.
  Si `fecha_inicio` está guardada en UTC, una visita de las 8 p. m. en Colombia
  aparece con fecha del día siguiente; en ese caso la conversión va en la
  consulta (`fecha_inicio AT TIME ZONE 'America/Bogota'`).
- Las visitas salen de la más reciente a la más antigua; las que no traen
  fecha, al final.
- Galería de fotos agrupada por día, con filtro por consultor, por revisión,
  buscador por PDV o código, y filtros «Con foto», «Sin foto» y, si aparecen,
  «Sin enlace válido». Estos filtros afinan lo que se ve dentro de las fechas
  elegidas. En pantalla grande, tocar una foto la muestra a la derecha con sus
  datos; en el celular se abre en grande. En el visor se pasa a la anterior o
  la siguiente con las flechas (también las del teclado) y se cierra con Esc.
- **Revisión de fotos.** Cada foto se puede marcar «Correcta» o «Para
  revisar» (tocar la marca puesta la quita). Las marcas se guardan en la tabla
  `revision_fotos` (de `supabase/panel.sql`) con quién y cuándo, así que las ve
  todo el equipo; arriba sale cuántas van revisadas. La foto se reconoce por
  una huella de su enlace: si el enlace cambia, la marca no la sigue.
- **Descargar Excel**: las cinco columnas de la consulta, con la foto como
  enlace para abrirla con un clic y `fecha_inicio` como fecha de Excel, más
  `revision` y `revisado_por`. Trae las visitas del rango de fechas (sin
  rango, todas); el consultor, la revisión, el buscador y los filtros de foto
  no lo recortan. El nombre del archivo lleva el rango:
  `Auditoria_imagenes_2026-09-05_a_2026-09-10.xlsx`.
- Las fotos se cargan directamente desde la dirección que trae
  `foto_visita_inicio`, en su tamaño original; por eso la galería muestra de a
  24 y solo descarga las que van quedando a la vista. Si el servidor de fotos
  no permite verlas desde otra página, o el enlace venció, la tarjeta dice «La
  foto no cargó» y arriba sale cuántas fallaron.
- Solo se muestran direcciones `http` y `https`. Si la celda trae otra cosa
  (un nombre de archivo, una ruta interna), la visita sale como «Sin enlace
  válido» con el valor tal cual. Varias fotos en una celda van separadas por
  espacios o `|`.

Las dos auditorías comparten la conexión: `src/lib/rutaAthena.ts` arma la ruta
de API para una consulta fija, y `src/components/ConsultaAthena.tsx` lanza la
consulta, espera y trae las páginas. Agregar otra consulta es un archivo con
el SQL, una ruta de cuatro líneas y su pantalla. También comparten el filtro
de fechas: `src/lib/fechas.ts` lee las fechas y decide qué cae en el rango, y
`src/components/RangoFechas.tsx` son los campos «Desde» y «Hasta».

## 10. Pendientes conocidos

- El limitador de intentos vive en memoria del proceso. Con varias instancias en
  Vercel, cada una lleva su propia cuenta. Para algo serio, Upstash Redis.
- La descarga arma el archivo en el navegador. Con carteras de cientos de miles
  de filas convendría generarla en el servidor y entregar un enlace.
- No hay borrado de ciclos viejos. Cuando la tabla crezca, conviene un job que
  archive los ciclos cerrados.
- El resumen de la auditoría que sale en el Inicio se guarda en el navegador
  de cada quien, no en la base: otro computador no lo ve hasta consultarla.
- El modo oscuro no oscurece los mapas: las capas son imágenes de terceros.
- No hay recuperación de clave de administrador: se cambia desde el SQL Editor
  con `crear_admin`. Con más de cinco u ocho administradores, vale la pena mover
  todo esto a Supabase Auth en vez de mantener la tabla propia.
