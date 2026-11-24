---
id: FR-007
title: Metrics endpoint discovery
type: FR
relationships:
  - target: "ix://agent-ix/factory-panel/US-004"
    type: implements
---
# FR-007: Metrics endpoint discovery

## Description

The mod SHALL find the Prometheus and Grafana addresses without configuration, trying in order the plugin setting, the shared ix configuration, the endpoint this host's relay already pushes to, and the factory default.

## Behavior

- Where the plugin setting is not empty, the mod SHALL use it.
- Where the plugin setting is not empty, the mod SHALL NOT run any other lookup.
- The mod SHALL otherwise read `ix config get observability.prometheusUrl` and `observability.grafanaUrl`, ignoring a reply that says the key is unset.
- The mod SHALL otherwise use the origin of the relay config `otlp_endpoint` only when its path ends in `/api/v1/otlp`.
- The mod SHALL otherwise use `http://prometheus.luna.ix` and `http://grafana.luna.ix`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-007-AC-1 | Given the plugin settings are set, those addresses are used and no `ix` or file lookup runs. | Test |
| FR-007-AC-2 | Given an `ix config` value for the Prometheus address, it is used. | Test |
| FR-007-AC-3 | Given `ix config` says the key is unset, the reply is ignored. | Test |
| FR-007-AC-4 | Given a relay `otlp_endpoint` of `http://prometheus.lab.ix/api/v1/otlp`, Prometheus is `http://prometheus.lab.ix` and Grafana is `http://grafana.lab.ix`; given a collector endpoint with another path, it is ignored. | Test |
| FR-007-AC-5 | Given none of the above, the addresses are the factory defaults and neither contains `localhost`. | Test |

## Dependencies

- **Upstream**: [US-004](../usecase/US-004-set-up-once.md)
