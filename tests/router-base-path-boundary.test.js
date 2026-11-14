/**
 * URLParser.parse strips the base with pathname.startsWith(base), which has
 * no segment boundary: with base '/app', '/application/users' parses as
 * 'lication/users' and '/appx' as 'x' (no leading slash), and a catch-all
 * route runs for a page that is outside the app.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: base path stops at a segment boundary', () => {
  beforeAll(async () => { await loadFramework() })

  const parse = (base, pathname) => new RouteManager({ mode: 'history', base }).urlParser.parse({ pathname, search: '' }).pathname

  it('control: the base itself and paths under it are stripped', () => {
    expect(parse('/app', '/app')).toBe('/')
    expect(parse('/app', '/app/users')).toBe('/users')
    expect(parse('/app/', '/app//users')).toBe('/users')
  })

  it('a sibling path that only shares the prefix is not stripped', () => {
    expect(parse('/app', '/application/users')).toBe('/application/users')
    expect(parse('/app', '/appx')).toBe('/appx')
  })
})
