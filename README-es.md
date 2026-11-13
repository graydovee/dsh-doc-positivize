# dsh-doc-positivize

Un plugin de DeepSeek Harness (DSH) que reescribe las formulaciones negativas e históricas de la documentación y los comentarios de código —"no usar", "obsoleto", "ya no se admite"— como afirmaciones positivas del diseño actual, con una regla permanente en el system prompt y el comando `/positivize`, que recorre los archivos existentes, muestra una tarjeta de resultado y permite deshacer archivo por archivo.

## What it does

`apply` registra dos contribuciones: una sección global del prompt — `doc-positivize:guard`, orden `6000` — y el comando humano `/positivize`. Con la guarda activada se aplica en cada petición; el comando solo cuando se escribe, en el propio proceso host.

## Why doc-positivize

El nombre une el ámbito y la acción: documentación, positivizada. La guarda aplica esa regla en cada petición al modelo; `/positivize` la aplica a los artefactos existentes.

La regla del proyecto de referencia es **la ausencia es negación; lo afirmativo es el estándar**.

## The guard contract

La guarda integrada está en inglés, como todas las secciones del prompt, y pasa el escaneo de marcadores con cero coincidencias:

- **Solo el estado final**: código, comentarios, títulos y descripciones de commit y MR/PR, documentación y prompts describen el diseño vigente como si siempre hubiera sido así.
- **La ausencia es negación**: cuando una función, comportamiento o plan anterior sale del diseño, su descripción sale con él; queda solo el diseño aceptado.
- **Lo afirmativo es el estándar**: reglas, prompts, esquemas de herramientas y comentarios declaran la única práctica positiva y su condición; las herramientas y conceptos sustituidos se eliminan.

`tests/guard.test.ts` fija ese contrato: el texto por defecto pasa los patrones de marcadores con cero coincidencias, permanece en inglés y mantiene las llaves literales.

## The /positivize command

```text
/positivize                  reescribe el espacio de trabajo actual como descripciones positivas
/positivize README*.md       reescribe los archivos de ese alcance como descripciones positivas
```

En la GUI web, el comando recorre el alcance con la lista de marcadores, pide al modelo actual de la sesión un plan mínimo de edición en JSON para cada archivo, aplica las ediciones in situ y devuelve el control de inmediato para que el compositor se vacíe. Su tarjeta de resultado incluye el diff estructurado, un botón **Stop** mientras el barrido corre y un botón **Undo** en cada archivo modificado. El barrido queda fuera del historial del modelo, así que la conversación actual conserva su contexto intacto.

Los hosts sin servicio Connection (CLI y headless) usan la ruta en primer plano: el comando espera al barrido y devuelve el informe de texto completo.

El barrido está limitado por `maxFiles`, `maxFileBytes` y `timeoutMs`; el informe enumera los archivos que quedan para otra ejecución. Respeta las excepciones del proyecto de referencia (lógica de programa y aserciones de pruebas, avisos Semver de SDK públicos, límites de alto riesgo reescritos como precondiciones positivas y coincidencias literales de entrada del usuario). Edita los archivos directamente y no ejecuta una suite de pruebas: ejecuta las pruebas del proyecto después de un barrido que cambie código.

## Result card, undo, and stop

La tarjeta de resultado renderiza un diff unificado propio con cabeceras de hunk, números de línea y los colores de añadido/eliminado del tema. Abre el primer archivo modificado y pliega el resto; cada fila muestra los recuentos `+added` / `-deleted`.

- **Stop** aborta el barrido en curso. Los archivos ya modificados siguen listados y conservan su botón Undo; no empieza ninguna petición al modelo ni escritura nueva.
- **Undo** restaura ese archivo a su contenido previo al barrido. Se niega a sobrescribir un archivo cuyo contenido actual ya no coincide con la salida del barrido, y nunca acepta una ruta que la ejecución no haya registrado.
- Solo se puede deshacer después de que el barrido termine. No hay deshacer masivo ni rehacer.
- Un barrido sin cambios se pliega en una sola línea compacta en lugar de una tarjeta vacía.
- El estado de la ejecución vive en el proceso Host: tras reiniciar el Host, la tarjeta vuelve al resumen compacto del comando y no ofrece acciones.

La tarjeta usa tres rutas exactas y autenticadas como owner que sirve Connection: `GET /api/doc-positivize.state?runId=…`, `POST /api/doc-positivize.cancel` y `POST /api/doc-positivize.undo`. La petición de deshacer solo selecciona un archivo que la ejecución ya cambió; no puede introducir un destino de escritura nuevo.

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.2-rc.1`; cualquier línea 0.2.x con `systemPrompt.section()`, `ctx.commands` y `ctx.llm` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Services | `systemPrompt`, `commands` y `llm`, todos en `@deepseek-ai/dsh-base`; el `connection` opcional habilita las rutas Stop/Undo de la tarjeta |
| Client | GUI web: el paquete trae una tarjeta `dsh.client` y la tarjeta de resultado de `/positivize` para la página de Plugins |
| Runtime imports | `@deepseek-ai/schemastery` |
| Config | esquema Schemastery `Config`; los valores inválidos fallan al cargar |

## Install

El repositorio incluye los puntos de entrada ya construidos, así que instalar desde Git es un solo paso y no requiere permiso de compilación:

```sh
# instalar directamente desde GitHub, sin aprobar allowBuilds
dsh plugin --profile <profile> add github:graydovee/dsh-doc-positivize

# confirma que la fila del bundle se monta
dsh --profile <profile> --dump-config | grep dsh-doc-positivize
```

En la página web **Plugins**, pega `github:graydovee/dsh-doc-positivize` (o la URL del repositorio) en **Añadir plugin** para la misma instalación. Para trabajar sobre las fuentes o instalar un tarball sin conexión:

```sh
pnpm install
pnpm build          # regenera lib/; commitéalo junto al cambio de fuentes
pnpm pack --pack-destination ./.pack

# una especificación local debe ser una ruta absoluta
dsh plugin --profile <profile> add "$PWD/.pack/dsh-doc-positivize-0.1.0-alpha.12.tgz"
```

Un `dsh plugin add` correcto también registra el paquete en `dsh.profile.bundles`; reinicia la aplicación (o recarga el perfil) para activarlo.

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `guardEnabled` | boolean | `true` | monta la sección permanente de la guarda |
| `guard` | string | guarda integrada en inglés | sustituye toda la sección |
| `extra` | string | `""` | guía del proyecto añadida tras una línea en blanco |
| `command` | boolean | `true` | registra el comando `/positivize` |
| `ignoredPaths` | string[] | lista integrada | nombres, rutas o globs que el barrido omite |
| `maxFiles` | number | `12` | máximo de archivos candidatos por barrido |
| `maxFileBytes` | number | `96000` | máximo de bytes de un archivo enviado al modelo |
| `timeoutMs` | number | `180000` | presupuesto de tiempo por barrido, en milisegundos |
| `auditEnabled` | boolean | `true` | escribe la traza de auditoría en el DSH home; `false` desactiva toda la E/S de auditoría |
| `auditRuns` | integer | `20` | ejecuciones más recientes que se conservan; los directorios anteriores se eliminan |

## Audit trail

El barrido conserva en el plugin una traza de auditoría de cada petición al modelo que hace. Los registros viven en `${DSH_HOME:-~/.dsh}/doc-positivize/runs/<runId>/`: `run.jsonl` guarda un registro por línea y `blobs/` almacena las cargas direccionadas por contenido. Los archivos tienen modo `0600` y el directorio de la ejecución `0700`.

Cada ejecución registra:

- el texto de las reglas del barrido una vez, para que cada prompt se pueda reconstruir desde la traza;
- los bytes exactos previos a la edición de cada archivo enviado al modelo, con su blob, `sha256` y número de bytes;
- el sobre de la petición: proveedor, modelo, `maxTokens`, `reasoningEffort` e intento;
- la salida en bruto del modelo como blob con su `sha256`;
- el recuento de ediciones analizadas y las ediciones aplicadas u omitidas por archivo;
- el uso de tokens y los tiempos cuando el proveedor los entrega;
- el estado final —`done`, `cancelled` o `failed`— con el texto del error si falla.

La traza es estado del plugin, no eventos del registro de sesión: los plugins externos no tienen hoy una vía pública para escribir tipos de evento de sesión propios, porque el vocabulario de eventos conocidos se genera dentro del repositorio, `session.append` no expone el sobre `ignorable` y `appendPluginRecord` queda dentro de los paquetes experimentales del repositorio. El plugin es dueño de estos archivos y de su retención.

La retención conserva las `auditRuns` ejecuciones más recientes (por defecto `20`); una nueva ejecución elimina los directorios de ejecución anteriores al empezar.

La auditoría está activa por defecto. Con ella activa, el contenido de los archivos se escribe en el DSH home del usuario con modo `0600` y bajo el límite de retención. Configura `auditEnabled: false` para desactivar toda la E/S de auditoría.

## Settings

El paquete incluye una tarjeta de configuración web, así que el interruptor de la guarda y la lista de ignorados se editan sin tocar `cordis.patch.yml`:

- abre Ajustes → **Doc Positivize**;
- **Enable the doc-positivize guard** activa o desactiva la regla permanente;
- **Ignored files and directories** es un editor multilínea, un nombre, ruta o glob por línea, para poder pegar una lista completa; **Save** escribe la entrada del perfil y **Restore defaults** vuelve a la lista integrada.

Los resultados del barrido permiten deshacer por archivo; un barrido en curso se puede detener desde su tarjeta. Ambas acciones solo están disponibles mientras el Host conserve la ejecución.

La lista integrada es `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.pnpm-store`, `.pnpm-cache`, `.pack`, `target`, `vendor`, `.venv`, `__pycache__` y los lockfiles de pnpm, npm, yarn y bun. Un archivo nombrado explícitamente se recorre aunque su directorio esté en la lista.

## Where it applies

La orden `6000` ocupa la banda vacía `5000`–`9000`: después de las secciones de herramientas y antes del bloque de entregables y entorno. La sección es global y su texto es estático, así que conserva la caché de prefijo; cuesta unos 210 tokens por petición. Las llamadas al modelo del barrido ocurren en el proceso host y no entran en la conversación, que solo paga el ciclo de vida del comando.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test          # pruebas unitarias e integración con SystemPrompt y Commands reales
pnpm smoke:built   # compila y monta lib/index.js en los registros reales
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js check --cwd .
```

`check` informa una advertencia: `packageManager` (`pnpm@10.34.6` local frente a `pnpm@11.7.0`).

`0.1.0` es la primera versión publicada. Las compilaciones locales de depuración usan el sufijo `-alpha.N` de la siguiente versión (por ejemplo `0.1.0-alpha.1`) y nunca se presentan como versiones publicadas.

## Verify

`dsh-plugin-dev verify` empaqueta e instala en un `DSH_HOME` temporal. Sus valores por defecto apuntan a harness `0.1.5`, que la comprobación de compatibilidad de `0.2.2-rc.1` rechaza, así que fija ambos paquetes:

```sh
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js verify --cwd . \
  --base @deepseek-ai/dsh-base@0.2.2-rc.1 \
  --headless @deepseek-ai/dsh-headless@0.2.2-rc.1
```

Así pasan `pack`, `install` y `--dump-config`. El smoke sin credenciales termina en `TRANSPORT: DeepSeek Messages transport failed`; el arranque escribe el prompt como evento `system/message`: busca allí la guarda.

## Attribution

La guarda y el flujo de barrido se adaptan del proyecto de referencia [ox01024/pink-elephant](https://github.com/ox01024/pink-elephant) (MIT, Copyright © 2026 ox01024). Véase [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache-2.0. Consulta [LICENSE](LICENSE).
