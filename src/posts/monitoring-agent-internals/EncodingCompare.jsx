import { useState } from 'react'

/**
 * Section 3 — JSON vs MessagePack, same struct.
 *
 * Numbers are generalized benchmark figures (go test -bench style), not
 * pulled from a real system, but the ratios are representative: reflection +
 * text encoding costs roughly 5-7x the CPU and 3-4x the payload bytes of a
 * binary encoding for the same data, and the gap widens as the struct
 * grows nested fields.
 */

const PROFILES = {
  flat: {
    label: 'flat struct (6 fields)',
    fields: ['host string', 'timestamp int64', 'cpu_pct float64', 'mem_bytes uint64', 'tags map[string]string (2 keys)'],
    json:      { bytes: 340,  encodeNs: 2840,  decodeNs: 3600,  encodeB: 512,  decodeB: 768,  allocs: 9 },
    msgpack:   { bytes: 96,   encodeNs: 410,   decodeNs: 520,   encodeB: 64,   decodeB: 96,   allocs: 1 },
  },
  nested: {
    label: 'nested struct (per-core CPU + tags + labels)',
    fields: ['host string', 'timestamp int64', 'cpu_per_core []float64 (16)', 'mem_bytes uint64', 'tags map[string]string (8 keys)', 'labels []string (5)'],
    json:      { bytes: 1380, encodeNs: 11200, decodeNs: 13400, encodeB: 2048, decodeB: 2560, allocs: 34 },
    msgpack:   { bytes: 410,  encodeNs: 1650,  decodeNs: 1980,  encodeB: 256,  decodeB: 320,  allocs: 4 },
  },
}

function fmt(n) { return n.toLocaleString('en-US') }

function BarRow({ label, jsonVal, msgpackVal, unit = '', maxOverride }) {
  const max = maxOverride ?? Math.max(jsonVal, msgpackVal)
  const jsonPct = Math.round((jsonVal / max) * 100)
  const msgpackPct = Math.round((msgpackVal / max) * 100)
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="font-mono text-[11px] viz-muted">{label}</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[10px] viz-muted w-16 shrink-0">JSON</span>
        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
          <div className="h-full rounded-full" style={{ width: `${jsonPct}%`, background: '#ef6b73' }} />
        </div>
        <span className="font-mono text-[10px] viz-strong w-24 text-right shrink-0">{fmt(jsonVal)}{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] viz-muted w-16 shrink-0">MsgPack</span>
        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
          <div className="h-full rounded-full" style={{ width: `${msgpackPct}%`, background: 'var(--green)' }} />
        </div>
        <span className="font-mono text-[10px] viz-strong w-24 text-right shrink-0">{fmt(msgpackVal)}{unit}</span>
      </div>
    </div>
  )
}

export default function EncodingCompare() {
  const [profile, setProfile] = useState('flat')
  const p = PROFILES[profile]

  const ratio = (a, b) => (a / b).toFixed(1)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ JSON vs MessagePack — same struct, two encodings</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {Object.entries(PROFILES).map(([key, prof]) => (
          <button key={key} className={profile === key ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setProfile(key)}>
            {prof.label}
          </button>
        ))}
      </div>

      <div className="viz-panel mb-5">
        <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-2">fields in this payload</p>
        <div className="flex flex-wrap gap-1.5">
          {p.fields.map(f => <span key={f} className="viz-tag">{f}</span>)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg text-rose-600">{ratio(p.json.bytes, p.msgpack.bytes)}×</div>
          <div className="stat-label">payload size (JSON ÷ MsgPack)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-rose-600">{ratio(p.json.encodeNs, p.msgpack.encodeNs)}×</div>
          <div className="stat-label">encode CPU (JSON ÷ MsgPack)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-rose-600">{ratio(p.json.allocs, p.msgpack.allocs)}×</div>
          <div className="stat-label">allocations/op (JSON ÷ MsgPack)</div>
        </div>
      </div>

      <BarRow label="payload size" jsonVal={p.json.bytes} msgpackVal={p.msgpack.bytes} unit=" B" />
      <BarRow label="encode time" jsonVal={p.json.encodeNs} msgpackVal={p.msgpack.encodeNs} unit=" ns/op" />
      <BarRow label="decode time" jsonVal={p.json.decodeNs} msgpackVal={p.msgpack.decodeNs} unit=" ns/op" />
      <BarRow label="bytes allocated (encode)" jsonVal={p.json.encodeB} msgpackVal={p.msgpack.encodeB} unit=" B/op" />
      <BarRow label="allocations (encode)" jsonVal={p.json.allocs} msgpackVal={p.msgpack.allocs} unit="/op" />

      <p className="font-mono text-[11px] viz-dim mt-4">
        Three separate wins, worth measuring separately: less CPU to encode/decode, fewer bytes on the wire, and fewer
        allocations — which is the number that actually drives GC frequency (Section 4). The tradeoff: MessagePack
        payloads aren't human-readable. You lose <code>curl | jq</code> debugging and pay more attention to schema
        evolution, since there's no field name in the wire format to fall back on.
      </p>
    </div>
  )
}
