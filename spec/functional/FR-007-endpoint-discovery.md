---
id: FR-007
title: Metrics endpoint discovery
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-004"
    type: implements
  - target: "ix://agent-ix/factory-panel/US-005"
    type: implements
---
# FR-007: Metrics endpoint discovery

## Description

The mod SHALL find the Prometheus and Grafana addresses without configuration, trying in order the plugin setting, the shared ix configuration, the endpoint this host's relay already pushes to, and the factory default.

## Behavior

- Where the plugin setting is an http or https address, the mod SHALL use it.
- Where the plugin setting is an http or https address, the mod SHALL NOT run any other lookup.
- Where the plugin setting is not an http or https address, the mod SHALL ignore it and continue the lookup.
- The mod SHALL otherwise read `ix config get observability.prometheusUrl` and `observability.grafanaUrl`, ignoring a reply that says the key is unset.
- The mod SHALL otherwise use the origin of the relay config `otlp_endpoint` only when its path ends in `/api/v1/otlp`.
- The mod SHALL otherwise use `http://prometheus.luna.ix` and `http://grafana.luna.ix`.
- The mod SHALL NOT default to localhost.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-007-AC-1 | With the plugin settings set to http addresses, those addresses are used and no `ix` command is run and no config file is read. | Test |
| FR-007-AC-2 | A plugin setting that is not an http or https address is ignored and the lookup continues. | Test |
| FR-007-AC-3 | An `ix config` value for the Prometheus address is used. | Test |
| FR-007-AC-4 | A reply from `ix config` saying the key is unset is ignored. | Test |
| FR-007-AC-5 | A relay `otlp_endpoint` of `http://prometheus.lab.ix/api/v1/otlp` gives Prometheus `http://prometheus.lab.ix` and Grafana `http://grafana.lab.ix`. | Test |
| FR-007-AC-6 | A relay `otlp_endpoint` whose path is not `/api/v1/otlp` is ignored. | Test |
| FR-007-AC-7 | With none of the above set, the addresses are the factory defaults and neither contains `localhost`. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md), [US-005](../usecase/US-005-trust-what-i-see.md)
