/**
 * Small hand-rolled SVG line chart shared by the simulators in this post.
 * `series` = [{ key, className }], drawn in order over `data` (array of rows).
 * `hlines` = [{ y, className, label }], `vmarks` = [{ x, className, label }]
 * where x is an index into `data`'s x-domain (`xKey`).
 */
export function LineChart({
  data, series, xKey = 't', xDomain, yMax, hlines = [], vmarks = [], label, ariaLabel,
  width = 660, height = 190, yFmt = v => Math.round(v),
}) {
  const padding = { top: 12, right: 16, bottom: 24, left: 44 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const x0 = xDomain ? xDomain[0] : (data[0]?.[xKey] ?? 0)
  const x1 = xDomain ? xDomain[1] : Math.max(data[data.length - 1]?.[xKey] ?? 1, x0 + 1)
  const top = yMax ?? Math.max(1, ...data.flatMap(d => series.map(s => d[s.key])), ...hlines.map(h => h.y)) * 1.1
  const x = v => padding.left + ((v - x0) / (x1 - x0)) * plotW
  const y = v => padding.top + (1 - Math.min(v, top) / top) * plotH
  const line = key => data.map(d => `${x(d[xKey]).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel || label}>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} className="sim-chart-grid" />
          <text x={padding.left - 6} y={padding.top + f * plotH + 3} textAnchor="end" className="sim-chart-label">{yFmt(top * (1 - f))}</text>
        </g>
      ))}
      {vmarks.filter(m => m.x >= x0 && m.x <= x1).map((m, i) => (
        <g key={`v${i}`}>
          <line x1={x(m.x)} x2={x(m.x)} y1={padding.top} y2={padding.top + plotH} className={m.className || 'sim-chart-trigger'} />
          {m.label && <text x={x(m.x) + (m.anchor === 'end' ? -4 : 4)} y={padding.top + 10 + (m.dy || 0)} textAnchor={m.anchor || 'start'} className="sim-chart-label">{m.label}</text>}
        </g>
      ))}
      {hlines.map((h, i) => (
        <g key={`h${i}`}>
          <line x1={padding.left} x2={width - padding.right} y1={y(h.y)} y2={y(h.y)} className={h.className || 'sim-chart-threshold'} />
          {h.label && <text x={width - padding.right} y={y(h.y) - 4} textAnchor="end" className="sim-chart-label">{h.label}</text>}
        </g>
      ))}
      {data.length > 1 && series.map(s => <polyline key={s.key} points={line(s.key)} className={s.className} />)}
      {label && <text x={padding.left} y={height - 5} className="sim-chart-label">{label}</text>}
    </svg>
  )
}

/** Tiny axis-free sparkline for the incident cards. */
export function Sparkline({ values, className = 'sim-chart-line', max, width = 220, height = 48, mark }) {
  const top = max ?? Math.max(1, ...values) * 1.1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - (v / top) * (height - 4)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height }} aria-hidden="true">
      {mark != null && <line x1={(mark / (values.length - 1)) * width} x2={(mark / (values.length - 1)) * width} y1={0} y2={height} className="sim-chart-trigger" />}
      <polyline points={pts} className={className} style={{ strokeWidth: 2 }} />
    </svg>
  )
}

/** Colors for simulator marks, as CSS values that follow the theme. */
export const C = {
  idle: 'var(--border)',
  accent: 'var(--accent)',
  ok: 'var(--green)',
  warn: '#f59e0b',
  bad: '#ef6b73',
}
