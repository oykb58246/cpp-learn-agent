import { DatabaseSync, type StatementResultingChanges, type StatementSync } from 'node:sqlite'

class SqliteStatement {
  constructor(private readonly statement: StatementSync) {
    statement.setAllowBareNamedParameters(true)
    statement.setAllowUnknownNamedParameters(true)
  }

  run(...parameters: unknown[]): StatementResultingChanges {
    return Reflect.apply(this.statement.run, this.statement, parameters)
  }

  all(...parameters: unknown[]): unknown[] {
    return Reflect.apply(this.statement.all, this.statement, parameters)
  }

  get(...parameters: unknown[]): unknown {
    return Reflect.apply(this.statement.get, this.statement, parameters)
  }
}

export class SqliteDatabase {
  private readonly database: DatabaseSync
  private transactionDepth = 0

  constructor(path: string) {
    this.database = new DatabaseSync(path)
  }

  exec(sql: string): void {
    this.database.exec(sql)
  }

  close(): void {
    this.database.close()
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.database.prepare(sql))
  }

  pragma(source: string): Array<Record<string, unknown>>
  pragma(source: string, options: { simple: true }): unknown
  pragma(source: string, options?: { simple: true }): unknown {
    const rows = this.database.prepare(`PRAGMA ${source}`).all()
    if (!options?.simple) return rows
    const first = rows[0]
    return first ? Object.values(first)[0] : undefined
  }

  transaction<T>(action: () => T): () => T {
    return () => {
      const depth = this.transactionDepth
      const savepoint = `cpppilot_tx_${depth}`
      this.database.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      this.transactionDepth += 1
      try {
        const result = action()
        this.database.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (error) {
        if (depth === 0) {
          this.database.exec('ROLLBACK')
        } else {
          this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          this.database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        }
        throw error
      } finally {
        this.transactionDepth = depth
      }
    }
  }
}
