import { useState, useMemo } from 'react'

// Postgres cost model constants
const SEQ_PAGE_COST        = 1.0
const CPU_TUPLE_COST       = 0.01
const CPU_INDEX_TUPLE_COST = 0.005
const ROWS_PER_PAGE        = 100   // ~8KB pages, ~100 rows/page
const INDEX_HEIGHT         = 3     // typical B-tree height

function fmt(n, decimals = 1) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(decimals)
}

function computeCosts({ rows, selectivityPct, randomPageCost }) {
  const selectivity = selectivityPct / 100
  const pages       = Math.ceil(rows / ROWS_PER_PAGE)
  const matchRows   = Math.ceil(rows * selectivity)

  // Sequential scan cost
  const seqScanCost = SEQ_PAGE_COST * pages + CPU_TUPLE_COST * rows

  // Index scan cost (simplified Postgres planner model)
  // Random I/O to traverse the index + random I/O to fetch heap pages for matching rows
  const indexPages    = Math.max(1, Math.ceil(matchRows / 10))  // ~10 index entries/page
  const heapFetches   = Math.min(matchRows, pages)              // bounded by table size
  const indexScanCost =
    randomPageCost * INDEX_HEIGHT          +  // traverse B-tree
    randomPageCost * indexPages            +  // read index leaf pages
    randomPageCost * heapFetches * selectivity + // random heap fetches
    CPU_INDEX_TUPLE_COST * matchRows       +  // CPU to process index tuples
    CPU_TUPLE_COST * matchRows                // CPU to process heap tuples

  return {
    seqScanCost:  Math.round(seqScanCost  * 10) / 10,
    indexScanCost: Math.round(indexScanCost * 10) / 10,
    pages,
    matchRows,
    indexPages,
  }
}

function PlanCard({ type, cost, winner, children }) {
  const isWinner = winner === type
  return (
    <div className={`rounded-xl border p-5 transition-all duration-300 ${
      isWinner
        ? 'border-accent-300 bg-accent-50 shadow-sm'
        : 'border-zinc-200 bg-white opacity-70'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm font-semibold text-zinc-700">{type}</span>
        {isWinner && (
          <span className="font-mono text-[10px] font-semibold bg-accent-600 text-white px-2 py-0.5 rounded-full">
            CHOSEN
          </span>
        )}
      </div>
      <div className={`font-mono text-3xl font-bold mb-1 ${isWinner ? 'text-accent-600' : 'text-zinc-400'}`}>
        {cost.toLocaleString()}
      </div>
      <div className="font-mono text-[10px] text-zinc-400 mb-4">cost units</div>
      <div className="space-y-1.5 text-[11px] font-mono text-zinc-500">
        {children}
      </div>
    </div>
  )
}

export default function QueryPlanExplainer() {
  const [rows,            setRows]            = useState(500_000)
  const [selectivityPct,  setSelectivityPct]  = useState(1)     // %
  const [randomPageCost,  setRandomPageCost]  = useState(4.0)   // 4.0=HDD, 1.1=SSD

  const { seqScanCost, indexScanCost, pages, matchRows, indexPages } = useMemo(
    () => computeCosts({ rows, selectivityPct, randomPageCost }),
    [rows, selectivityPct, randomPageCost]
  )

  const winner = seqScanCost <= indexScanCost ? 'Seq Scan' : 'Index Scan'

  // For the cost bar
  const maxCost   = Math.max(seqScanCost, indexScanCost)
  const seqPct    = Math.round((seqScanCost  / maxCost) * 100)
  const idxPct    = Math.round((indexScanCost / maxCost) * 100)

  // Crossover estimate: at what selectivity does the choice flip?
  const crossoverRows = useMemo(() => {
    for (let pct = 0.1; pct <= 100; pct += 0.1) {
      const { seqScanCost: s, indexScanCost: i } = computeCosts({ rows, selectivityPct: pct, randomPageCost })
      if (s <= i) return pct
    }
    return 100
  }, [rows, randomPageCost])

  return (
    <div className="viz-card">
      <p className="viz-title">↳ query plan cost model</p>

      {/* Sliders */}
      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5 space-y-3">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">
          table configuration
        </p>

        <div className="slider-row">
          <label className="slider-label">table rows</label>
          <input
            type="range" min="1000" max="10000000" step="1000"
            value={rows}
            onChange={e => setRows(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{fmt(rows, 0)}</span>
        </div>

        <div className="slider-row">
          <label className="slider-label">WHERE clause selectivity</label>
          <input
            type="range" min="0.01" max="50" step="0.01"
            value={selectivityPct}
            onChange={e => setSelectivityPct(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{selectivityPct.toFixed(2)}%</span>
        </div>

        <div className="slider-row">
          <label className="slider-label">random_page_cost</label>
          <input
            type="range" min="1.0" max="4.0" step="0.1"
            value={randomPageCost}
            onChange={e => setRandomPageCost(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{randomPageCost.toFixed(1)}</span>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            className={`btn-sim text-[11px] ${randomPageCost === 1.1 ? 'border-accent-300 bg-accent-50 text-accent-700' : ''}`}
            onClick={() => setRandomPageCost(1.1)}
          >
            SSD (1.1)
          </button>
          <button
            className={`btn-sim text-[11px] ${randomPageCost === 4.0 ? 'border-accent-300 bg-accent-50 text-accent-700' : ''}`}
            onClick={() => setRandomPageCost(4.0)}
          >
            HDD (4.0)
          </button>
        </div>

        <div className="pt-2 border-t border-zinc-200 space-y-1">
          <p className="font-mono text-[10px] text-zinc-500">
            table: <span className="text-accent-600">{fmt(pages, 0)} pages</span> &nbsp;·&nbsp;
            matching rows: <span className="text-accent-600">{fmt(matchRows, 0)}</span> &nbsp;·&nbsp;
            index pages read: <span className="text-accent-600">{fmt(indexPages, 0)}</span>
          </p>
          <p className="font-mono text-[10px] text-zinc-500">
            seq scan flips to index scan at selectivity &lt; <span className="text-rose-500">{crossoverRows.toFixed(2)}%</span>
          </p>
        </div>
      </div>

      {/* Cost bar comparison */}
      <div className="mb-5 space-y-2">
        <div>
          <div className="flex justify-between mb-1">
            <span className="font-mono text-[11px] text-zinc-500">Seq Scan</span>
            <span className="font-mono text-[11px] text-zinc-500">{seqScanCost.toLocaleString()}</span>
          </div>
          <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${winner === 'Seq Scan' ? 'bg-accent-500' : 'bg-zinc-300'}`}
              style={{ width: `${seqPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="font-mono text-[11px] text-zinc-500">Index Scan</span>
            <span className="font-mono text-[11px] text-zinc-500">{indexScanCost.toLocaleString()}</span>
          </div>
          <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${winner === 'Index Scan' ? 'bg-accent-500' : 'bg-zinc-300'}`}
              style={{ width: `${idxPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Plan cards side by side */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <PlanCard type="Seq Scan" cost={seqScanCost} winner={winner}>
          <p>pages read: {fmt(pages, 0)}</p>
          <p>seq_page_cost × pages</p>
          <p className="text-zinc-400 font-mono text-[10px] mt-2 leading-relaxed">
            {SEQ_PAGE_COST} × {fmt(pages, 0)} + {CPU_TUPLE_COST} × {fmt(rows, 0)}
          </p>
        </PlanCard>

        <PlanCard type="Index Scan" cost={indexScanCost} winner={winner}>
          <p>heap fetches: {fmt(matchRows, 0)}</p>
          <p>random_page_cost: {randomPageCost}</p>
          <p className="text-zinc-400 font-mono text-[10px] mt-2 leading-relaxed">
            {randomPageCost} × {INDEX_HEIGHT} (tree) +<br />
            {randomPageCost} × {fmt(indexPages, 0)} (index pages) +<br />
            random heap I/O + CPU
          </p>
        </PlanCard>
      </div>

      {/* Insight box */}
      <div className={`rounded-xl border p-4 font-mono text-xs leading-relaxed ${
        winner === 'Seq Scan'
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      }`}>
        {winner === 'Seq Scan' ? (
          <>
            <span className="font-semibold">Postgres will ignore your index.</span>{' '}
            At {selectivityPct.toFixed(2)}% selectivity, reading {fmt(matchRows, 0)} rows
            via random I/O ({randomPageCost}× cost multiplier per page) is more
            expensive than a full sequential scan. This is correct — the planner
            is not broken. Reduce selectivity below {crossoverRows.toFixed(2)}% or
            lower <code className="bg-amber-100 px-1 rounded">random_page_cost</code> if
            you're on SSD.
          </>
        ) : (
          <>
            <span className="font-semibold">Index scan wins.</span>{' '}
            At {selectivityPct.toFixed(2)}% selectivity only {fmt(matchRows, 0)} rows
            match — the random I/O cost to fetch those heap pages is
            lower than scanning all {fmt(pages, 0)} pages sequentially.
            Your index will be used.
          </>
        )}
      </div>
    </div>
  )
}
