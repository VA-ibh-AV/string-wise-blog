import { lazy } from 'react'

/**
 * Post registry.
 *
 * type: 'post'     — renders a post component at /:slug
 * type: 'external' — card on homepage links out to an external URL
 */
const registry = [
  {
    slug:        'tcp-internals',
    type:        'post',
    title:       'TCP from the inside',
    date:        '2026-08-22',
    description: 'The handshake, retransmission and RTO, flow control versus congestion control, the state machine and TIME_WAIT, what the Linux kernel actually runs — sk_buff, tcp_sendmsg, NAPI, eBPF tracepoints — and the production gotchas that page you at 3am. Seven interactive visualizers.',
    tags:        ['tcp', 'networking', 'linux', 'internals'],
    readingTime: '30 min',
    ogImage:     '/og/tcp-internals.png',
    component:   lazy(() => import('./posts/tcp-internals')),
  },
  {
    slug:        'kafka-internals',
    type:        'post',
    title:       'Kafka beyond the basics',
    date:        '2025-08-16',
    description: 'The log on disk, consumer group assignment, eager vs cooperative rebalancing, ISR and the high watermark, log compaction, and exactly-once — seven interactive visualizers for the Kafka internals that decide how production behaves.',
    tags:        ['kafka', 'distributed-systems', 'internals'],
    readingTime: '22 min',
    component:   lazy(() => import('./posts/kafka-internals')),
  },
  {
    slug:        'postgres-internals',
    type:        'post',
    title:       'PostgreSQL storage internals',
    date:        '2025-08-10',
    description: 'What actually happens when you INSERT, UPDATE, and DELETE rows — MVCC, dead tuples, autovacuum, and the cost-based query planner explained with interactive visualizers.',
    tags:        ['postgres', 'databases', 'internals'],
    readingTime: '12 min',
    component:   lazy(() => import('./posts/postgres-internals')),
  },
  {
    slug:        'consistent-hashing',
    type:        'external',
    href:        'https://hash.string-wise.com',
    title:       'Consistent hashing — interactive visualizer',
    date:        '2025-07-20',
    description: 'Step through how consistent hashing distributes keys across nodes, handles node additions and removals, and why it beats modulo hashing for distributed caches.',
    tags:        ['distributed-systems', 'go'],
    readingTime: 'interactive',
  },
  {
    slug:        'raft-consensus',
    type:        'external',
    href:        'https://raft.string-wise.com',
    title:       'Raft consensus — interactive visualizer',
    date:        '2025-06-15',
    description: 'Watch leader election, log replication, and network partitions play out step by step in this visual walk-through of the Raft consensus algorithm.',
    tags:        ['distributed-systems', 'go'],
    readingTime: 'interactive',
  },
]

export default registry
