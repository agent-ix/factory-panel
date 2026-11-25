import { expect, test } from 'claude-code/testing'

import { FACTORY_GRAFANA, FACTORY_PROMETHEUS, grafanaFrom, originOf, otlpEndpointOf, resolveEndpoints } from '../hooks/endpoints'
import type { Options } from '../hooks/shared'
import { trace } from './trace'

const base = (over: Partial<Options> = {}): Options => ({
  prometheusUrl: '',
  grafanaUrl: '',
  teams: [],
  refreshSeconds: 15,
  inlineView: 'band',
  ...over,
})

type Run = { exitCode: number; stdout: string }
const run = (stdout: string, exitCode = 0): Run => ({ exitCode, stdout })

// resolveEndpoints only needs process.run, fs.read and ui.log, so a small stand-in drives it.
const host = (runs: (argv: string[]) => Run, read: (path: string) => string) =>
  ({
    process: { run: async (argv: string[]) => ({ ...runs(argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) },
    fs: {
      read: async (path: string) => {
        const text = read(path)
        if (text === '') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return text
      },
    },
    ui: { log: () => undefined },
  }) as never

test('an address reduces to its origin, and Grafana follows Prometheus’s naming', () => {
  expect(originOf('http://prometheus.luna.ix/api/v1/otlp')).toBe('http://prometheus.luna.ix')
  expect(originOf('prometheus.luna.ix')).toBeUndefined()
  expect(otlpEndpointOf('[watcher]\notlp_endpoint = "http://prometheus.luna.ix/api/v1/otlp"\n')).toBe('http://prometheus.luna.ix/api/v1/otlp')
  expect(otlpEndpointOf('[watcher]\ninterval_secs = 2\n')).toBeUndefined()
  expect(grafanaFrom('http://prometheus.luna.ix')).toBe('http://grafana.luna.ix')
  expect(grafanaFrom('http://10.0.0.5:9090')).toBeUndefined()
})

test('a setting wins; no setting reads the shared ix config', async () => {
  trace("FR-007-AC-1", "FR-007-AC-3")
  const ran: string[] = []
  const reads: string[] = []
  const $ = host(
    argv => {
      ran.push(argv.join(' '))
      return argv.join(' ') === 'ix config get observability.prometheusUrl' ? run('\u001b[36m✧\u001b[39m http://metrics.example.ix\n') : run('', 1)
    },
    path => (reads.push(path), ''),
  )
  const set = base({ prometheusUrl: 'http://mine:9090', grafanaUrl: 'http://g:3000' })
  await resolveEndpoints($, set)
  expect(set.prometheusUrl).toBe('http://mine:9090')
  expect(ran).toEqual([])
  expect(reads).toEqual([])

  const shared = base()
  await resolveEndpoints($, shared)
  expect(shared.prometheusUrl).toBe('http://metrics.example.ix')
  // No ix grafanaUrl, and the name does not start with prometheus.: the factory default.
  expect(shared.grafanaUrl).toBe(FACTORY_GRAFANA)
})

test('an unset ix key falls to the relay config, then to the factory default, never localhost', async () => {
  trace("FR-007-AC-4", "FR-007-AC-5", "FR-007-AC-6", "FR-007-AC-7")
  let relayConfig = '[watcher]\notlp_endpoint = "http://prometheus.lab.ix/api/v1/otlp"\n'
  const $ = host(
    argv => (argv[0] === 'printenv' ? run('/home/t\n') : run('✧ core.observability.prometheusUrl is unset\n')),
    path => (path === '/home/t/.ix/relay/config.toml' ? relayConfig : ''),
  )
  const fromRelay = base()
  await resolveEndpoints($, fromRelay)
  expect(fromRelay.prometheusUrl).toBe('http://prometheus.lab.ix')
  expect(fromRelay.grafanaUrl).toBe('http://grafana.lab.ix')

  // A collector's address is not Prometheus's: it is ignored.
  relayConfig = '[watcher]\notlp_endpoint = "http://collector.lab.ix:4318/v1/metrics"\n'
  const collector = base()
  await resolveEndpoints($, collector)
  expect(collector.prometheusUrl).toBe(FACTORY_PROMETHEUS)

  relayConfig = ''
  const none = base()
  await resolveEndpoints($, none)
  expect(none.prometheusUrl).toBe(FACTORY_PROMETHEUS)
  expect(none.prometheusUrl).not.toMatch(/localhost/)
})

test('a setting that is not an http or https address is ignored and the lookup continues', async () => {
  trace("FR-007-AC-2")
  const ran: string[] = []
  const $ = host(
    argv => {
      ran.push(argv.join(' '))
      return argv.join(' ') === 'ix config get observability.prometheusUrl' ? run('http://metrics.example.ix\n') : run('', 1)
    },
    () => '',
  )
  const o = base({ prometheusUrl: 'prometheus.local:9090', grafanaUrl: 'ftp://grafana.local' })
  await resolveEndpoints($, o)
  expect(ran).toContain('ix config get observability.prometheusUrl')
  expect(o.prometheusUrl).toBe('http://metrics.example.ix')
  expect(o.grafanaUrl).toBe(FACTORY_GRAFANA)
  expect(o.grafanaUrl).not.toBe('ftp://grafana.local')
})
