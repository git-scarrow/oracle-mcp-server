# Lab Backend Mirror

This repo now contains the backend-native version of the Lab control plane described in `../notion-forge`.

## What is implemented

- Oracle and PostgreSQL bootstrap DDL for the mirrored Lab schema
- backend-owned state tables for Work Items, Projects, Control, Audit, Telemetry, Evidence Dossier, and Scene Items
- outbox/event tables and basic database triggers for dispatch, return, and synthesis edges
- Lab-native MCP tools layered on top of Oracle:
  - `check_gates`
  - `get_dispatchable_items`
  - `build_dispatch_packet`
  - `stamp_dispatch_consumed`
  - `fail_dispatch_preflight`
  - `handle_final_return`
  - `dispatch_scene`

## Entry and exit points

Entries:
- Notion projection/ingress writes into backend tables
- MCP calls directly against Oracle
- external webhooks posting final returns
- scheduler-driven workers polling `lab_outbox_events`

Exits:
- outbox workers invoke agents and execution planes
- projected updates flow back to Notion pages/views
- audit and telemetry rows are appended in backend tables

## Automation ownership

Database triggers only do three things:
- stamp latches and timestamps
- enforce invariant-friendly defaults
- enqueue outbox rows

They do not run agent logic. Agent or integration workers consume `lab_outbox_events`.

## Oracle vs Postgres

Oracle is the primary production target in this repo because it can hold both the control-plane data and the Oracle-native search/retrieval layer.

PostgreSQL is included as the alternate backend because it supports the same schema and outbox pattern with lower operational weight.
