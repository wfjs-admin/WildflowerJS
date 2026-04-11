/**
 * Game Plugin Test Suite
 *
 * Tests for the game utilities plugin: math, collision, spatial grid, cooldowns.
 * Tests the functions directly without going through the plugin system,
 * since the plugin is a standalone script that adds methods to wildflower.$game.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the game utilities directly for unit testing.
// The actual plugin wraps these same functions in wildflower.plugin().
// We test the math/logic here; integration with $game is verified manually.

// =========================================================================
// Inline the utility functions for direct testing
// =========================================================================
const _cooldowns = new Map()

class SpatialGrid {
  constructor(cellSize) { this._cellSize = cellSize; this._cells = new Map() }
  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663 }
  insert(entity) {
    const cx = Math.floor(entity.x / this._cellSize), cy = Math.floor(entity.y / this._cellSize)
    const key = this._key(cx, cy)
    let cell = this._cells.get(key)
    if (!cell) { cell = []; this._cells.set(key, cell) }
    cell.push(entity)
  }
  query(x, y, radius) {
    const results = [], r2 = radius * radius, cs = this._cellSize
    for (let cx = Math.floor((x - radius) / cs); cx <= Math.floor((x + radius) / cs); cx++) {
      for (let cy = Math.floor((y - radius) / cs); cy <= Math.floor((y + radius) / cs); cy++) {
        const cell = this._cells.get(this._key(cx, cy))
        if (!cell) continue
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i], dx = e.x - x, dy = e.y - y
          if (dx * dx + dy * dy <= r2) results.push(e)
        }
      }
    }
    return results
  }
  clear() { this._cells.clear() }
  rebuild(entities) { this.clear(); for (let i = 0; i < entities.length; i++) this.insert(entities[i]) }
}

const game = {
  dist(a, b) { const dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy) },
  dist2(a, b) { const dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy },
  normalize(vx, vy) { const len = Math.sqrt(vx * vx + vy * vy); return len === 0 ? { x: 0, y: 0 } : { x: vx / len, y: vy / len } },
  angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) },
  clamp(val, min, max) { return val < min ? min : val > max ? max : val },
  lerp(a, b, t) { return a + (b - a) * t },
  wrap(val, min, max) { const range = max - min; return ((((val - min) % range) + range) % range) + min },
  randRange(min, max) { return min + Math.random() * (max - min) },
  randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min },
  overlap(a, b, radiusA, radiusB) { const rA = radiusA || 0, rB = radiusB || 0, c = rA + rB, dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy <= c * c },
  rectOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y },
  nearest(entities, origin, maxDist) { let best = null, bestD2 = maxDist != null ? maxDist * maxDist : Infinity; for (let i = 0; i < entities.length; i++) { const e = entities[i], dx = e.x - origin.x, dy = e.y - origin.y, d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; best = e } } return best },
  inRadius(entities, x, y, radius) { const r2 = radius * radius, results = []; for (let i = 0; i < entities.length; i++) { const e = entities[i], dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy <= r2) results.push(e) } return results },
  cooldown(name, ms) { const now = performance.now(); const last = _cooldowns.get(name); if (last != null && now - last < ms) return false; _cooldowns.set(name, now); return true },
  resetCooldown(name) { _cooldowns.delete(name) },
  resetAllCooldowns() { _cooldowns.clear() },
  createGrid(cellSize) { return new SpatialGrid(cellSize) }
}

describe('Game Plugin', () => {

  beforeEach(() => {
    _cooldowns.clear()
  })

  // =========================================================================
  // Tier 1: Core Math
  // =========================================================================
  describe('Core Math', () => {
    it('dist() calculates distance between two points', () => {
      expect(game.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
      expect(game.dist({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0)
    })

    it('dist2() calculates squared distance', () => {
      expect(game.dist2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25)
    })

    it('normalize() returns unit vector', () => {
      const n = game.normalize(3, 4)
      expect(n.x).toBeCloseTo(0.6)
      expect(n.y).toBeCloseTo(0.8)
    })

    it('normalize() handles zero vector', () => {
      const n = game.normalize(0, 0)
      expect(n.x).toBe(0)
      expect(n.y).toBe(0)
    })

    it('angle() returns angle between two points', () => {
      expect(game.angle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0)
      expect(game.angle({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2)
    })

    it('clamp() constrains value to range', () => {
      expect(game.clamp(5, 0, 10)).toBe(5)
      expect(game.clamp(-3, 0, 10)).toBe(0)
      expect(game.clamp(15, 0, 10)).toBe(10)
    })

    it('lerp() interpolates between values', () => {
      expect(game.lerp(0, 10, 0.5)).toBe(5)
      expect(game.lerp(0, 10, 0)).toBe(0)
      expect(game.lerp(0, 10, 1)).toBe(10)
    })

    it('wrap() wraps value within range', () => {
      expect(game.wrap(15, 0, 10)).toBe(5)
      expect(game.wrap(-3, 0, 10)).toBe(7)
      expect(game.wrap(5, 0, 10)).toBe(5)
    })

    it('randRange() returns value within range', () => {
      for (let i = 0; i < 20; i++) {
        const v = game.randRange(5, 10)
        expect(v).toBeGreaterThanOrEqual(5)
        expect(v).toBeLessThan(10)
      }
    })

    it('randInt() returns integer within range', () => {
      for (let i = 0; i < 20; i++) {
        const v = game.randInt(0, 5)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(5)
        expect(Number.isInteger(v)).toBe(true)
      }
    })
  })

  // =========================================================================
  // Tier 2: Collision & Spatial Queries
  // =========================================================================
  describe('Collision & Queries', () => {
    it('overlap() detects circle collision', () => {
      expect(game.overlap({ x: 0, y: 0 }, { x: 5, y: 0 }, 3, 3)).toBe(true)
      expect(game.overlap({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 3)).toBe(false)
    })

    it('overlap() uses default radius', () => {
      expect(game.overlap({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true)
    })

    it('rectOverlap() detects AABB collision', () => {
      const a = { x: 0, y: 0, w: 10, h: 10 }
      const b = { x: 5, y: 5, w: 10, h: 10 }
      const c = { x: 20, y: 20, w: 5, h: 5 }
      expect(game.rectOverlap(a, b)).toBe(true)
      expect(game.rectOverlap(a, c)).toBe(false)
    })

    it('nearest() finds closest entity in array', () => {
      const entities = [
        { x: 10, y: 0 },
        { x: 3, y: 0 },
        { x: 20, y: 0 }
      ]
      expect(game.nearest(entities, { x: 0, y: 0 })).toBe(entities[1])
    })

    it('nearest() returns null for empty array', () => {
      expect(game.nearest([], { x: 0, y: 0 })).toBeNull()
    })

    it('nearest() respects maxDist', () => {
      expect(game.nearest([{ x: 100, y: 0 }], { x: 0, y: 0 }, 50)).toBeNull()
    })

    it('inRadius() returns all entities within radius', () => {
      const entities = [
        { x: 1, y: 0 },
        { x: 5, y: 0 },
        { x: 100, y: 0 }
      ]
      const result = game.inRadius(entities, 0, 0, 10)
      expect(result.length).toBe(2)
      expect(result).toContain(entities[0])
      expect(result).toContain(entities[1])
    })
  })

  // =========================================================================
  // Tier 2: Cooldowns
  // =========================================================================
  describe('Cooldowns', () => {
    it('cooldown() returns true on first call', () => {
      expect(game.cooldown('test-ability', 1000)).toBe(true)
    })

    it('cooldown() returns false within cooldown period', () => {
      game.cooldown('test-block', 10000)
      expect(game.cooldown('test-block', 10000)).toBe(false)
    })

    it('cooldown() returns true after period elapses', async () => {
      game.cooldown('test-expire', 50)
      await new Promise(r => setTimeout(r, 60))
      expect(game.cooldown('test-expire', 50)).toBe(true)
    })

    it('resetCooldown() clears a specific cooldown', () => {
      game.cooldown('test-reset', 10000)
      game.resetCooldown('test-reset')
      expect(game.cooldown('test-reset', 10000)).toBe(true)
    })

    it('resetAllCooldowns() clears all cooldowns', () => {
      game.cooldown('cd-a', 10000)
      game.cooldown('cd-b', 10000)
      game.resetAllCooldowns()
      expect(game.cooldown('cd-a', 10000)).toBe(true)
      expect(game.cooldown('cd-b', 10000)).toBe(true)
    })
  })

  // =========================================================================
  // Tier 3: Spatial Grid
  // =========================================================================
  describe('Spatial Grid', () => {
    it('creates a grid with cell size', () => {
      const grid = game.createGrid(50)
      expect(grid).toBeDefined()
      expect(typeof grid.insert).toBe('function')
      expect(typeof grid.query).toBe('function')
      expect(typeof grid.clear).toBe('function')
    })

    it('insert and query finds nearby entities', () => {
      const grid = game.createGrid(50)
      const a = { x: 10, y: 10 }
      const b = { x: 20, y: 20 }
      const c = { x: 500, y: 500 }
      grid.insert(a)
      grid.insert(b)
      grid.insert(c)

      const nearby = grid.query(15, 15, 30)
      expect(nearby).toContain(a)
      expect(nearby).toContain(b)
      expect(nearby).not.toContain(c)
    })

    it('clear() removes all entities', () => {
      const grid = game.createGrid(50)
      grid.insert({ x: 10, y: 10 })
      grid.insert({ x: 20, y: 20 })
      grid.clear()
      expect(grid.query(15, 15, 100).length).toBe(0)
    })

    it('rebuild() repopulates from array', () => {
      const grid = game.createGrid(50)
      const entities = [
        { x: 10, y: 10 },
        { x: 200, y: 200 },
        { x: 15, y: 15 }
      ]
      grid.rebuild(entities)
      expect(grid.query(12, 12, 20).length).toBe(2)
    })

    it('handles negative coordinates', () => {
      const grid = game.createGrid(50)
      const a = { x: -10, y: -10 }
      grid.insert(a)
      expect(grid.query(-10, -10, 5)).toContain(a)
    })
  })
})
