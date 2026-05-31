# Quantova REST API

Quantova™ Protocol · © 2026 Quantova Inc · Licensed under BUSL-1.1

The **public REST API** for the Quantova network: a RESTful HTTP interface that
exchanges, indexers, wallets, and dApps use to read on-chain state, submit signed
transactions, estimate fees, and bridge assets.

It is a single, **zero-dependency** Node.js service ([`server.js`](server.js))
that acts as an **edge gateway** in front of a running Quantova node and proxies
the node's JSON-RPC. Every response is real, live on-chain data:

```
client ──HTTP REST──▶ server.js ──q_ JSON-RPC / chain_*──▶ quantova-node ──▶ chain
```

The gateway holds no keys and never signs. It is connected to the chain through
the Quantova node's JSON-RPC surface (the `q_` namespace the node implements),
so it always reflects the node you point it at — mainnet, testnet, or your own.

---

## Quick start

Requirements: **Node.js ≥ 18** (uses the built-in `http` module and global
`fetch` — there is nothing to `npm install`).

```sh
# Point it at a Quantova node and run
QUANTOVA_RPC_URL=https://mainnet.quantova.io PORT=8080 node server.js

# or with flags
node server.js --rpc-url https://mainnet.quantova.io --port 8080
```

```sh
# Smoke test
curl -s http://localhost:8080/healthz            # -> ok
curl -s http://localhost:8080/v1 | jq            # -> endpoint index
curl -s http://localhost:8080/v1/gas-price | jq  # -> { "gasPrice": "0x..." }
```

### Configuration

All settings are environment variables (CLI flags `--host`, `--port`, `--rpc-url`
override where shown):

| Variable                   | Default                  | Meaning                                                        |
|----------------------------|--------------------------|----------------------------------------------------------------|
| `QUANTOVA_RPC_URL`         | `http://127.0.0.1:9933`  | Upstream Quantova HTTP JSON-RPC endpoint (the `q_` namespace). |
| `PORT`                     | `8080`                   | Port to bind the REST server to.                               |
| `HOST`                     | `0.0.0.0`                | Interface to bind (all by default; front with a proxy in prod).|
| `CORS_ORIGIN`              | `*`                      | `Access-Control-Allow-Origin` value for browser dApps.         |
| `BRIDGE_ATTESTATION_FEE`   | `50000000000000`         | Flat validator attestation fee, QTOV base units (§8.4).        |
| `BRIDGE_DEST_GAS_EVM`      | `2000000000000000`       | Default destination-gas estimate for EVM chains (base units).  |
| `BRIDGE_DEST_GAS_NON_EVM`  | `1000000000000000`       | Default destination-gas estimate for non-EVM chains.           |

Upstream endpoints (Quantova Developer Documentation §16.4):
mainnet `https://mainnet.quantova.io`, testnet `https://testnet.quantova.io`,
local dev `http://127.0.0.1:9933`.

---

## Interacting with the API — copy-paste cheat sheet

Set a base URL once, then every example below is copy-paste runnable. The example
account, hash, and amount are placeholders — replace `TX_HASH` / block numbers /
`rawTransaction` with real values (a non-existent hash simply returns a `404`,
which is itself a valid response).

```sh
export API=http://localhost:8080
ADDR=Q0b22901ba019b7f48327a891d21a9af2547493
TO=Qa0018bcd09ed8fc81b323331950a89541d2416
HASH=0x9999999999999999999999999999999999999999999999999999999999999999   # example
AMOUNT=0x3635c9adc5dea00000                                               # 1000 QTOV

# --- Discovery ---
curl -s "$API/healthz"
curl -s "$API/v1"

# --- Accounts & state ---
curl -s "$API/v1/accounts/$ADDR/balance"
curl -s "$API/v1/accounts/$ADDR/balance?block=0x1554ec6"
curl -s "$API/v1/accounts/$ADDR/transaction-count"
curl -s "$API/v1/accounts/$ADDR/code"
curl -s "$API/v1/accounts/faucet" -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}"                                            # testnet only

# --- Contracts ---
curl -s "$API/v1/contracts/$ADDR/storage/0"
curl -s "$API/v1/contracts/precompiles"
curl -s "$API/v1/contracts/$ADDR/verification"

# --- Blocks (add ?hydrated=true to embed full transactions) ---
curl -s "$API/v1/blocks/latest"
curl -s "$API/v1/blocks/finalized"
curl -s "$API/v1/blocks/number/1000"
curl -s "$API/v1/blocks/hash/$HASH"
curl -s "$API/v1/blocks/number/1000/transaction-count"
curl -s "$API/v1/blocks/hash/$HASH/transaction-count"

# --- Transactions ---
curl -s "$API/v1/transactions/$HASH"
curl -s "$API/v1/transactions/$HASH/receipt"
curl -s "$API/v1/transactions" -H 'content-type: application/json' \
  -d '{"rawTransaction":"0x51..."}'                                      # replace with a signed tx
curl -s "$API/v1/transactions/call" -H 'content-type: application/json' \
  -d "{\"from\":\"$ADDR\",\"to\":\"$TO\",\"input\":\"0x70a08231\"}"
curl -s "$API/v1/transactions/estimate-gas" -H 'content-type: application/json' \
  -d "{\"from\":\"$ADDR\",\"to\":null,\"input\":\"0x6080\"}"

# --- Gas & fees ---
curl -s "$API/v1/gas-price"
curl -s "$API/v1/fees/priority"
curl -s "$API/v1/fees/history?blockCount=4&rewardPercentiles=25,50,75"
curl -s "$API/v1/fees/estimate"
curl -s "$API/v1/fees/simulate" -H 'content-type: application/json' \
  -d "{\"from\":\"$ADDR\",\"to\":\"$TO\",\"value\":\"0xde0b6b3a7640000\"}"

# --- Network & node ---
curl -s "$API/v1/chain/id"
curl -s "$API/v1/network/version"
curl -s "$API/v1/network/listening"
curl -s "$API/v1/node/syncing"
curl -s "$API/v1/node/client-version"
curl -s "$API/v1/node/accounts"

# --- Staking (NPoS) ---
curl -s "$API/v1/staking/validators/waiting"
curl -s "$API/v1/staking/delegators/$ADDR/rewards"
curl -s "$API/v1/staking/parameters"

# --- QNS (Quantova Name Service) ---
curl -s "$API/v1/qns/resolve/alice.qtov"
curl -s "$API/v1/qns/reverse/$ADDR"
curl -s "$API/v1/qns/info/alice.qtov"
curl -s "$API/v1/qns/price/alice.qtov?duration=2"
curl -s "$API/v1/qns/commit" -H 'content-type: application/json' \
  -d "{\"name\":\"alice.qtov\",\"owner\":\"$ADDR\",\"secret\":\"0x$(printf '%064d' 0)\"}"
curl -s "$API/v1/qns/reveal" -H 'content-type: application/json' \
  -d "{\"name\":\"alice.qtov\",\"owner\":\"$ADDR\",\"secret\":\"0x$(printf '%064d' 0)\",\"duration\":2}"

# --- Bridge ---
curl -s "$API/v1/bridge/quote" -H 'content-type: application/json' \
  -d "{\"network\":\"ethereum\",\"asset\":{\"native\":true},\"amount\":\"$AMOUNT\"}"
curl -s "$API/v1/bridge/initiate" -H 'content-type: application/json' \
  -d "{\"network\":\"bsc\",\"from\":\"$ADDR\",\"asset\":{\"native\":true},\"amount\":\"$AMOUNT\"}"
curl -s "$API/v1/bridge/status/$HASH?network=ethereum&direction=outbound"
curl -s "$API/v1/bridge/claim" -H 'content-type: application/json' \
  -d "{\"network\":\"ethereum\",\"beneficiary\":\"$ADDR\",\"nonce\":42}"
```

Pipe any response through `| jq` for pretty output. The per-endpoint reference
with response shapes is in [Endpoints](#endpoints) below.

## How it works

Quantova exposes a branded JSON-RPC namespace, `q_` (e.g. `q_getBalance`,
`q_getBlockByNumber`, `q_sendRawTransaction`), which is the canonical interface
for reading chain state and submitting transactions. This REST API maps clean,
RESTful routes onto those methods (plus the standard `chain_getFinalizedHead` for
finality), and adds the fee-estimation and bridging helpers.

Because every handler proxies a live node call, there is no separate database or
indexer to keep in sync — the data is exactly what the node reports.

> **A note on scope.** Quantova's developer documentation defines the `q_`
> JSON-RPC namespace for chain reads/transactions and a small set of REST helpers
> for fees and bridging. This service exposes **both** through one REST surface:
> the fee/bridge endpoints mirror the documented REST helpers, and the
> account/block/transaction/network endpoints are RESTful projections of the
> documented `q_` methods. This document is the canonical reference for the full
> REST surface.

---

## Conventions

### Encoding

| Type        | Encoding                                                                | Example                                      |
|-------------|-------------------------------------------------------------------------|----------------------------------------------|
| **ADDRESS** | Canonical `Q`-format string (byte 0 is the fixed `0x40` marker)         | `Qa0018bcd09ed8fc81b323331950a89541d2416`    |
| **QUANTITY**| `0x`-prefixed hex integer, no leading zeroes; `0x0` for zero            | `0x5208`                                      |
| **DATA**    | `0x`-prefixed hex byte array                                            | `0xa9059cbb…`                                 |
| **Hash**    | 32-byte `0x` SHA3 hex (never `Q`)                                       | `0x9f3c…1a3`                                  |
| **block**   | A block number (decimal or `0x` QUANTITY) **or** a 32-byte `0x` hash    | `1234`, `0x12d`, `0x9f3c…1a3`                 |

* All amounts are in QTOV **base units** (18 decimals). Endpoints that return a
  balance/fee also include a human-readable `…Display` field (e.g. `"8.876… QTOV"`).
* **Block parameter.** Read endpoints take an optional `?block=` (number or hash).
  Named tags (`latest`, `finalized`, …) are **not accepted**; use the dedicated
  `GET /v1/blocks/latest` and `GET /v1/blocks/finalized` routes. Omitting `?block=`
  reads the latest block.

### Finality (recommended for exchanges)

Quantova has deterministic finality — once a block is finalized it will not be
reorged. Exchanges crediting deposits should read **finalized** state: call
`GET /v1/blocks/finalized` to learn the finalized height, then pin subsequent
reads to that block number via `?block=`. Acting on the latest (possibly
not-yet-finalized) head is discouraged for settlement decisions.

### Errors

Errors use a JSON-RPC-style envelope:

```json
{ "error": { "code": -32602, "message": "address must start with 'Q': 0xabc" } }
```

| HTTP | `code`   | Meaning                                           |
|------|----------|---------------------------------------------------|
| 400  | `-32602` | Invalid request / parameters                      |
| 404  | `-32001` | Resource not found (unknown block / tx / receipt) |
| 502  | `-32000` | Upstream node error / node unreachable            |
| 500  | `-32603` | Unexpected internal error                         |

### CORS, auth & rate limiting

The service sends permissive CORS headers by default (`CORS_ORIGIN`, default `*`)
and handles `OPTIONS` preflight. It is **unauthenticated by design** and is meant
to run behind a reverse proxy / API gateway that terminates TLS and applies
authentication and rate limiting — the standard pattern for a public chain API.
The node itself should run with `--rpc-methods Safe` and never be exposed
directly.

---

## Endpoints

### Discovery

| Method | Route        | Description                                  |
|--------|--------------|----------------------------------------------|
| GET    | `/v1`        | Machine-readable index + encoding rules.     |
| GET    | `/healthz`   | Liveness probe (returns `ok`).               |

### Accounts & state

#### `GET /v1/accounts/{address}/balance`
QTOV balance of an account. *(→ `q_getBalance`)*
```sh
curl -s "$API/v1/accounts/Q0b22901ba019b7f48327a891d21a9af2547493/balance"
```
```json
{ "address": "Q0b229…7493", "balance": "0x7b2f1c8a0d9e4000", "balanceDisplay": "8.876… QTOV", "block": "0x1554ec6" }
```

#### `GET /v1/accounts/{address}/transaction-count`
Account nonce (number of transactions sent). *(→ `q_getTransactionCount`)*
```json
{ "address": "Q0b229…7493", "transactionCount": "0x2a", "block": "0x1554ec6" }
```

#### `GET /v1/accounts/{address}/code`
Deployed QVM bytecode (`0x` if not a contract). *(→ `q_getCode`)*
```json
{ "address": "Qc1488…0f48", "code": "0x6080…", "isContract": true }
```

#### `GET /v1/contracts/{address}/storage/{slot}`
Raw 32-byte value at a storage slot. *(→ `q_getStorageAt`)*
```json
{ "address": "Qc1488…0f48", "slot": "0x0", "value": "0x0000…0001" }
```

Balance, transaction-count, code, and storage all accept `?block=` (number or
hash; default latest).

#### `POST /v1/accounts/faucet`
Request a testnet QTOV drip to an address so developers can fund accounts. The
node enforces eligibility (per-address rate limit and drip amount) and rejects the
request on networks where the faucet is disabled (e.g. mainnet). *(→ `q_faucetDrip`)*
```sh
curl -s "$API/v1/accounts/faucet" -H 'content-type: application/json' \
  -d '{ "address": "Q0b229…7493" }'
```
```json
{ "address": "Q0b229…7493", "transactionHash": "0x9f3c…1a3",
  "amount": "0x8ac7230489e80000", "amountDisplay": "10 QTOV",
  "next": "poll GET /v1/transactions/:hash/receipt to confirm the drip is mined" }
```

### Smart contracts

#### `GET /v1/contracts/precompiles`
The chain's precompiled contracts — fixed addresses and what each implements.
*(→ `q_getPrecompiles`)*
```json
{ "precompiles": [
  { "address": "Q0000000000000000000000000000000000000001", "name": "ecrecover" },
  { "address": "Q0000000000000000000000000000000000000801", "name": "dilithium-verify" }
] }
```

#### `GET /v1/contracts/{address}/verification`
Source-verification status for a deployed contract (verified flag, compiler,
metadata), returned verbatim from the node's verifier. `404` if there is no
contract — or no verification record — at the address. *(→ `q_getContractVerification`)*
```json
{ "address": "Qc1488…0f48", "verified": true, "compiler": "solc 0.8.25",
  "language": "Solidity", "name": "QRC20Token", "optimizer": { "enabled": true, "runs": 200 } }
```

### Blocks

All block endpoints accept `?hydrated=true` to embed full transaction objects.

| Method | Route                                          | → method                                      |
|--------|------------------------------------------------|-----------------------------------------------|
| GET    | `/v1/blocks/latest`                            | `q_blockNumber` → `q_getBlockByNumber`        |
| GET    | `/v1/blocks/finalized`                         | `chain_getFinalizedHead` → `q_getBlockByHash` |
| GET    | `/v1/blocks/number/{number}`                   | `q_getBlockByNumber`                          |
| GET    | `/v1/blocks/hash/{hash}`                       | `q_getBlockByHash`                            |
| GET    | `/v1/blocks/number/{number}/transaction-count` | `q_getBlockTransactionCountByNumber`          |
| GET    | `/v1/blocks/hash/{hash}/transaction-count`     | `q_getBlockTransactionCountByHash`            |

```sh
curl -s "$API/v1/blocks/finalized"
```
Block objects are returned verbatim from the node (canonical Q-format and
QUANTITY throughout). `404` if the block does not exist. Transaction-count routes
return `{ "transactionCount": "0x12" }`.

### Transactions

#### `GET /v1/transactions/{hash}`
Transaction by hash. *(→ `q_getTransactionByHash`)* `404` if unknown.

#### `GET /v1/transactions/{hash}/receipt`
Receipt — status, gas used, logs, and (for deployments) the new contract address.
Poll to confirm a transaction. *(→ `q_getTransactionReceipt`)* `404` until mined.
```json
{ "transactionHash": "0x9f3c…1a3", "blockNumber": "0x1554ec6", "status": "0x1", "gasUsed": "0x5208", "logs": [] }
```

#### `POST /v1/transactions`
Broadcast an already-signed, serialized QVM transaction. The gateway **does not
sign** — sign locally with your post-quantum key, then submit.
*(→ `q_sendRawTransaction`)*
```sh
curl -s "$API/v1/transactions" -H 'content-type: application/json' \
  -d '{ "rawTransaction": "0x51…" }'
# -> { "transactionHash": "0x9f3c…1a3" }
```

#### `POST /v1/transactions/call`
Read-only contract call; no state change, no gas spent. *(→ `q_call`)*
```json
{ "from": "Q0b229…7493", "to": "Qc1488…0f48", "input": "0x70a08231…", "block": "0x1554ec6" }
```
`to` may be `null` for a deployment call; `block` optional. Returns `{ "data": "0x…" }`.

#### `POST /v1/transactions/estimate-gas`
Estimate QGAS for a call or deployment. *(→ `q_estimateGas`)*
```json
{ "from": "Q0b229…7493", "to": null, "input": "0x6080…" }
# -> { "gas": "0x5208" }
```

### Gas & fees

#### `GET /v1/gas-price` → `{ "gasPrice": "0x3e8" }` *(`q_gasPrice`)*
#### `GET /v1/fees/priority` → `{ "maxPriorityFeePerGas": "0xc8" }` *(`q_maxPriorityFeePerGas`)*

#### `GET /v1/fees/history`
Recent base fees, reward percentiles, and gas-used ratios. *(→ `q_feeHistory`)*
Query: `blockCount` (default `5`), `newestBlock` (number/hash, default latest),
`rewardPercentiles` (comma-separated, default `25,50,75`).
```json
{ "oldestBlock": "0x1554ec2", "reward": [["0x64","0xc8","0x12c"]], "baseFeePerGas": ["0x3e8"], "gasUsedRatio": [0.5] }
```

#### `GET /v1/fees/estimate`
Suggested base fee + priority fee, with slow/standard/fast tiers (from
`q_feeHistory`). Fee model is EIP-1559 with no burn (base → treasury, tip →
validator).
```json
{ "baseFeePerGas": "0x3e8", "maxPriorityFeePerGas": "0xc8", "maxFeePerGas": "0x4b0",
  "priorityFeeTiers": { "slow": "0x64", "standard": "0xc8", "fast": "0x12c" }, "model": "eip1559-no-burn" }
```

#### `POST /v1/fees/simulate`
Total fee for a proposed transaction. *(→ `q_estimateGas` + `q_gasPrice`)*
```json
{ "from": "Q0b229…7493", "to": "Qa0018…2416", "value": "0xde0b6b3a7640000" }
```
```json
{ "gas": "0x5208", "baseFeePerGas": "0x3e8", "maxPriorityFeePerGas": "0xc8",
  "effectiveGasPrice": "0x4b0", "fee": "0x…", "totalCost": "0x…", "totalCostDisplay": "0.05… QTOV" }
```
`fee` excludes any transferred `value`; `totalCost` includes it. `gas` optional
(estimated if absent).

### Network & node

| Method | Route                         | → method               | Response                                 |
|--------|-------------------------------|------------------------|------------------------------------------|
| GET    | `/v1/chain/id`                | `q_chainId`            | `{ "chainId": "0x2a" }`                  |
| GET    | `/v1/network/version`         | `q_net_version`        | `{ "networkVersion": "42" }`             |
| GET    | `/v1/network/listening`       | `q_listening`          | `{ "listening": true }`                  |
| GET    | `/v1/node/syncing`            | `q_syncing`            | `{ "syncing": false }` or a progress obj |
| GET    | `/v1/node/client-version`     | `q_web3_clientVersion` | `{ "clientVersion": "quantova-node/…" }` |
| GET    | `/v1/node/accounts`           | `q_accounts`           | `{ "accounts": [] }`                     |

### Staking (NPoS)

Quantova secures the network with Nominated Proof-of-Stake (§10): validators are
selected each era from the bonded set, and delegators (nominators) back them and
share rewards.

#### `GET /v1/staking/validators/waiting`
Bonded validators in the **waiting** set — eligible but not selected into the
active set this era. *(→ `q_stakingWaitingValidators`)*
```json
{ "waiting": [
  { "address": "Q5f3a…11c0", "ownStake": "0x…", "totalStake": "0x…", "commission": "0x2710" }
] }
```

#### `GET /v1/staking/delegators/{address}/rewards`
Unclaimed staking rewards owed to a delegator across the validators it backs.
`404` if the address has no staking position. *(→ `q_stakingPendingRewards`)*
```json
{ "address": "Q0b229…7493", "total": "0x1bc16d674ec80000", "totalDisplay": "2 QTOV",
  "breakdown": [ { "validator": "Q5f3a…11c0", "era": 412, "amount": "0xde0b6b3a7640000" } ] }
```

#### `GET /v1/staking/parameters`
Network-wide staking parameters — active era, minimum stakes, unbonding period,
validator count, inflation — returned verbatim from the node. *(→ `q_stakingParameters`)*
```json
{ "activeEra": 412, "validatorCount": 100, "minValidatorBond": "0x…",
  "minNominatorBond": "0x…", "unbondingPeriodEras": 28, "historyDepth": 84,
  "maxNominatorsPerValidator": 256, "inflationAnnual": "0x…" }
```

### QNS — Quantova Name Service

Human-readable names under the `.qtov` TLD that map to Q-addresses (§14).
Registration is a two-step **commit → reveal** flow that front-runs cannot
exploit: commit a blinded hash, wait the minimum commitment age, then reveal the
name. State-changing steps return an **unsigned** transaction descriptor (the
gateway never signs); sign locally and submit via `POST /v1/transactions`.

#### `GET /v1/qns/resolve/{name}`
Forward resolution: name → the Q-address it points at. `404` if unset.
*(→ `q_qnsResolve`)*
```json
{ "name": "alice.qtov", "address": "Q0b229…7493" }
```

#### `GET /v1/qns/reverse/{address}`
Reverse resolution: Q-address → its primary name. `404` if no reverse record.
*(→ `q_qnsReverseLookup`)*
```json
{ "address": "Q0b229…7493", "name": "alice.qtov" }
```

#### `GET /v1/qns/info/{name}`
Registration record — owner, resolver, expiry. `404` if the name is unregistered.
*(→ `q_qnsGetInfo`)*
```json
{ "name": "alice.qtov", "owner": "Q0b229…7493", "resolver": "Qc1488…0f48",
  "expiry": "0x6701e880", "registeredAt": "0x65f0a200" }
```

#### `GET /v1/qns/price/{name}`
Registration price over a duration. Query: `duration` (years, default `1`). The
node returns a base + premium split (the premium decays after a name is released).
*(→ `q_qnsPrice`)*
```json
{ "name": "alice.qtov", "durationYears": 2, "base": "0x1bc16d674ec80000",
  "premium": "0x0", "total": "0x1bc16d674ec80000", "totalDisplay": "2 QTOV" }
```

#### `POST /v1/qns/commit`
Step 1 of registration. The node derives the commitment hash from
`(name, owner, secret)`; the response carries it plus an unsigned `Qns.commit`
transaction. The `secret` is a client-generated 32-byte value (`0x` + 64 hex) and
is **not** sent on-chain here — keep it private until reveal. *(→ `q_qnsMakeCommitment`)*
```sh
curl -s "$API/v1/qns/commit" -H 'content-type: application/json' \
  -d '{ "name": "alice.qtov", "owner": "Q0b229…7493", "secret": "0x1234…cdef" }'
```
```json
{
  "name": "alice.qtov",
  "commitment": "0x7a1b…f09c",
  "unsignedTransaction": { "pallet": "Qns", "call": "commit", "args": { "commitment": "0x7a1b…f09c" }, "signer": "Q0b229…7493" },
  "next": "sign locally and submit via POST /v1/transactions, then wait the minimum commitment age before POST /v1/qns/reveal"
}
```

#### `POST /v1/qns/reveal`
Step 2 of registration: reveal the committed name and register it. Pass the same
`secret` used at commit time and a `duration` (years, default `1`). Returns the
price `quote` plus an unsigned `Qns.register` transaction. *(→ `q_qnsPrice` + `Qns.register`)*
```sh
curl -s "$API/v1/qns/reveal" -H 'content-type: application/json' \
  -d '{ "name": "alice.qtov", "owner": "Q0b229…7493", "secret": "0x1234…cdef", "duration": 2 }'
```
```json
{
  "quote": { "name": "alice.qtov", "durationYears": 2, "total": "0x1bc16d674ec80000", "totalDisplay": "2 QTOV", "...": "see /v1/qns/price" },
  "unsignedTransaction": { "pallet": "Qns", "call": "register",
    "args": { "name": "alice.qtov", "owner": "Q0b229…7493", "durationYears": "0x2", "secret": "0x1234…cdef" }, "signer": "Q0b229…7493" },
  "next": "sign locally with your post-quantum key, then submit via POST /v1/transactions"
}
```

### Bridge

Bridge fees follow the asset-tier model (§8.4):

```
Total Bridge Fee = Protocol Fee + Validator Attestation Fee + Destination Gas
```

| Asset tier                        | Protocol fee |
|-----------------------------------|--------------|
| Native QTOV                       | 0.05%        |
| Major stablecoins / major assets  | 0.10%        |
| Long-tail / wrapped assets        | 0.15%        |

Bridges are permissionless (no protocol min/max/per-address caps). Estimated
settlement: outbound EVM 3–8 min, outbound non-EVM 8–15 min, inbound EVM 5–12 min,
inbound non-EVM 10–20 min.

#### `POST /v1/bridge/quote`
Fee breakdown for a proposed bridge.
```json
{ "network": "ethereum", "direction": "outbound", "asset": { "native": true }, "amount": "0x3635c9adc5dea00000" }
```
For a foreign token: `"asset": { "network": "ethereum", "tokenAddress": "0x…", "tier": "major" }`.
```json
{ "network": "ethereum", "direction": "outbound", "feeTier": "native (0.05%)",
  "protocolFee": "0x…", "validatorAttestationFee": "0x2d79883d2000", "destinationGas": "0x71afd498d0000",
  "totalBridgeFee": "0x…", "amountAfterFees": "0x…", "totalBridgeFeeDisplay": "0.5… QTOV",
  "estimatedSettlement": "3-8 minutes", "caps": "permissionless: no protocol min/max/per-address caps" }
```

#### `POST /v1/bridge/initiate`
Build an **outbound** bridge transaction. Returns the fee `quote` plus an
*unsigned* transaction descriptor targeting the bridge module
(`register_outward_transfer`). Sign locally and submit via `POST /v1/transactions`.
```json
{ "network": "bsc", "from": "Q0b229…7493", "asset": { "native": true }, "amount": "0x3635c9adc5dea00000" }
```
```json
{
  "quote": { "...": "see /v1/bridge/quote" },
  "unsignedTransaction": {
    "pallet": "Bridge",
    "call": "register_outward_transfer",
    "args": { "network": "BSC", "amount": "0x3635c9adc5dea00000", "assetId": "Native" },
    "signer": "Q0b229…7493"
  },
  "next": "sign locally with your post-quantum key, then submit via POST /v1/transactions"
}
```
`args.network` and `assetId` use the SCALE enum variant names (`BSC`/`Ethereum`/
`TRON`; `Native` / `{Foreign:{network,identifier}}`) so the SDK can encode the
extrinsic directly.

#### `GET /v1/bridge/status/{tx}`
Bridge progress for the originating Quantova transaction.
*(→ `q_getTransactionReceipt` + `q_blockNumber`)* Optional query `network`,
`direction` refine the settlement-window estimate.
```json
{ "transactionHash": "0x9f3c…1a3", "phase": "awaiting_settlement", "sourceFinalized": true,
  "sourceBlock": "0x1554ec6", "sourceGasUsed": "0x5208", "estimatedSettlement": "3-8 minutes",
  "detail": "source finalized on Quantova; destination settlement proceeds via the bridge pallet's proof/relayer path (Ch.12)" }
```
Phases: `pending` → `source_included` → `awaiting_settlement`, or `failed`.

#### `POST /v1/bridge/claim`
Reports how inbound assets are credited. Inbound credit is proof-driven
(Ethereum/BSC light-client + Merkle proof) or relayer-multisig (TRON); there is
no end-user claim extrinsic, so this endpoint reports settlement status.
```json
{ "network": "ethereum", "beneficiary": "Q0b229…7493", "nonce": 42 }
```
```json
{ "network": "ethereum", "beneficiary": "Q0b229…7493", "nonce": 42,
  "mechanism": "trust-minimized: light-client + EIP-1186 Merkle proof, credited by the bridge pallet in consensus",
  "userActionRequired": false, "estimatedSettlement": "5-12 minutes",
  "detail": "no end-user claim is required; the relayer submits the inclusion proof and the pallet credits your account once the source-chain header is finalized (§12.2)" }
```

---

## Endpoint → upstream method map

| REST route                                         | Upstream method                               |
|----------------------------------------------------|-----------------------------------------------|
| `GET /v1/accounts/{a}/balance`                     | `q_getBalance`                                |
| `GET /v1/accounts/{a}/transaction-count`           | `q_getTransactionCount`                       |
| `GET /v1/accounts/{a}/code`                        | `q_getCode`                                   |
| `POST /v1/accounts/faucet`                         | `q_faucetDrip`                                |
| `GET /v1/contracts/{a}/storage/{slot}`             | `q_getStorageAt`                              |
| `GET /v1/contracts/precompiles`                    | `q_getPrecompiles`                            |
| `GET /v1/contracts/{a}/verification`               | `q_getContractVerification`                   |
| `GET /v1/blocks/latest`                            | `q_blockNumber` → `q_getBlockByNumber`        |
| `GET /v1/blocks/finalized`                         | `chain_getFinalizedHead` → `q_getBlockByHash` |
| `GET /v1/blocks/number/{n}`                        | `q_getBlockByNumber`                          |
| `GET /v1/blocks/hash/{h}`                          | `q_getBlockByHash`                            |
| `GET /v1/blocks/number/{n}/transaction-count`      | `q_getBlockTransactionCountByNumber`          |
| `GET /v1/blocks/hash/{h}/transaction-count`        | `q_getBlockTransactionCountByHash`            |
| `GET /v1/transactions/{h}`                         | `q_getTransactionByHash`                      |
| `GET /v1/transactions/{h}/receipt`                 | `q_getTransactionReceipt`                     |
| `POST /v1/transactions`                            | `q_sendRawTransaction`                        |
| `POST /v1/transactions/call`                       | `q_call`                                      |
| `POST /v1/transactions/estimate-gas`               | `q_estimateGas`                               |
| `GET /v1/gas-price`                                | `q_gasPrice`                                  |
| `GET /v1/fees/priority`                            | `q_maxPriorityFeePerGas`                      |
| `GET /v1/fees/history`                             | `q_feeHistory`                                |
| `GET /v1/fees/estimate`                            | `q_gasPrice` + `q_maxPriorityFeePerGas` + `q_feeHistory` |
| `POST /v1/fees/simulate`                           | `q_estimateGas` + `q_gasPrice`                |
| `GET /v1/chain/id`                                 | `q_chainId`                                   |
| `GET /v1/network/version`                          | `q_net_version`                               |
| `GET /v1/network/listening`                        | `q_listening`                                 |
| `GET /v1/node/syncing`                             | `q_syncing`                                   |
| `GET /v1/node/client-version`                      | `q_web3_clientVersion`                        |
| `GET /v1/node/accounts`                            | `q_accounts`                                  |
| `GET /v1/staking/validators/waiting`               | `q_stakingWaitingValidators`                  |
| `GET /v1/staking/delegators/{a}/rewards`           | `q_stakingPendingRewards`                     |
| `GET /v1/staking/parameters`                       | `q_stakingParameters`                         |
| `GET /v1/qns/resolve/{name}`                       | `q_qnsResolve`                                |
| `GET /v1/qns/reverse/{a}`                          | `q_qnsReverseLookup`                          |
| `GET /v1/qns/info/{name}`                          | `q_qnsGetInfo`                                |
| `GET /v1/qns/price/{name}`                         | `q_qnsPrice`                                  |
| `POST /v1/qns/commit`                              | `q_qnsMakeCommitment` → `Qns.commit` (unsigned) |
| `POST /v1/qns/reveal`                              | `q_qnsPrice` → `Qns.register` (unsigned)      |
| `POST /v1/bridge/quote`                            | asset-tier fee model (§8.4)                   |
| `POST /v1/bridge/initiate`                         | `register_outward_transfer` (unsigned)        |
| `GET /v1/bridge/status/{tx}`                       | `q_getTransactionReceipt` + `q_blockNumber`   |
| `POST /v1/bridge/claim`                            | inbound deposit model (§12.2–12.4)            |

---

## Deploying publicly

A typical production setup:

1. Run a Quantova full or archive node with `--rpc-methods Safe` (an archive node
   is recommended for historical reads). Keep its RPC private.
2. Run this gateway pointed at that node:
   ```sh
   QUANTOVA_RPC_URL=http://127.0.0.1:9933 HOST=127.0.0.1 PORT=8080 node server.js
   ```
   A `systemd` unit or container is fine — it is a single stateless process.
3. Put a reverse proxy (nginx, Caddy, Cloudflare, an API gateway, …) in front to
   terminate TLS and apply authentication, rate limits, and caching for hot read
   endpoints.
4. Publish the proxy's hostname (e.g. `https://api.quantova.io`) as the public
   base URL. All routes live under `/v1`.

Example container:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server.js .
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
```

---

## Notes

* **No keys, no signing.** Submission endpoints take an already-signed raw
  transaction; signing happens client-side with a post-quantum key.
* **Computed vs. read values.** Almost every field is read directly from the
  chain. The exceptions are bridge `validatorAttestationFee` (a flat,
  governance-tunable fee, configurable via `BRIDGE_ATTESTATION_FEE`) and the
  bridge `destinationGas` estimate (configurable / overridable per request) —
  destination gas is inherently variable.
* **It needs a node.** The API only returns real data when `QUANTOVA_RPC_URL`
  points at a reachable Quantova node; if the node is unreachable, endpoints
  return `502` with a clear message.

---

© 2026 Quantova Inc · Licensed under BUSL-1.1 · Quantova™ and QTOV™ are
trademarks of Quantova Inc.
