// Tipos del estado de la sesión de context-meter.

/** Lo último que midió el motor sobre la ventana de contexto. */
export type Usage = {
  percent: number | null
  tokens: number | null
  window: number | null
  /** Tokens a los que se compacta solo; null si no se sabe o está desactivado. */
  compactAt: number | null
}

/** Gasto acumulado de la sesión, en tokens. */
export type Totals = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** Una fila del desglose de /context. */
export type Row = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      usage: Usage
      totals: Totals
      rows: Row[] | null
      visible: boolean
    }
  }
}
