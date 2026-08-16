import { useState } from 'react'

/**
 * Section 6 — idempotent producer and transactions.
 *
 * Panel A: a produce request whose ACK is lost on the way back. The producer
 * retries. Without idempotence the broker appends the batch twice. With it,
 * the broker compares (producerId, epoch, sequence) against the last five
 * batches per partition and answers DUPLICATE_SEQUENCE_NUMBER.
 *
 * Panel B: a transaction across two partitions, and what a read_committed
 * consumer can see before the commit marker lands (nothing past the LSO).
 */

function Duplicates() {
  const [idempotent, setIdempotent] = useState(true)
  const [logRecords, setLogRecords] = useState([])
  const [steps, setSteps] = useState([])
  const [seq, setSeq] = useState(0)

  const run = () => {
    const pid = 7001
    const s = seq
    const events = []
    const appended = []

    events.push([`producer sends batch (producerId=${pid}, epoch=0, seq=${s}) → partition 0`, 'info'])
    events.push(['broker appends the batch to the log', 'ok'])
    appended.push({ seq: s, dup: false })
    events.push(['✗ ACK lost — network blip on the way back to the producer', 'err'])
    events.push([`request timeout → producer retries the SAME batch (seq=${s})`, 'warn'])

    if (idempotent) {
      events.push([`broker checks its per-partition sequence cache: last seq for pid ${pid} is ${s}`, 'info'])
      events.push([`seq ${s} ≤ last seen → responds DUPLICATE_SEQUENCE_NUMBER, appends nothing`, 'ok'])
      events.push(['producer treats it as success. Log has exactly one copy.', 'ok'])
    } else {
      events.push(['broker has no idea it has seen this batch before', 'warn'])
      appended.push({ seq: s, dup: true })
      events.push(['batch appended a SECOND time — a silent duplicate in the log', 'err'])
      events.push(['downstream aggregation now double-counts. Nothing errors, nothing alerts.', 'err'])
    }

    setLogRecords(prev => [...prev, ...appended])
    setSteps(events)
    setSeq(n => n + 1)
  }

  const dupes = logRecords.filter(r => r.dup).length
  const color = { ok: 'text-emerald-400', warn: 'text-amber-400', info: 'text-sky-400', err: 'text-rose-400' }

  return (
    <div className="k-panel mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-mono text-[11px] k-strong mr-2">enable.idempotence =</span>
        <button className={idempotent ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setIdempotent(true)}>true</button>
        <button className={!idempotent ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setIdempotent(false)}>false</button>
        <span className={`font-mono text-[10px] ml-auto ${dupes ? 'text-rose-500' : 'text-emerald-600'}`}>
          {dupes} duplicate{dupes === 1 ? '' : 's'} in the log
        </span>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3 min-h-[42px]">
        {logRecords.map((r, i) => (
          <div key={i} className={`w-[86px] h-10 k-chip ${r.dup ? 'k-chip-bad' : 'k-chip-ok'}`}>
            <span className="font-mono text-[8px] opacity-70">offset {i}</span>
            <span className="font-mono text-[9px]">seq {r.seq}{r.dup ? ' · dup' : ''}</span>
          </div>
        ))}
        {logRecords.length === 0 && <span className="font-mono text-[10px] k-muted self-center">log empty</span>}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button className="btn-sim-accent" onClick={run}>send batch, then drop the ACK</button>
        <button className="btn-sim ml-auto" onClick={() => { setLogRecords([]); setSteps([]); setSeq(0) }}>reset</button>
      </div>

      <div className="sim-log">
        {steps.length === 0 && <div className="text-zinc-500">-- press the button to lose an ACK</div>}
        {steps.map(([m, t], i) => <div key={i} className={`py-px ${color[t]}`}>{i + 1}. {m}</div>)}
      </div>
    </div>
  )
}

const TX_STEPS = [
  { label: 'initTransactions()', detail: 'coordinator assigns producerId + bumps epoch, fencing any zombie with the same transactional.id', lso: 0, log: [], marker: null },
  { label: 'beginTransaction()', detail: 'nothing on the data topics yet — the coordinator writes an Ongoing state to __transaction_state', lso: 0, log: [], marker: null },
  { label: 'send(orders, p0)', detail: 'record appended at offset 0, but it sits ABOVE the LSO — read_committed consumers cannot see it', lso: 0, log: [{ p: 'orders-0', o: 0 }], marker: null },
  { label: 'send(audit, p1)', detail: 'second partition joins the transaction; the coordinator tracks both in AddPartitionsToTxn', lso: 0, log: [{ p: 'orders-0', o: 0 }, { p: 'audit-1', o: 0 }], marker: null },
  { label: 'sendOffsetsToTransaction()', detail: 'the consumer offsets for the input topic are written INTO the same transaction — this is what makes read-process-write atomic', lso: 0, log: [{ p: 'orders-0', o: 0 }, { p: 'audit-1', o: 0 }, { p: '__consumer_offsets', o: 0 }], marker: null },
  { label: 'commitTransaction()', detail: 'coordinator writes PREPARE_COMMIT, then a COMMIT marker into every touched partition', lso: 0, log: [{ p: 'orders-0', o: 0 }, { p: 'audit-1', o: 0 }, { p: '__consumer_offsets', o: 0 }], marker: 'pending' },
  { label: 'markers written', detail: 'LSO advances past the markers — everything in the transaction becomes visible to read_committed consumers at once', lso: 2, log: [{ p: 'orders-0', o: 0 }, { p: 'audit-1', o: 0 }, { p: '__consumer_offsets', o: 0 }], marker: 'commit' },
]

function Transaction() {
  const [step, setStep] = useState(0)
  const s = TX_STEPS[step]

  return (
    <div className="k-panel">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] k-strong">transaction timeline</span>
        <span className="font-mono text-[10px] k-muted">step {step + 1} / {TX_STEPS.length}</span>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {TX_STEPS.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setStep(i)}
            className={`k-tag ${i === step ? 'k-tag-hl' : i < step ? 'k-tag-ok' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="font-mono text-[10px] k-dim mb-4 min-h-[32px]">{s.detail}</p>

      <div className="grid gap-2 mb-4">
        {['orders-0', 'audit-1', '__consumer_offsets'].map(p => {
          const rec = s.log.find(r => r.p === p)
          return (
            <div key={p} className="flex items-center gap-2">
              <span className="font-mono text-[9px] k-muted w-[126px] shrink-0 text-right">{p}</span>
              <div className="flex gap-1.5 items-center">
                {rec && (
                  <div className={`w-[86px] h-9 k-chip ${s.marker === 'commit' ? 'k-chip-ok' : 'k-chip-warn'}`}>
                    <span className="font-mono text-[8px] opacity-70">offset {rec.o}</span>
                    <span className="font-mono text-[9px]">{s.marker === 'commit' ? 'visible' : 'uncommitted'}</span>
                  </div>
                )}
                {s.marker && (
                  <div className={`w-[86px] h-9 k-chip ${s.marker === 'commit' ? 'k-chip-hl' : ''}`}>
                    <span className="font-mono text-[8px] opacity-70">offset 1</span>
                    <span className="font-mono text-[9px]">{s.marker === 'commit' ? 'COMMIT ✓' : 'PREPARE'}</span>
                  </div>
                )}
                {!rec && <span className="font-mono text-[10px] k-muted">—</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-[10px] k-muted">Last Stable Offset</span>
        <span className={`font-mono text-[11px] ${s.lso > 0 ? 'text-emerald-600' : 'text-amber-500'}`}>
          LSO = {s.lso}
        </span>
        <span className="font-mono text-[10px] k-muted">
          {s.lso > 0
            ? 'read_committed consumer now returns the records'
            : 'read_committed consumer returns NOTHING past this point, even though the data is on disk'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim" onClick={() => setStep(s2 => Math.max(0, s2 - 1))} disabled={step === 0}>← back</button>
        <button className="btn-sim-accent" onClick={() => setStep(s2 => Math.min(TX_STEPS.length - 1, s2 + 1))} disabled={step === TX_STEPS.length - 1}>
          next step →
        </button>
        <button className="btn-sim ml-auto" onClick={() => setStep(0)}>reset</button>
      </div>
    </div>
  )
}

export default function ExactlyOnceSim() {
  return (
    <div className="viz-card">
      <p className="viz-title">↳ idempotence &amp; transactions</p>
      <Duplicates />
      <Transaction />
    </div>
  )
}
