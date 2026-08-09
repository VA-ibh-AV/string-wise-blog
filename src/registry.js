import { lazy } from 'react'

/**
 * Post registry.
 *
 * type: 'post'     — renders a post component at /:slug
 * type: 'external' — card on homepage links out to an external URL
 */
const registry = [
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
