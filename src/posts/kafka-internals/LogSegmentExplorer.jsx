import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Section 1 — the log on disk.
 *
 * A partition directory holds segments: 00000000000000000000.log plus a sparse
 * .index (offset → byte position) and .timeindex. This walks the real lookup
 * path: pick segment by base offset, binary-search the sparse index, then scan
 * forward through the log from that byte position.
 */

const SEG_SIZE   = 8      // records per segment
const NUM_SEG    = 3
const INDEX_EVERY = 4     // one index entry per 4 records (index.interval.bytes analogue)

function buildPartition() {
  let position = 0
  const segments = []
  for (let s = 0; s < NUM_SEG; s++) {
    const baseOffset = s * SEG_SIZE
    const records = []
    position = 0
    for (let i = 0; i < SEG_SIZE; i++) {
      const size = 48 + ((i * 37) % 5) * 16
      records.push({
        offset: baseOffset + i,
        relative: i,
        position,
        size,
        key: ['user-42', 'order-991', 'cart-3', 'sku-88'][(baseOffset + i) % 4],
      })
      position += size
    }
    const index = records
      .filter(r => r.relative % INDEX_EVERY === 0)
      .map(r => ({ relative: r.relative, position: r.position }))
    segments.push({ baseOffset, records, index, bytes: position })
  }
  return segments
}

function pad(n) {
  return String(n).padStart(20, '0')
}

export default function LogSegmentExplorer() {
  const segments = useMemo(buildPartition, [])
  const [target, setTarget] = useState(13)
  const [steps, setSteps]   = useState([])
  const [cursor, setCursor] = useState(-1)
  const timer = useRef(null)

  const maxOffset = NUM_SEG * SEG_SIZE - 1

  const lookup = () => {
    const segIdx = segments.reduce((best, s, i) => (s.baseOffset <= target ? i : best), 0)
    const seg    = segments[segIdx]
    const rel    = target - seg.baseOffset
    const entry  = [...seg.index].reverse().find(e => e.relative <= rel) ?? seg.index[0]
    const from   = seg.records.find(r => r.relative === entry.relative)
    const hit    = seg.records.find(r => r.offset === target)
    const scanned = rel - entry.relative + 1

    const plan = [
      {
        text: `open partition dir → segment base offsets [${segments.map(s => s.baseOffset).join(', ')}]`,
        seg: null, entry: null, scan: [],
      },
      {
        text: `binary search base offsets: ${target} lands in ${pad(seg.baseOffset)}.log`,
        seg: segIdx, entry: null, scan: [],
      },
      {
        text: `binary search ${pad(seg.baseOffset)}.index for largest relative offset ≤ ${rel} → entry (${entry.relative} → byte ${entry.position})`,
        seg: segIdx, entry: entry.relative, scan: [],
      },
      {
        text: `seek to byte ${from.position} in the .log, then scan forward ${scanned} record${scanned === 1 ? '' : 's'}`,
        seg: segIdx, entry: entry.relative,
        scan: seg.records.filter(r => r.relative >= entry.relative && r.relative <= rel).map(r => r.offset),
      },
      {
        text: `offset ${target} found at byte ${hit.position} (key=${hit.key}, ${hit.size} bytes) — ${scanned} records read, not ${target + 1}`,
        seg: segIdx, entry: entry.relative, scan: [target], done: true,
      },
    ]

    setSteps(plan)
    setCursor(0)
  }

  useEffect(() => {
    if (cursor < 0 || cursor >= steps.length - 1) return
    timer.current = setTimeout(() => setCursor(c => c + 1), 950)
    return () => clearTimeout(timer.current)
  }, [cursor, steps])

  const state = cursor >= 0 ? steps[cursor] : { seg: null, entry: null, scan: [] }
  const activeSeg = state.seg == null ? null : segments[state.seg]

  return (
    <div className="viz-card">
      <p className="viz-title">↳ offset lookup on disk</p>

      <div className="slider-row">
        <span className="slider-label">seek to offset</span>
        <input
          type="range" min="0" max={maxOffset} value={target}
          onChange={e => { setTarget(Number(e.target.value)); setCursor(-1); setSteps([]) }}
          className="flex-1 accent-blue-600"
        />
        <span className="slider-value">{target}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-sim-accent" onClick={lookup}>run lookup</button>
        <button className="btn-sim" onClick={() => { setCursor(-1); setSteps([]) }}>reset</button>
      </div>

      {/* Segment files */}
      <div className="grid gap-2 mb-4">
        {segments.map((s, i) => (
          <div
            key={s.baseOffset}
            className={`k-panel transition-all duration-300 ${state.seg === i ? 'k-panel-active' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] text-zinc-500">
                {pad(s.baseOffset)}.log
                <span className="text-zinc-300"> · </span>
                {pad(s.baseOffset)}.index
                <span className="text-zinc-300"> · </span>
                {pad(s.baseOffset)}.timeindex
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                offsets {s.baseOffset}–{s.baseOffset + SEG_SIZE - 1} · {s.bytes} B
              </span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {s.records.map(r => {
                const scanning = state.scan?.includes(r.offset)
                const isIndexed = r.relative % INDEX_EVERY === 0
                const isEntry = state.seg === i && state.entry === r.relative
                return (
                  <div
                    key={r.offset}
                    className={`w-[52px] h-11 k-chip ${
                      scanning ? 'k-chip-hl' : isEntry ? 'k-chip-ok' : isIndexed ? 'font-semibold' : ''
                    }`}
                    title={`offset ${r.offset} @ byte ${r.position}`}
                  >
                    <span className="font-mono text-[9px] font-semibold">{r.offset}</span>
                    <span className="font-mono text-[8px] opacity-70">@{r.position}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Index file view */}
      {activeSeg && (
        <div className="k-panel mb-4">
          <p className="font-mono text-[10px] k-muted mb-2">
            {pad(activeSeg.baseOffset)}.index — sparse, {activeSeg.index.length} entries for {SEG_SIZE} records
          </p>
          <div className="flex gap-2 flex-wrap">
            {activeSeg.index.map(e => (
              <span
                key={e.relative}
                className={`k-tag transition-all ${state.entry === e.relative ? 'k-tag-ok' : ''}`}
              >
                rel {e.relative} → byte {e.position}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="sim-log">
        {steps.length === 0 && <div className="text-zinc-500">-- pick an offset, press run lookup</div>}
        {steps.slice(0, cursor + 1).map((s, i) => (
          <div key={i} className={`py-px ${s.done ? 'text-emerald-400' : 'text-sky-400'}`}>
            {i + 1}. {s.text}
          </div>
        ))}
      </div>
    </div>
  )
}
