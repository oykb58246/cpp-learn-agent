import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from './sqlite'

describe('SqliteDatabase', () => {
  it('provides the PRAGMA result shapes used by AppDatabase', () => {
    const db = new SqliteDatabase(':memory:')
    try {
      db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)')

      expect(db.pragma('table_info(sample)')).toEqual([
        expect.objectContaining({ name: 'id', type: 'TEXT' })
      ])
      expect(db.pragma('quick_check', { simple: true })).toBe('ok')
    } finally {
      db.close()
    }
  })

  it('rolls back a failed synchronous transaction', () => {
    const db = new SqliteDatabase(':memory:')
    try {
      db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)')
      const insert = db.prepare('INSERT INTO sample(id) VALUES(?)')
      const write = db.transaction(() => {
        insert.run('first')
        throw new Error('stop')
      })

      expect(write).toThrow('stop')
      expect(db.prepare('SELECT id FROM sample').all()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('uses a savepoint when a nested transaction rolls back', () => {
    const db = new SqliteDatabase(':memory:')
    try {
      db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)')
      const insert = db.prepare('INSERT INTO sample(id) VALUES(?)')
      db.transaction(() => {
        insert.run('outer-before')
        expect(() => db.transaction(() => {
          insert.run('inner')
          throw new Error('inner stop')
        })()).toThrow('inner stop')
        insert.run('outer-after')
      })()

      expect(db.prepare('SELECT id FROM sample ORDER BY id').all()).toEqual([
        expect.objectContaining({ id: 'outer-after' }),
        expect.objectContaining({ id: 'outer-before' })
      ])
    } finally {
      db.close()
    }
  })
})
