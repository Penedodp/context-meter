// context-meter: una banda sobre el prompt con lo que ocupa el contexto y cuánto llevas gastado.
// /ctx la oculta o la vuelve a mostrar.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Row, Totals, Usage } from '../types'

// ─── Estado de la sesión ─────────────────────────────────────────────────────

const usage = atom(
  { plugin: 'context-meter', key: 'usage' } as const,
  { percent: null, tokens: null, window: null, compactAt: null } as Usage,
)
const totals = atom(
  { plugin: 'context-meter', key: 'totals' } as const,
  { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } as Totals,
)
const rows = atom({ plugin: 'context-meter', key: 'rows' } as const, null as Row[] | null)
const visible = atom({ plugin: 'context-meter', key: 'visible' } as const, true)

// ─── Ajustes visuales (tócalos aquí) ─────────────────────────────────────────

const METER_COLUMNS = 14 // ancho de la barra de contexto
const BAR_WIDTH = 3 // ancho de cada barra de la gráfica
const CHART_ROWS = 2 // alto de la gráfica; con 1 la banda ocupa una fila menos
const BLOCK_GAP = 2 // aire entre la gráfica y el bloque in/out
const RIGHT_MARGIN = 8 // sitio que se queda libre a la derecha (botón [-] del motor)
const SEPARATOR = ' · '
const DIVIDER = '  │  '

// Colores como 0xRRGGBB
const OCHRE = 0xd97757
const TRACK = 0x3a3a3a
const WHITE = 0xf2f2f2
const GRAY = 0x8a8f98
const TERMINAL_DEFAULT = 0x01000000

// ─── Categorías: nombre corto, color y orden ─────────────────────────────────

// El desglose del motor trae nombres largos; los acortamos por lo que contienen.
const SHORT_NAMES: [contains: string, label: string][] = [
  ['message', 'Msgs'],
  ['system tools', 'Tools'],
  ['system prompt', 'System'],
  ['skill', 'Skills'],
  ['agent', 'Agents'],
  ['mcp', 'MCP'],
  ['memory', 'Memory'],
]

const COLORS: Record<string, number> = {
  Msgs: 0xd97757,
  Tools: 0x5b9bd5,
  Skills: 0x7bc47f,
  System: 0xb58ae0,
  Agents: 0xe5c95f,
  MCP: 0x4fc1c1,
  Memory: 0xe07ba3,
}
const OTHER_COLOR = 0x9aa0a6

// Orden fijo. Las del núcleo salen siempre (con 0 si faltan); las extra, solo si existen.
const CORE = ['Msgs', 'Tools', 'Skills', 'System', 'Agents']
const EXTRA = ['MCP', 'Memory']

const shortName = (name: string) => {
  const lower = name.toLowerCase()
  const match = SHORT_NAMES.find(([contains]) => lower.includes(contains))

  return match?.[1] ?? name.split(' ')[0] ?? name
}

type Category = { name: string; tokens: number }

// Suma por nombre corto y devuelve las categorías en el orden fijo.
const orderedCategories = (list: Row[]): Category[] => {
  const byName = new Map<string, number>()

  for (const row of list) {
    if (row.kind === 'used') {
      const name = shortName(row.name)
      byName.set(name, (byName.get(name) ?? 0) + row.tokens)
    }
  }

  const rest = [...byName.keys()].filter(n => !CORE.includes(n) && !EXTRA.includes(n)).sort()
  const names = [...CORE, ...EXTRA.filter(n => byName.has(n)), ...rest]

  return names.map(name => ({ name, tokens: byName.get(name) ?? 0 }))
}

// ─── Formato ─────────────────────────────────────────────────────────────────

const k = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`

// ─── Dibujo de la barra y la gráfica (Raster) ────────────────────────────────

type Cell = [glyph: number, foreground: number, background: number]

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const base64 = (bytes: Uint8Array) => {
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += (ALPHABET[(n >> 18) & 63] ?? '') + (ALPHABET[(n >> 12) & 63] ?? '')
    out += i + 1 < bytes.length ? (ALPHABET[(n >> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (ALPHABET[n & 63] ?? '') : '='
  }

  return out
}

// Raster pide las celdas (carácter, color, fondo) en filas, empaquetadas en base64.
const pack = (cells: Cell[]) => base64(new Uint8Array(Uint32Array.from(cells.flat()).buffer))

const FULL_BLOCK = 0x2588
const HALF_BLOCK = 0x258c
const MARK_GLYPH = 0x258f // línea fina a la izquierda de la celda
const EIGHTHS = [0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588] // ▁ … █

// Barra de contexto: tramo usado en ocre, el resto en gris, y una marca donde se compacta.
const meter = (percent: number | null, markAt: number | null) => {
  const filled = ((percent ?? 0) / 100) * METER_COLUMNS
  const whole = Math.floor(filled)
  const hasHalf = filled - whole >= 0.5
  const cells: Cell[] = []

  for (let col = 0; col < METER_COLUMNS; col++) {
    const cell: Cell =
      col < whole
        ? [FULL_BLOCK, OCHRE, OCHRE]
        : col === whole && hasHalf
          ? [HALF_BLOCK, OCHRE, TRACK]
          : [FULL_BLOCK, TRACK, TRACK]

    cells.push(col === markAt ? [MARK_GLYPH, WHITE, cell[2]] : cell)
  }

  return pack(cells)
}

// Una barra vertical por categoría. La altura usa la raíz cuadrada para que las pequeñas se vean.
const chart = (items: { tokens: number; color: number }[]) => {
  const max = Math.max(1, ...items.map(item => item.tokens))
  const levels = EIGHTHS.length * CHART_ROWS
  const heights = items.map(item =>
    item.tokens > 0 ? Math.max(1, Math.round(Math.sqrt(item.tokens / max) * levels)) : 0,
  )
  const cells: Cell[] = []

  for (let row = 0; row < CHART_ROWS; row++) {
    const below = (CHART_ROWS - 1 - row) * EIGHTHS.length // niveles que ya llenan las filas de abajo

    items.forEach((item, n) => {
      const fill = Math.min(EIGHTHS.length, Math.max(0, (heights[n] ?? 0) - below))
      const cell: Cell =
        fill === 0
          ? [0x20, TERMINAL_DEFAULT, TERMINAL_DEFAULT]
          : [EIGHTHS[fill - 1] ?? FULL_BLOCK, item.color, TERMINAL_DEFAULT]

      for (let w = 0; w < BAR_WIDTH; w++) {
        cells.push(cell)
      }
    })
  }

  return pack(cells)
}

// ─── Bloque in / out (dos filas, valores alineados) ──────────────────────────

const totalsBlock = (sum: Totals) => {
  const input = k(sum.input)
  const output = k(sum.output)
  const width = Math.max(input.length, output.length)
  const inCache = `cache read ${k(sum.cacheRead)}`
  const outCache = `cache write ${k(sum.cacheWrite)}`

  return {
    inLine: input.padEnd(width) + '  ' + inCache,
    outLine: output.padEnd(width) + '  ' + outCache,
    // punto + espacio, "out " y las dos columnas
    width: BLOCK_GAP + 2 + 4 + width + 2 + Math.max(inCache.length, outCache.length),
  }
}

// ─── Datos ───────────────────────────────────────────────────────────────────

const addUsage = (t: Totals, u: ModelUsage): Totals => ({
  input: t.input + u.input_tokens,
  cacheRead: t.cacheRead + u.cache_read_input_tokens,
  cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
  output: t.output + u.output_tokens,
})

// Pide al motor el reparto del contexto por categorías. Si no puede, deja lo último que había.
const refreshRows = async ($: EngineInterface) => {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const list = context.breakdown?.categories

    if (list) {
      await update($, rows, () => list.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })))
    }
  } catch {
    // sin desglose no pasa nada: se queda el anterior
  }
}

// ─── El mod ──────────────────────────────────────────────────────────────────

export const register: Register = on => {
  let compactAt: number | null = null // tokens a los que se compacta solo; null si no se sabe
  let askedForWindow = 0

  // Cada vez que cambia el contexto: guarda porcentaje y tokens (y el umbral de compactación).
  on('session.measure', async ($, e, next) => {
    const { percent, tokens, window } = e.context

    if (askedForWindow !== window) {
      askedForWindow = window
      try {
        const full = await $.session.usage({ breakdown: 'summary' })
        compactAt = full.context.breakdown?.autoCompactThreshold ?? null
      } catch {
        compactAt = null
      }
    }

    await update($, usage, () => ({
      percent: percent ?? null,
      tokens: tokens ?? null,
      window,
      compactAt,
    }))

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ctx',
      description: 'Muestra u oculta el medidor de contexto',
    })
    await refreshRows($)

    return next(e)
  })

  on('command.run', { command: 'ctx' }, async $ => {
    const isVisible = !(await read($, visible))

    if (isVisible) {
      await refreshRows($)
    }
    await update($, visible, () => isVisible)

    return { text: isVisible ? 'Medidor de contexto visible.' : 'Medidor de contexto oculto.' }
  })

  // Suma lo que gasta cada turno del hilo principal (los subagentes no cuentan).
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage) {
      const turnUsage = e.usage
      await update($, totals, t => addUsage(t, turnUsage))
    }
    await refreshRows($)

    return next(e)
  })

  // Compactar también gasta tokens (el resumen): se suman al acumulado.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    try {
      if (!e.agentId && result.messages) {
        const summaryUsage = result.usage
        if (summaryUsage) {
          await update($, totals, t => addUsage(t, summaryUsage))
        }
        await refreshRows($)
      }
    } catch {
      // contar es secundario: un fallo aquí nunca debe afectar a la compactación
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal' || !(await read($, visible))) {
      return next(e)
    }

    const { percent, tokens, window, compactAt: markTokens } = await read($, usage)
    const categories = orderedCategories((await read($, rows)) ?? [])
    const block = totalsBlock(await read($, totals))
    const { Box, Raster, Text } = $.ui.resolve(e)

    const markAt =
      markTokens != null && window !== null
        ? Math.min(METER_COLUMNS - 1, Math.floor((markTokens / window) * METER_COLUMNS))
        : null
    const head = percent === null ? '--' : `${percent}%`
    const tail = tokens === null || window === null ? '  sin datos aún' : `  ${k(tokens)} / ${k(window)}`

    // Las categorías van de izquierda a derecha mientras quepan en el ancho del terminal.
    const GAPS = 3 * 2 // los 3 huecos de 2 columnas entre barra, texto, gráfica y bloque
    let room =
      (e.viewport?.columns ?? 100) -
      (METER_COLUMNS + head.length + tail.length + DIVIDER.length + GAPS) -
      (categories.length * BAR_WIDTH) -
      block.width -
      RIGHT_MARGIN
    const shown: { label: string; tokens: number; color: number }[] = []

    for (const { name, tokens: amount } of categories) {
      const label = `${name} ${k(amount)}`

      if (label.length + SEPARATOR.length > room) {
        break
      }
      room -= label.length + SEPARATOR.length
      shown.push({ label, tokens: amount, color: COLORS[name] ?? OTHER_COLOR })
    }

    return (
      <Box gap={2} alignItems="flex-end">
        <Raster key="meter" columns={METER_COLUMNS} rows={1} cells={meter(percent, markAt)} />
        <Text>
          <Text bold color={hex(OCHRE)}>{head}</Text>
          <Text dimColor>{tail}</Text>
          {shown.length > 0 && <Text dimColor>{DIVIDER}</Text>}
          {shown.map((item, n) => (
            <Text>
              {n > 0 && <Text dimColor>{SEPARATOR}</Text>}
              <Text color={hex(item.color)}>{item.label}</Text>
            </Text>
          ))}
        </Text>
        {shown.length > 0 && (
          <Raster
            key="chart"
            columns={shown.length * BAR_WIDTH}
            rows={CHART_ROWS}
            cells={chart(shown)}
          />
        )}
        <Box flexDirection="column" marginLeft={BLOCK_GAP}>
          <Text>
            <Text color={hex(GRAY)}>● </Text>
            <Text color={hex(WHITE)}>in </Text>
            <Text color={hex(GRAY)}>{block.inLine}</Text>
          </Text>
          <Text>
            <Text color={hex(GRAY)}>● </Text>
            <Text color={hex(WHITE)}>out </Text>
            <Text color={hex(GRAY)}>{block.outLine}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
