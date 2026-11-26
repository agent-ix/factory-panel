import type { EngineInterface } from 'claude-code'

import { spawn } from './shared'
import type { Options } from './shared'

// Where the panes read metrics. Highest first: the plugin's own setting, the shared ix config
// (`ix config get observability.prometheusUrl`), the endpoint this host's relay already pushes
// to (`[watcher] otlp_endpoint` in ~/.ix/relay/config.toml), then the factory default. A host
// with none of them set reaches the factory's metrics on luna.ix, never localhost.
export const FACTORY_PROMETHEUS = 'http://prometheus.luna.ix'
export const FACTORY_GRAFANA = 'http://grafana.luna.ix'

/** The scheme and host of a URL, without path or trailing slash; undefined when it is not one. */
export const originOf = (text: string): string | undefined => {
  const match = /^(https?:\/\/[^/\s?#]+)/i.exec(text.trim())
  return match?.[1]
}

/** The otlp_endpoint a relay config names, e.g. `http://prometheus.luna.ix/api/v1/otlp`. */
export const otlpEndpointOf = (toml: string): string | undefined => {
  const match = /^\s*otlp_endpoint\s*=\s*"([^"]+)"/m.exec(toml)
  return match?.[1]
}

/** Grafana's address from Prometheus's, when it follows the `prometheus.<domain>` naming. */
export const grafanaFrom = (prometheus: string): string | undefined => {
  const origin = originOf(prometheus)
  return origin !== undefined && /\/\/prometheus\./i.test(origin) ? origin.replace(/\/\/prometheus\./i, '//grafana.') : undefined
}

async function ixConfig($: EngineInterface, key: string): Promise<string | undefined> {
  try {
    const ran = await spawn($, ['ix', 'config', 'get', key], 5_000)
    if (ran.exitCode !== 0) return undefined
    // An unset key prints a notice; only a URL counts as a value, wherever the CLI puts it.
    const plain = ran.stdout.replace(/\u001b\[[0-9;]*m/g, '')
    if (/\bis unset\b/i.test(plain)) return undefined
    return originOf(/https?:\/\/[^\s"']+/i.exec(plain)?.[0] ?? '')
  } catch {
    return undefined
  }
}

async function relayEndpoint($: EngineInterface): Promise<string | undefined> {
  try {
    const home = (await spawn($, ['printenv', 'HOME'], 5_000)).stdout.trim()
    if (home === '') return undefined
    const toml = await $.fs.read(`${home}/.ix/relay/config.toml`)
    const url = otlpEndpointOf(typeof toml === 'string' ? toml : '')
    // Only Prometheus's own OTLP receiver says where Prometheus is; a collector's address would not.
    return url !== undefined && /\/api\/v1\/otlp\/?$/.test(url) ? originOf(url) : undefined
  } catch {
    return undefined
  }
}

/**
 * Fills the metrics addresses a person left empty. Mutates `options` in place, since every pane
 * holds that one object, and says where each came from in the debug log. Never throws.
 */
export async function resolveEndpoints($: EngineInterface, options: Options): Promise<void> {
  // A setting that is not an http(s) address is ignored, as if it were empty.
  if (originOf(options.prometheusUrl) === undefined) options.prometheusUrl = ''
  if (originOf(options.grafanaUrl) === undefined) options.grafanaUrl = ''
  let from = 'plugin setting'
  if (options.prometheusUrl === '') {
    const shared = await ixConfig($, 'observability.prometheusUrl')
    const relay = shared === undefined ? await relayEndpoint($) : undefined
    options.prometheusUrl = shared ?? relay ?? FACTORY_PROMETHEUS
    from = shared !== undefined ? 'ix config observability.prometheusUrl' : relay !== undefined ? 'relay config otlp_endpoint' : 'factory default'
  }
  let grafanaFromWhere = 'plugin setting'
  if (options.grafanaUrl === '') {
    const shared = await ixConfig($, 'observability.grafanaUrl')
    const derived = shared === undefined ? grafanaFrom(options.prometheusUrl) : undefined
    options.grafanaUrl = shared ?? derived ?? FACTORY_GRAFANA
    grafanaFromWhere = shared !== undefined ? 'ix config observability.grafanaUrl' : derived !== undefined ? 'derived from Prometheus' : 'factory default'
  }
  $.ui.log(`factory-panel: Prometheus ${options.prometheusUrl} (${from}); Grafana ${options.grafanaUrl} (${grafanaFromWhere})`, { to: 'debug' })
}
