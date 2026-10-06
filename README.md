# context-meter

Una banda sobre el prompt de Claude Code que te dice, de un vistazo, **cuánto contexto llevas usado**, **qué lo ocupa** y **cuánto has gastado en la sesión**.

```
██░░░░░░░░░░░░  5%  51k / 1M │ Msgs 215 · Tools 37k · Skills 7k · System 4k · Agents 2k · MCP 631   ▂█▃▂▂▁   ● in 12    cache read 281k
 (barra + marca de compactación)   (categorías, cada una de su color)   (gráfica)   ● out 601  cache write 17k
```

## Qué muestra

| Pieza | Qué es |
| --- | --- |
| **Barra** | Contexto usado sobre el total de la ventana. La línea blanca fina marca el punto en el que Claude compactará solo. |
| **Porcentaje y tokens** | `5%  51k / 1M`: lo usado y el tamaño de la ventana. |
| **Categorías** | Lo que ocupa cada cosa, en el mismo orden siempre: `Msgs`, `Tools`, `Skills`, `System`, `Agents` y, si existen, `MCP` y `Memory`. Cada una con su color. |
| **Gráfica** | Una barra por categoría, con su mismo color y orden. La altura usa raíz cuadrada para que las pequeñas se distingan. |
| **in / out** | Tokens gastados en la sesión: entrada y salida, con la caché leída y escrita al lado. Incluye lo que cuesta el resumen cuando se compacta. |

## Instalación

Es una carpeta: no hace falta instalar nada más.

```sh
git clone https://github.com/Penedodp/context-meter ~/.claude/skills/context-meter
```

(en Windows, la carpeta de destino es `C:\Users\<tu usuario>\.claude\skills\context-meter\`; también sirve descargar el zip y copiarla ahí.)

Después abre una sesión nueva de Claude Code. La banda aparece sola.

Para actualizar más adelante: `git pull` dentro de esa carpeta.

Probado con Claude Code 2.1.291 en terminal.

## Uso

- Se muestra por defecto.
- **`/ctx`** la oculta; otro `/ctx` la vuelve a mostrar. Al abrir una sesión nueva siempre empieza visible.

## Ajustar cuándo se compacta

El plugin no decide eso, lo decide Claude Code. Para elegir tú el punto, añade esto a `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "500000"
  }
}
```

El valor son tokens (entre 100 000 y 1 000 000) y se aplica al abrir una sesión nueva. La marca blanca de la barra se mueve sola a ese punto.

## Personalizarlo

Los ajustes visuales están al principio de `hooks/register.tsx`:

| Constante | Qué cambia |
| --- | --- |
| `METER_COLUMNS` | Ancho de la barra de contexto. |
| `BAR_WIDTH` | Ancho de cada barra de la gráfica. |
| `CHART_ROWS` | Alto de la gráfica. Con `1` la banda ocupa una fila menos. |
| `BLOCK_GAP` | Separación entre la gráfica y el bloque in/out. |
| `COLORS` | Color de cada categoría. |

Tras editar, escribe `/reload-plugins` o abre una sesión nueva.

## Limitaciones

- Solo se dibuja en el **terminal**. En escritorio o VS Code no hace nada.
- Se ve mejor en un terminal con colores de 24 bits.
- El acumulado `in / out` cuenta **desde que se carga el plugin**: si recargas a mitad de sesión, empieza de cero. No cuenta los subagentes.
- Si el terminal es estrecho, las categorías se recortan por la derecha (primero `Memory` y `MCP`).
- El desglose por categorías son estimaciones del propio Claude Code, igual que `/context`.

## Licencia

[MIT](LICENSE) © Penedo

## Estructura

```
context-meter/
├── .claude-plugin/plugin.json   manifiesto
├── hooks/
│   ├── hooks.json               apunta al módulo
│   └── register.tsx             todo el código
├── types/index.d.ts             tipos del estado de la sesión
├── LICENSE
└── README.md
```

## Desarrollo

```sh
claude plugin validate .         # comprueba el manifiesto y los hooks
npx -p typescript tsc -p . --noEmit   # tipos (necesita el tsconfig que genera Claude Code al cargar el mod)
```
