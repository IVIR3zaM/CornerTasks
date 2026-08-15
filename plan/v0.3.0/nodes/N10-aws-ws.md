---
id: N10
title: AWS WebSocket support (API Gateway WS API)
model: opus
deps: [N02, N04]
---

## Goal

Transport parity for the AWS deployment: the same frames, the same fan-out
semantics, on API Gateway's WebSocket API.

## Read D3 first

This is the most expensive node in the graph and the only one whose absence
degrades gracefully — `/v1/meta` lets a REST-only backend advertise itself and
be handled correctly by every client. If D3 resolves to "defer", move this node
to v0.3.1 and drop it from N17's dependencies.

## Requirements

- New `AWS::Serverless::HttpApi`-adjacent WebSocket API in `template.yaml` with
  `$connect`, `$disconnect`, `$default` routes.
- **Connection registry**: DynamoDB table keyed by `connectionId` with a GSI on
  `accountDid` and a TTL attribute. API Gateway will not tell you a connection
  died promptly; the TTL is what stops the table filling with corpses.
- **Auth on `$connect` is not possible with custom headers** — same constraint
  the Node server has, which is why D2 picks first-frame auth. `$connect`
  accepts unauthenticated and registers nothing; the `auth` frame on `$default`
  is what writes the registry row.
- **Fan-out** via `ApiGatewayManagementApi.postToConnection`; delete the
  registry row on `GoneException`.
- Reuse the shared push/query functions from `backend/core` — no second copy of
  accept/reject or cursor logic.
- Lambda cold starts mean a drain can exceed the frame budget; specify and test
  chunked drain.

## Acceptance

- `cd backend/aws && npm test && sam validate`.
- Handler-level tests with a mocked management API: auth gating, drain
  ordering, fan-out excludes sender, `GoneException` prunes the row.
- **Cross-runtime conformance**: the N16 WS suite passes unmodified against
  both this and the Node server. One suite, two backends — that is the parity
  guarantee.

## Out of scope

Changing the REST endpoints; migrating existing deployments (N17 notes it).
