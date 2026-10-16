/**
 * A PostgREST-shaped fake, for testing what the read model does with a database
 * that cuts its answers short.
 *
 * It implements the handful of query-builder calls `apiDataSource` makes, and it
 * models the three things that matter here faithfully enough to be tested
 * against:
 *
 *   1. ORDERING. `.order()` calls are applied as PostgreSQL would, including its
 *      NULL defaults. With NO order the fake returns the rows in a DIFFERENT
 *      permutation on every call, which is what an unordered query is entitled to
 *      do: it is how a test proves the code asked for an order rather than
 *      happened to get one.
 *   2. THE ROW CAP. A server-side `maxRows` (Supabase ships with 1,000) applies
 *      whatever limit the client asked for, so a client that asks for more than
 *      the server will give is cut short exactly as in production.
 *   3. THE TOTAL. `count: 'exact'` returns the rows matching the filter BEFORE the
 *      cap, as PostgREST does. A table can be told to answer with no count, a
 *      null count, or a wrong one, which are the ways a total goes missing.
 *
 *   4. COLUMNS THAT EXIST. Given a `schema` for a table, selecting, ordering or
 *      filtering on a column it does not have fails the way PostgreSQL does
 *      (SQLSTATE 42703). A fake that returns whatever was asked for is how a read
 *      of `change_kind` and `summary` went unnoticed: the real table has neither.
 *
 * Nothing here knows about the application. Every call is recorded so a test can
 * assert how many requests a surface made and what each asked for.
 */

export type Row = Record<string, unknown>

export interface RecordedCall {
  table: string
  columns: string
  count: string | undefined
  orders: { column: string; ascending: boolean; nullsFirst: boolean }[]
  limit: number | null
  filters: [string, unknown][]
}

export type CountMode = 'exact' | 'null' | 'omit' | 'short' | 'zero'

export interface FakeOptions {
  /** The server-side cap, whatever the client asked for. Default 1,000. */
  maxRows?: number
  /** How each table answers a count request. Default `exact`. */
  countMode?: Record<string, CountMode>
  /** Tables whose reads come back as an error. */
  errors?: Record<string, { code?: string; message: string }>
  /** Tables whose reads reject, as a dropped connection does. */
  rejects?: string[]
  /**
   * The columns each listed table really has. A read that names any other column
   * errors with 42703. Tables not listed accept anything.
   */
  schema?: Record<string, readonly string[]>
}

export interface FakeSupabase {
  client: { from: (table: string) => unknown; rpc: () => Promise<{ data: unknown; error: null }> }
  calls: RecordedCall[]
  /** Replace a table's rows between calls. */
  set: (table: string, rows: Row[]) => void
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : 1
}

/** A different permutation on every call, deterministic across runs. */
function permute<T>(rows: T[], salt: number): T[] {
  const out = rows.map((row, i) => ({ row, key: Math.sin((i + 1) * (salt + 7.31)) }))
  return out.sort((x, y) => x.key - y.key).map((x) => x.row)
}

export function fakeSupabase(initial: Record<string, Row[]>, options: FakeOptions = {}): FakeSupabase {
  const tables = new Map<string, Row[]>(Object.entries(initial))
  const maxRows = options.maxRows ?? 1000
  const calls: RecordedCall[] = []
  let sequence = 0

  function builder(table: string) {
    const call: RecordedCall = { table, columns: '', count: undefined, orders: [], limit: null, filters: [] }
    calls.push(call)

    const api: Record<string, unknown> = {
      select: (columns: string, opts?: { count?: string }) => {
        call.columns = columns
        call.count = opts?.count
        return api
      },
      order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => {
        const ascending = opts?.ascending ?? true
        // PostgreSQL: ASC sorts NULLS LAST, DESC sorts NULLS FIRST, unless told.
        call.orders.push({ column, ascending, nullsFirst: opts?.nullsFirst ?? !ascending })
        return api
      },
      limit: (n: number) => {
        call.limit = n
        return api
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value])
        return api
      },
      maybeSingle: async () => {
        const result = await run()
        return { data: ((result.data as Row[]) ?? [])[0] ?? null, error: result.error }
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        run().then(resolve, reject),
    }

    async function run(): Promise<{ data: Row[] | null; error: unknown; count?: number | null }> {
      sequence += 1
      if (options.rejects?.includes(table)) throw new Error('network down')
      const failure = options.errors?.[table]
      if (failure) return { data: null, error: failure }

      const known = options.schema?.[table]
      if (known) {
        const named = [
          ...call.columns.split(',').map((c) => c.trim()),
          ...call.orders.map((o) => o.column),
          ...call.filters.map(([c]) => c),
        ]
        const missing = named.find((c) => c !== '' && c !== '*' && !known.includes(c))
        if (missing) {
          return { data: null, error: { code: '42703', message: `column ${table}.${missing} does not exist` } }
        }
      }

      let rows = [...(tables.get(table) ?? [])]
      for (const [column, value] of call.filters) rows = rows.filter((r) => r[column] === value)
      const total = rows.length

      if (call.orders.length > 0) {
        rows = rows
          .map((row, index) => ({ row, index }))
          .sort((x, y) => {
            for (const o of call.orders) {
              const a = x.row[o.column] ?? null
              const b = y.row[o.column] ?? null
              if (a === null && b === null) continue
              if (a === null) return o.nullsFirst ? -1 : 1
              if (b === null) return o.nullsFirst ? 1 : -1
              const d = compare(a, b)
              if (d !== 0) return o.ascending ? d : -d
            }
            return x.index - y.index
          })
          .map((x) => x.row)
      } else {
        rows = permute(rows, sequence)
      }

      const cap = Math.min(call.limit ?? Number.POSITIVE_INFINITY, maxRows)
      const data = rows.slice(0, cap)

      if (call.count !== 'exact') return { data, error: null, count: null }
      switch (options.countMode?.[table] ?? 'exact') {
        case 'exact':
          return { data, error: null, count: total }
        case 'null':
          return { data, error: null, count: null }
        case 'omit':
          return { data, error: null }
        case 'short':
          return { data, error: null, count: Math.max(0, data.length - 1) }
        case 'zero':
          return { data, error: null, count: 0 }
      }
    }
    return api
  }

  return {
    client: { from: (table: string) => builder(table), rpc: async () => ({ data: false, error: null }) },
    calls,
    set: (table, rows) => void tables.set(table, rows),
  }
}
