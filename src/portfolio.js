/**
 * Portfolio content — the single file to edit.
 *
 * Everything the homepage says lives here, so the components under
 * src/components/portfolio/ stay layout-only.
 *
 * The one thing still missing is employment dates: `start` and `end` are null
 * below, and the timeline simply omits the date rail when they are. Fill them
 * in and it appears.
 */

export const profile = {
  name:     'Vaibhav Bhardwaj',
  handle:   'goroutine_guy',
  role:     'Senior Software Developer',
  company:  'Bharti Airtel',
  location: 'India',
  // Two lines. The second one renders in the accent colour.
  tagline:  { lead: 'Vaibhav,', accent: 'one layer down.' },
  blurb:    'I build and operate distributed systems, and write about what is actually happening underneath them — the log on disk, the window on the wire, the tuple in the page.',
  avatar:   null,
}

/** The hero side panel. Three lines — it is a status readout, not a bio. */
export const status = [
  { key: 'focus',  value: 'distributed systems & observability' },
  { key: 'stack',  value: 'Go · Kafka · Elastic · Linux' },
  { key: 'status', value: 'open to interesting problems', accent: true },
]

/**
 * "Now" — what has my attention outside of work. Deliberately no day-job items;
 * those belong in Experience.
 */
export const now = {
  headline: 'Between posts I am mostly reading source, and shipping small Go libraries that scratch an itch from on-call.',
  items: [
    'Reading the Linux networking stack — net/ipv4 mostly, which is what the TCP post turned into.',
    'Maintaining schemadrift, a Go library for catching JSON schema drift inside a consumer instead of after it.',
    'Contributing WAL-backed persistence upstream to chromem-go, an embeddable vector database for Go.',
    'Next field note is fighting between the Go scheduler and eBPF for application developers.',
  ],
}

/** Grouped stack, ordered by how much I want to be asked about it. */
export const skills = [
  { group: 'languages',     items: ['Go', 'Python', 'C++', 'JavaScript', 'SQL', 'Bash'] },
  { group: 'messaging & data', items: ['Kafka', 'PostgreSQL', 'Redis', 'Elasticsearch', 'NATS'] },
  { group: 'observability',  items: ['Grafana', 'Kibana', 'Prometheus', 'Elastic Stack', 'eBPF'] },
  { group: 'infrastructure', items: ['Linux', 'Docker', 'Kubernetes', 'Nginx', 'Git'] },
  { group: 'ai & agents',    items: ['MCP', 'CrewAI', 'Chainlit', 'RAG'] },
  { group: 'frontend',       items: ['React', 'Angular', 'TypeScript'] },
]

/**
 * Newest first. `end: null` renders as "present"; a null `start` hides the
 * date rail entirely rather than printing a placeholder.
 */
export const experience = [
  {
    company:  'Bharti Airtel',
    role:     'Senior Software Developer',
    start:    null,
    end:      null,
    current:  true,
    location: null,
    bullets: [
      'Build and operate a distributed central monitoring platform that ingests roughly 10 TB of telemetry a day across the national network.',
      'Own the Go ingestion and processing services behind it — Kafka for transport, Elasticsearch for search, Grafana and Kibana on top.',
      'Spend most incident time in the layer below the dashboards: consumer lag, retransmits, GC pauses, and the queries that got slow when nobody was looking.',
    ],
  },
  {
    company:  'Infosys',
    role:     'Specialist Programmer',
    start:    null,
    end:      null,
    current:  false,
    location: null,
    bullets: [
      'Built microservices in Go for an internal workflow platform, wired to Kafka for real-time event streaming, and added caching layers worth a 30% performance improvement.',
      'Designed the concurrent execution model — goroutines, channels and mutexes — for parallel jobs and shared resources in the critical stages of the pipeline, with the classical producer-consumer and reader-writer problems as the correctness bar.',
      'Built an in-house agentic store and several multi-agent products on MCP servers and internal knowledge sources, giving other teams a reusable agent framework.',
      'Shipped the React and Angular dashboards teams used to watch pipelines and debug live executions.',
    ],
  },
]

/**
 * Things you can go and read. `hard` is the sentence most portfolios leave out
 * and the only one worth reading.
 */
export const projects = [
  {
    name:   'schemadrift',
    href:   'https://github.com/VA-ibh-AV/schemadrift',
    blurb:  'In-process schema drift detection for JSON message streams. Learns the shape of your messages during a warm-up window, then fires a callback on the first message that breaks it — no schema registry, no sidecar, no broker change.',
    hard:   'Inferring a baseline from live traffic that is strict enough to catch a float64 turning into a string, and loose enough not to page you because one producer omits an optional field.',
    stack:  ['Go', 'Kafka', 'NATS', 'Redis Streams'],
    status: 'go library',
  },
  {
    name:   'chromem-go — WAL persistence',
    href:   'https://github.com/philippgille/chromem-go/pull/125',
    blurb:  'Write-ahead-log persistence contributed upstream to chromem-go, an embeddable vector database for Go with ~1k stars. Configurable segment size, background sync workers, a real Close(), plus tests and WAL-vs-no-WAL benchmarks.',
    hard:   'Rotation under concurrency — the old code could hand a writer to one goroutine while another closed it, which surfaced as intermittent "file already closed" errors rather than anything reproducible.',
    stack:  ['Go', 'WAL', 'benchmarks'],
    status: 'open source',
  },
  {
    name:   'chainlit-crew-adapter',
    href:   'https://github.com/VA-ibh-AV/chainlit-crew-adapter',
    blurb:  'Runs CrewAI crews inside Chainlit properly: crew, task, agent and tool events render as nested Chainlit steps, and a reusable tool lets an agent stop and ask the user a follow-up question mid-run.',
    hard:   'CrewAI emits a flat callback stream and Chainlit wants a nested step lifecycle. Reconciling the two without losing the nesting was most of the work.',
    stack:  ['Python', 'CrewAI', 'Chainlit'],
    status: 'python package',
  },
  {
    name:   'Consistent hashing visualizer',
    href:   'https://hash.string-wise.com',
    blurb:  'Step through key distribution, node joins and departures, and why modulo hashing falls apart the moment the node count changes.',
    hard:   'Making virtual nodes legible without turning the ring into noise.',
    stack:  ['Go', 'React', 'SVG'],
    status: 'live',
  },
  {
    name:   'Raft consensus visualizer',
    href:   'https://raft.string-wise.com',
    blurb:  'Leader election, log replication and network partitions, played out one step at a time.',
    hard:   'Modelling partitions honestly — the interesting bugs only appear when both halves keep running and both think they are right.',
    stack:  ['Go', 'React'],
    status: 'live',
  },
]

export const contact = {
  email:    null,   // set to a string to render it; left off deliberately
  github:   'https://github.com/VA-ibh-AV',
  linkedin: 'https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/',
}
