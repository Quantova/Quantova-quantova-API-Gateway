// Quantova™ Protocol — Public REST API
// © 2026 Quantova Inc · Licensed under BUSL-1.1
//
// A single-file, ZERO-DEPENDENCY public REST API for the Quantova network.
// It is an edge gateway that proxies a running Quantova node's JSON-RPC, so
// every response is real, live on-chain data:
//
//     client ──HTTP REST──▶ server.js ──q_ JSON-RPC / chain_*──▶ quantova-node ──▶ chain
//
// Requirements: Node.js >= 18 (built-in global `fetch` + `http`). No npm install.
//
// Run:
//     QUANTOVA_RPC_URL=https://mainnet.quantova.io PORT=8080 node server.js
//   or
//     node server.js --rpc-url https://mainnet.quantova.io --port 8080
//
// Endpoints (full reference + examples in README.md):
//   Discovery     GET  /v1                                   (index)
//                 GET  /healthz
//   Accounts      GET  /v1/accounts/:address/balance?block=
//                 GET  /v1/accounts/:address/transaction-count?block=
//                 GET  /v1/accounts/:address/code?block=
//                 POST /v1/accounts/faucet
//   Contracts     GET  /v1/contracts/:address/storage/:slot?block=
//                 GET  /v1/contracts/precompiles
//                 GET  /v1/contracts/:address/verification
//   Blocks        GET  /v1/blocks/latest?hydrated=
//                 GET  /v1/blocks/finalized?hydrated=
//                 GET  /v1/blocks/number/:number?hydrated=
//                 GET  /v1/blocks/hash/:hash?hydrated=
//                 GET  /v1/blocks/number/:number/transaction-count
//                 GET  /v1/blocks/hash/:hash/transaction-count
//   Transactions  GET  /v1/transactions/:hash
//                 GET  /v1/transactions/:hash/receipt
//                 POST /v1/transactions
//                 POST /v1/transactions/call
//                 POST /v1/transactions/estimate-gas
//   Gas & fees    GET  /v1/gas-price
//                 GET  /v1/fees/priority
//                 GET  /v1/fees/history?blockCount=&newestBlock=&rewardPercentiles=
//                 GET  /v1/fees/estimate
//                 POST /v1/fees/simulate
//   Network/node  GET  /v1/chain/id
//                 GET  /v1/network/version
//                 GET  /v1/network/listening
//                 GET  /v1/node/syncing
//                 GET  /v1/node/client-version
//                 GET  /v1/node/accounts
//   Staking/NPoS  GET  /v1/staking/validators/waiting
//                 GET  /v1/staking/delegators/:address/rewards
//                 GET  /v1/staking/parameters
//   QNS           GET  /v1/qns/resolve/:name
//                 GET  /v1/qns/reverse/:address
//                 GET  /v1/qns/info/:name
//                 GET  /v1/qns/price/:name?duration=
//                 POST /v1/qns/commit
//                 POST /v1/qns/reveal
//   Bridge        POST /v1/bridge/quote
//                 POST /v1/bridge/initiate
//                 GET  /v1/bridge/status/:tx
//                 POST /v1/bridge/claim

'use strict';

const http = require('http');

// ===========================================================================
// Configuration (env vars, with optional CLI overrides)
// ===========================================================================

function argFlag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CONFIG = {
  // Address to bind the REST server to. Default binds all interfaces; in
  // production place this behind a reverse proxy that terminates TLS and applies
  // authentication / rate limiting (see README).
  host: argFlag('host', process.env.HOST || '0.0.0.0'),
  port: parseInt(argFlag('port', process.env.PORT || '8080'), 10),

  // Upstream Quantova HTTP JSON-RPC endpoint (the q_ namespace).
  //   Mainnet: https://mainnet.quantova.io
  //   Testnet: https://testnet.quantova.io
  //   Local:   http://127.0.0.1:9933
  rpcUrl: argFlag('rpc-url', process.env.QUANTOVA_RPC_URL || 'http://127.0.0.1:9933'),

  // CORS origin for browser dApps. '*' is permissive; lock down in production.
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Bridge fee parameters (base units, 18 decimals). Governance-tunable (§8.4).
  attestationFee: BigInt(process.env.BRIDGE_ATTESTATION_FEE || '50000000000000'), // 0.00005 QTOV
  destGasEvm: BigInt(process.env.BRIDGE_DEST_GAS_EVM || '2000000000000000'), // 0.002 QTOV
  destGasNonEvm: BigInt(process.env.BRIDGE_DEST_GAS_NON_EVM || '1000000000000000'), // 0.001 QTOV
};

const QTOV_DECIMALS = 18n;
const NATIVE_SYMBOL = 'QTOV';

// Bridge protocol-fee tiers in basis points (1 bp = 0.01%), §8.4.
const BPS = { native: 5n, major: 10n, longTail: 15n };
const BPS_DENOMINATOR = 10000n;

// Supported foreign networks. `scale` is the exact SCALE/SDK enum variant name.
const NETWORKS = {
  ethereum: { scale: 'Ethereum', evm: true, aliases: ['eth'] },
  bsc: { scale: 'BSC', evm: true, aliases: ['binance', 'bnb'] },
  tron: { scale: 'TRON', evm: false, aliases: ['trx'] },
};

// ===========================================================================
// Errors (rendered as a JSON-RPC-style envelope for consistency with q_)
// ===========================================================================

class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}
const badRequest = (m) => new ApiError(400, -32602, m);
const notFound = (m) => new ApiError(404, -32001, m);
const upstream = (m) => new ApiError(502, -32000, m);

// ===========================================================================
// Encoding helpers — QUANTITY / DATA / Q-ADDRESS / hash (§16.1, §16.2)
// ===========================================================================

// QUANTITY: 0x-prefixed hex integer, no leading zeroes, "0x0" for zero.
function toQuantity(v /* BigInt */) {
  if (typeof v !== 'bigint') v = BigInt(v);
  if (v < 0n) throw new Error('negative quantity');
  return '0x' + v.toString(16);
}
function parseQuantity(s) {
  if (typeof s !== 'string' || !s.startsWith('0x')) {
    throw badRequest(`QUANTITY must be 0x-prefixed: ${s}`);
  }
  const hex = s.slice(2);
  if (hex.length === 0) throw badRequest('QUANTITY has no digits');
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw badRequest(`invalid QUANTITY: ${s}`);
  return BigInt(s);
}

// DATA: 0x-prefixed even-length hex byte array.
function parseData(s) {
  if (typeof s !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(s)) {
    throw badRequest(`DATA must be 0x-prefixed even-length hex: ${s}`);
  }
  return s.toLowerCase();
}

// ADDRESS: canonical Q-format string. Byte 0 is the fixed 0x40 marker (§5.3),
// rendered as the leading 'Q' followed by the remaining 19 bytes as hex
// (e.g. Qa0018bcd09ed8fc81b323331950a89541d2416). Validated, then passed to the
// q_ namespace verbatim (the wire uses Q-format strings, §16.1).
function parseQAddress(s) {
  if (typeof s !== 'string' || !s.startsWith('Q')) {
    throw badRequest(`address must start with 'Q': ${s}`);
  }
  const rest = s.slice(1);
  if (rest.length !== 38) {
    throw badRequest(`address must be 'Q' + 38 hex chars (19 bytes); got ${rest.length}`);
  }
  if (!/^[0-9a-fA-F]{38}$/.test(rest)) throw badRequest(`invalid address hex: ${s}`);
  return s;
}

// Foreign (EVM/TRON) 20-byte contract address as 0x hex (used by the bridge).
function parseH160(s) {
  if (typeof s !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(s)) {
    throw badRequest(`foreign token address must be 0x + 40 hex (20 bytes): ${s}`);
  }
  return s.toLowerCase();
}

// 32-byte transaction/block hash: 0x + 64 hex (never Q).
function normalizeHash(s) {
  if (typeof s !== 'string' || !s.startsWith('0x')) {
    throw badRequest('hash must be 0x-prefixed (never Q-format)');
  }
  const hex = s.slice(2);
  if (hex.length !== 64) {
    throw badRequest(`hash must be 32 bytes (64 hex chars); got ${hex.length}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw badRequest(`invalid hash hex: ${s}`);
  return '0x' + hex.toLowerCase();
}

// QNS name: dot-separated labels under the .qtov TLD (e.g. alice.qtov, §14).
// Names are normalized to lowercase and passed to the q_qns* methods verbatim.
function parseQnsName(s) {
  const name = String(s || '').toLowerCase();
  if (!/^([a-z0-9-]+\.)+qtov$/.test(name)) {
    throw badRequest(`invalid QNS name '${s}' (expected labels under .qtov, e.g. alice.qtov)`);
  }
  for (const label of name.split('.')) {
    if (label.length < 1 || label.length > 63 || label.startsWith('-') || label.endsWith('-')) {
      throw badRequest(`invalid QNS label '${label}' in '${s}' (1-63 chars, no leading/trailing '-')`);
    }
  }
  return name;
}

// 32-byte commit-reveal secret: 0x + 64 hex. Generated client-side, kept private
// between the commit and reveal steps (§14.3).
function parseSecret(s) {
  const data = parseData(s);
  if (data.length !== 66) throw badRequest('`secret` must be 32 bytes (0x + 64 hex)');
  return data;
}

// Storage slot accepts QUANTITY hex or a plain decimal in the path.
function parseSlot(s) {
  if (/^0x[0-9a-fA-F]+$/.test(s)) return toQuantity(parseQuantity(s));
  if (/^\d+$/.test(s)) return toQuantity(BigInt(s));
  throw badRequest(`invalid storage slot: ${s}`);
}

// Human-readable QTOV amount (base units -> "x.y QTOV"). Arithmetic uses base units.
function formatQtov(v /* BigInt */) {
  const divisor = 10n ** QTOV_DECIMALS;
  const whole = v / divisor;
  let frac = (v % divisor).toString().padStart(Number(QTOV_DECIMALS), '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac} ${NATIVE_SYMBOL}` : `${whole} ${NATIVE_SYMBOL}`;
}

function parseNetwork(s) {
  const k = String(s || '').toLowerCase();
  for (const [name, info] of Object.entries(NETWORKS)) {
    if (name === k || info.aliases.includes(k)) return { name, ...info };
  }
  throw badRequest(`unknown network '${s}' (expected ethereum | bsc | tron)`);
}

function normalizeDirection(s) {
  const d = String(s || 'outbound').toLowerCase();
  if (['outbound', 'out', 'withdraw', 'withdrawal'].includes(d)) return 'outbound';
  if (['inbound', 'in', 'deposit'].includes(d)) return 'inbound';
  throw badRequest(`unknown direction '${s}' (expected outbound | inbound)`);
}

function settlementWindow(net, direction) {
  if (direction === 'outbound') return net.evm ? '3-8 minutes' : '8-15 minutes';
  return net.evm ? '5-12 minutes' : '10-20 minutes';
}

function assetTier(asset) {
  const t = (asset.tier || '').toLowerCase();
  if (t === 'native') return 'native';
  if (t === 'major') return 'major';
  if (['long_tail', 'longtail', 'wrapped'].includes(t)) return 'longTail';
  return asset.native ? 'native' : 'major';
}
function tierLabel(tier) {
  return tier === 'native' ? 'native (0.05%)' : tier === 'major' ? 'major (0.10%)' : 'long-tail (0.15%)';
}

// Resolve an optional block reference into the on-wire string a q_ method
// expects (an explicit number hex, or a 32-byte hash). Named tags are rejected
// (§16.2); omitted resolves to the latest block number.
async function resolveBlock(blockParam) {
  if (blockParam == null || blockParam === '') {
    const head = await rpc('q_blockNumber');
    return toQuantity(parseQuantity(head));
  }
  const s = String(blockParam).trim();
  const lower = s.toLowerCase();
  if (['latest', 'earliest', 'pending', 'safe', 'finalized'].includes(lower)) {
    throw badRequest(
      "named block tags are not accepted; pass a block number or hash (use /v1/blocks/latest or /v1/blocks/finalized for those)"
    );
  }
  if (lower.startsWith('0x')) {
    if (lower.length === 66) return normalizeHash(s); // 32-byte hash
    return toQuantity(parseQuantity(s)); // QUANTITY number
  }
  if (!/^\d+$/.test(s)) throw badRequest(`invalid block reference: ${s}`);
  return toQuantity(BigInt(s));
}

// Build the q_ call object (§16.3) shared by call / estimate-gas / simulate.
function buildCallObject({ from, to, value, input, gas }) {
  const call = { from: parseQAddress(from) };
  call.to = to != null ? parseQAddress(to) : null; // null => deployment
  if (value != null) call.value = toQuantity(parseQuantity(value));
  if (gas != null) call.gas = toQuantity(parseQuantity(gas));
  if (input != null) call.input = parseData(input);
  return call;
}

// ===========================================================================
// Upstream JSON-RPC client — every method below already exists on the node
// (node/src/rpc/revive/qvm.rs). chain_getFinalizedHead is a standard Substrate
// RPC the node also serves.
// ===========================================================================

async function rpc(method, params = []) {
  let res;
  try {
    res = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
  } catch (e) {
    throw upstream(`${method}: cannot reach node at ${CONFIG.rpcUrl} (${e.message})`);
  }
  if (!res.ok) throw upstream(`${method}: node returned HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw upstream(`${method}: invalid JSON from node (${e.message})`);
  }
  if (json && json.error) {
    const msg = json.error.message || JSON.stringify(json.error);
    throw upstream(`${method}: ${msg}`);
  }
  return json ? json.result : undefined;
}

// ===========================================================================
// Handlers — accounts & state
// ===========================================================================

async function accountBalance({ params, query }) {
  const addr = parseQAddress(params.address);
  const block = await resolveBlock(query.block);
  const bal = parseQuantity(await rpc('q_getBalance', [addr, block]));
  return { address: addr, balance: toQuantity(bal), balanceDisplay: formatQtov(bal), block };
}

async function accountTxCount({ params, query }) {
  const addr = parseQAddress(params.address);
  const block = await resolveBlock(query.block);
  const n = parseQuantity(await rpc('q_getTransactionCount', [addr, block]));
  return { address: addr, transactionCount: toQuantity(n), block };
}

async function accountCode({ params, query }) {
  const addr = parseQAddress(params.address);
  const block = await resolveBlock(query.block);
  const code = await rpc('q_getCode', [addr, block]);
  return { address: addr, code, isContract: code !== '0x' && code !== '' };
}

async function contractStorage({ params, query }) {
  const addr = parseQAddress(params.address);
  const slot = parseSlot(params.slot);
  const block = await resolveBlock(query.block);
  const value = await rpc('q_getStorageAt', [addr, slot, block]);
  return { address: addr, slot, value };
}

// Testnet faucet: drips QTOV to an address so developers can fund accounts.
// The node enforces eligibility (per-address rate limit, drip amount) and rejects
// the request on networks where the faucet is disabled (e.g. mainnet). *(→ q_faucetDrip)*
async function accountsFaucet({ body }) {
  body = body || {};
  const addr = parseQAddress(body.address);
  const res = await rpc('q_faucetDrip', [addr]);
  // The node returns the drip transaction hash, plus the dripped amount when known.
  const hash = typeof res === 'string' ? res : res && res.transactionHash;
  const amount = res && res.amount != null ? parseQuantity(res.amount) : null;
  const out = { address: addr, transactionHash: hash };
  if (amount != null) {
    out.amount = toQuantity(amount);
    out.amountDisplay = formatQtov(amount);
  }
  out.next = 'poll GET /v1/transactions/:hash/receipt to confirm the drip is mined';
  return out;
}

// ===========================================================================
// Handlers — blocks
// ===========================================================================

function hydratedFlag(query) {
  return query.hydrated === 'true' || query.hydrated === true;
}

async function blockLatest({ query }) {
  const head = await rpc('q_blockNumber');
  const b = await rpc('q_getBlockByNumber', [toQuantity(parseQuantity(head)), hydratedFlag(query)]);
  if (b == null) throw notFound('block not found');
  return b;
}

async function blockFinalized({ query }) {
  const hash = await rpc('chain_getFinalizedHead'); // reorg-safe head (§18)
  const b = await rpc('q_getBlockByHash', [hash, hydratedFlag(query)]);
  if (b == null) throw notFound('finalized block not found');
  return b;
}

async function blockByNumber({ params, query }) {
  const n = await resolveBlock(params.number);
  const b = await rpc('q_getBlockByNumber', [n, hydratedFlag(query)]);
  if (b == null) throw notFound('block not found');
  return b;
}

async function blockByHash({ params, query }) {
  const h = normalizeHash(params.hash);
  const b = await rpc('q_getBlockByHash', [h, hydratedFlag(query)]);
  if (b == null) throw notFound('block not found');
  return b;
}

async function blockTxCountByNumber({ params }) {
  const n = await resolveBlock(params.number);
  const c = await rpc('q_getBlockTransactionCountByNumber', [n]);
  if (c == null) throw notFound('block not found');
  return { transactionCount: toQuantity(parseQuantity(c)) };
}

async function blockTxCountByHash({ params }) {
  const h = normalizeHash(params.hash);
  const c = await rpc('q_getBlockTransactionCountByHash', [h]);
  if (c == null) throw notFound('block not found');
  return { transactionCount: toQuantity(parseQuantity(c)) };
}

// ===========================================================================
// Handlers — transactions
// ===========================================================================

async function transactionByHash({ params }) {
  const h = normalizeHash(params.hash);
  const t = await rpc('q_getTransactionByHash', [h]);
  if (t == null) throw notFound('transaction not found');
  return t;
}

async function transactionReceipt({ params }) {
  const h = normalizeHash(params.hash);
  const r = await rpc('q_getTransactionReceipt', [h]);
  if (r == null) throw notFound('receipt not found (transaction not mined yet?)');
  return r;
}

async function sendRawTransaction({ body }) {
  if (!body || body.rawTransaction == null) throw badRequest('missing `rawTransaction`');
  const raw = parseData(body.rawTransaction);
  const hash = await rpc('q_sendRawTransaction', [raw]); // gateway never signs
  return { transactionHash: hash };
}

async function contractCall({ body }) {
  const call = buildCallObject(body || {});
  const block = body && body.block != null ? await resolveBlock(body.block) : null;
  const data = await rpc('q_call', block != null ? [call, block] : [call]);
  return { data };
}

async function estimateGas({ body }) {
  const call = buildCallObject({
    from: body && body.from,
    to: body && body.to,
    value: body && body.value,
    input: body && body.input,
  });
  const gas = await rpc('q_estimateGas', [call]);
  return { gas: toQuantity(parseQuantity(gas)) };
}

// ===========================================================================
// Handlers — gas & fees
// ===========================================================================

async function gasPrice() {
  return { gasPrice: toQuantity(parseQuantity(await rpc('q_gasPrice'))) };
}

async function feesPriority() {
  return { maxPriorityFeePerGas: toQuantity(parseQuantity(await rpc('q_maxPriorityFeePerGas'))) };
}

async function feeTiersFromHistory() {
  const head = await rpc('q_blockNumber');
  const hist = await rpc('q_feeHistory', [toQuantity(5n), toQuantity(parseQuantity(head)), [25, 50, 75]]);
  const rewards = hist && hist.reward;
  if (!Array.isArray(rewards) || rewards.length === 0) throw new Error('empty fee history');
  let slow = 0n, std = 0n, fast = 0n, n = 0n;
  for (const row of rewards) {
    if (Array.isArray(row) && row.length === 3) {
      slow += parseQuantity(row[0]);
      std += parseQuantity(row[1]);
      fast += parseQuantity(row[2]);
      n += 1n;
    }
  }
  if (n === 0n) throw new Error('empty fee history');
  return { slow: toQuantity(slow / n), standard: toQuantity(std / n), fast: toQuantity(fast / n) };
}

async function feesEstimate() {
  const base = parseQuantity(await rpc('q_gasPrice'));
  let priority;
  try {
    priority = parseQuantity(await rpc('q_maxPriorityFeePerGas'));
  } catch {
    priority = (base * 20n) / 100n;
  }
  let tiers;
  try {
    tiers = await feeTiersFromHistory();
  } catch {
    tiers = {
      slow: toQuantity((priority * 50n) / 100n),
      standard: toQuantity(priority),
      fast: toQuantity((priority * 150n) / 100n),
    };
  }
  return {
    baseFeePerGas: toQuantity(base),
    maxPriorityFeePerGas: toQuantity(priority),
    maxFeePerGas: toQuantity(base + priority),
    priorityFeeTiers: tiers,
    model: 'eip1559-no-burn', // base fee -> treasury, tip -> validator (§8.1)
  };
}

async function feesSimulate({ body }) {
  body = body || {};
  const call = buildCallObject({ from: body.from, to: body.to, value: body.value, input: body.input });
  const gas = body.gas != null ? parseQuantity(body.gas) : parseQuantity(await rpc('q_estimateGas', [call]));
  const base = parseQuantity(await rpc('q_gasPrice'));
  let priority;
  try {
    priority = parseQuantity(await rpc('q_maxPriorityFeePerGas'));
  } catch {
    priority = (base * 20n) / 100n;
  }
  const effective = base + priority;
  const fee = gas * effective;
  const value = body.value != null ? parseQuantity(body.value) : 0n;
  const total = fee + value;
  return {
    gas: toQuantity(gas),
    baseFeePerGas: toQuantity(base),
    maxPriorityFeePerGas: toQuantity(priority),
    effectiveGasPrice: toQuantity(effective),
    fee: toQuantity(fee),
    totalCost: toQuantity(total),
    totalCostDisplay: formatQtov(total),
  };
}

async function feesHistory({ query }) {
  const count = query.blockCount != null ? BigInt(query.blockCount) : 5n;
  const newest = query.newestBlock != null
    ? await resolveBlock(query.newestBlock)
    : toQuantity(parseQuantity(await rpc('q_blockNumber')));
  let percentiles = [25, 50, 75];
  if (query.rewardPercentiles != null) {
    percentiles = String(query.rewardPercentiles)
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .map((x) => {
        const v = Number(x);
        if (Number.isNaN(v)) throw badRequest(`invalid percentile: ${x}`);
        return v;
      });
  }
  return await rpc('q_feeHistory', [toQuantity(count), newest, percentiles]);
}

// ===========================================================================
// Handlers — network & node
// ===========================================================================

async function chainId() {
  return { chainId: toQuantity(parseQuantity(await rpc('q_chainId'))) };
}
async function networkVersion() {
  return { networkVersion: await rpc('q_net_version') };
}
async function networkListening() {
  return { listening: await rpc('q_listening') };
}
async function nodeSyncing() {
  const s = await rpc('q_syncing'); // false, or a progress object
  return s === false ? { syncing: false } : { syncing: s };
}
async function nodeClientVersion() {
  return { clientVersion: await rpc('q_web3_clientVersion') };
}
async function nodeAccounts() {
  return { accounts: await rpc('q_accounts') };
}

// ===========================================================================
// Handlers — bridge (§8.4, §12)
// ===========================================================================

async function bridgeQuote({ body }) {
  body = body || {};
  const net = parseNetwork(body.network);
  const direction = normalizeDirection(body.direction != null ? body.direction : 'outbound');
  const asset = body.asset || {};
  if (!asset.native) {
    parseNetwork(asset.network);
    parseH160(asset.tokenAddress);
  }
  if (body.amount == null) throw badRequest('missing `amount`');
  const amount = parseQuantity(body.amount);

  const tier = assetTier(asset);
  const protocolFee = (amount * BPS[tier]) / BPS_DENOMINATOR;
  const attestation = CONFIG.attestationFee;
  const destGas = body.destinationGas != null
    ? parseQuantity(body.destinationGas)
    : net.evm
    ? CONFIG.destGasEvm
    : CONFIG.destGasNonEvm;

  const total = protocolFee + attestation + destGas;
  const after = amount > total ? amount - total : 0n;

  return {
    network: net.name,
    direction,
    feeTier: tierLabel(tier),
    protocolFee: toQuantity(protocolFee),
    validatorAttestationFee: toQuantity(attestation),
    destinationGas: toQuantity(destGas),
    totalBridgeFee: toQuantity(total),
    amountAfterFees: toQuantity(after),
    totalBridgeFeeDisplay: formatQtov(total),
    estimatedSettlement: settlementWindow(net, direction),
    caps: 'permissionless: no protocol min/max/per-address caps',
  };
}

async function bridgeInitiate({ body }) {
  body = body || {};
  const net = parseNetwork(body.network);
  const from = parseQAddress(body.from);
  const asset = body.asset || {};

  let assetId;
  if (asset.native) {
    assetId = 'Native';
  } else {
    const an = parseNetwork(asset.network);
    const id = parseH160(asset.tokenAddress);
    assetId = { Foreign: { network: an.scale, identifier: id } };
  }
  if (body.amount == null) throw badRequest('missing `amount`');
  const amount = toQuantity(parseQuantity(body.amount));

  const quote = await bridgeQuote({
    body: {
      network: body.network,
      direction: 'outbound',
      asset,
      amount: body.amount,
      destinationGas: body.destinationGas,
    },
  });

  return {
    quote,
    // Unsigned descriptor: sign locally with your post-quantum key, then submit
    // via POST /v1/transactions (q_sendRawTransaction). The gateway never signs.
    unsignedTransaction: {
      pallet: 'Bridge',
      call: 'register_outward_transfer', // call index 0
      args: { network: net.scale, amount, assetId },
      signer: from,
    },
    next: 'sign locally with your post-quantum key, then submit via POST /v1/transactions',
  };
}

async function bridgeStatus({ params, query }) {
  const tx = normalizeHash(params.tx);
  const settlement = settlementWindowOpt(query);
  const receipt = await rpc('q_getTransactionReceipt', [tx]);

  if (receipt == null) {
    return {
      transactionHash: tx,
      phase: 'pending',
      sourceFinalized: false,
      estimatedSettlement: settlement,
      detail: 'source transaction not found yet — not mined, or unknown hash',
    };
  }

  const statusOk = receipt.status == null ? true : parseQuantity(receipt.status) === 1n;
  const block = receipt.blockNumber != null ? receipt.blockNumber : undefined;
  const gasUsed = receipt.gasUsed != null ? receipt.gasUsed : undefined;

  if (!statusOk) {
    return {
      transactionHash: tx,
      phase: 'failed',
      sourceFinalized: false,
      sourceBlock: block,
      sourceGasUsed: gasUsed,
      detail: 'source transaction reverted on Quantova',
    };
  }

  let finalized = false;
  if (block != null) {
    try {
      const head = await rpc('q_blockNumber');
      finalized = parseQuantity(head) >= parseQuantity(block);
    } catch {
      /* leave finalized=false on transient errors */
    }
  }

  return {
    transactionHash: tx,
    phase: finalized ? 'awaiting_settlement' : 'source_included',
    sourceFinalized: finalized,
    sourceBlock: block,
    sourceGasUsed: gasUsed,
    estimatedSettlement: settlement,
    detail: finalized
      ? "source finalized on Quantova; destination settlement proceeds via the bridge pallet's proof/relayer path (Ch.12)"
      : 'included on Quantova; awaiting deterministic finality (~3s) before destination settlement',
  };
}

function settlementWindowOpt(query) {
  if (!query.network) return undefined;
  const net = parseNetwork(query.network);
  const dir = query.direction ? normalizeDirection(query.direction) : 'outbound';
  return settlementWindow(net, dir);
}

async function bridgeClaim({ body }) {
  body = body || {};
  const net = parseNetwork(body.network);
  const beneficiary = parseQAddress(body.beneficiary);
  let mechanism, detail;
  if (net.name === 'tron') {
    mechanism = 'multisig trusted-relayer: credited once the registered relayer set reaches threshold';
    detail =
      'no end-user claim is required; the TRON relayer set votes the deposit batch and the pallet credits your account on threshold (§12.4)';
  } else {
    mechanism = 'trust-minimized: light-client + EIP-1186 Merkle proof, credited by the bridge pallet in consensus';
    detail =
      'no end-user claim is required; the relayer submits the inclusion proof and the pallet credits your account once the source-chain header is finalized (§12.2)';
  }
  return {
    network: net.name,
    beneficiary,
    nonce: body.nonce,
    mechanism,
    userActionRequired: false,
    estimatedSettlement: settlementWindow(net, 'inbound'),
    detail,
  };
}

// ===========================================================================
// Handlers — staking / NPoS (§10)
// ===========================================================================

// Validators that are bonded and in the waiting set (eligible but not in the
// active set this era). *(→ q_stakingWaitingValidators)*
async function stakingWaitingValidators() {
  const waiting = await rpc('q_stakingWaitingValidators');
  return { waiting: Array.isArray(waiting) ? waiting : [] };
}

// Unclaimed staking rewards owed to a delegator (nominator) across the validators
// it backs. *(→ q_stakingPendingRewards)*
async function stakingDelegatorRewards({ params }) {
  const addr = parseQAddress(params.address);
  const rewards = await rpc('q_stakingPendingRewards', [addr]);
  if (rewards == null) throw notFound('no staking position for this delegator');
  // The node reports a total plus an optional per-era / per-validator breakdown.
  const total = rewards.total != null ? parseQuantity(rewards.total) : 0n;
  return {
    address: addr,
    total: toQuantity(total),
    totalDisplay: formatQtov(total),
    breakdown: rewards.breakdown != null ? rewards.breakdown : [],
  };
}

// Network-wide staking parameters (active era, min stakes, unbonding period,
// validator count, inflation, …). Returned verbatim. *(→ q_stakingParameters)*
async function stakingParameters() {
  const p = await rpc('q_stakingParameters');
  if (p == null) throw notFound('staking parameters unavailable');
  return p;
}

// ===========================================================================
// Handlers — QNS (Quantova Name Service, §14)
// ===========================================================================

// Forward resolution: QNS name -> the Q-address it points at. *(→ q_qnsResolve)*
async function qnsResolve({ params }) {
  const name = parseQnsName(params.name);
  const address = await rpc('q_qnsResolve', [name]);
  if (address == null || address === '') throw notFound(`name '${name}' does not resolve to an address`);
  return { name, address };
}

// Reverse resolution: Q-address -> its primary QNS name. *(→ q_qnsReverseLookup)*
async function qnsReverse({ params }) {
  const addr = parseQAddress(params.address);
  const name = await rpc('q_qnsReverseLookup', [addr]);
  if (name == null || name === '') throw notFound(`no reverse record set for ${addr}`);
  return { address: addr, name };
}

// Registration record for a name (owner, resolver, expiry, …). *(→ q_qnsGetInfo)*
async function qnsInfo({ params }) {
  const name = parseQnsName(params.name);
  const info = await rpc('q_qnsGetInfo', [name]);
  if (info == null) throw notFound(`name '${name}' is not registered`);
  return { name, ...info };
}

// Registration price for a name over a duration (in years; default 1). The node
// returns a base + premium split (premium decays after release). *(→ q_qnsPrice)*
async function qnsPrice({ params, query }) {
  const name = parseQnsName(params.name);
  const duration = query.duration != null ? BigInt(query.duration) : 1n;
  if (duration < 1n) throw badRequest('`duration` (years) must be >= 1');
  const p = await rpc('q_qnsPrice', [name, toQuantity(duration)]);
  if (p == null) throw notFound(`no price for '${name}' (already registered or reserved?)`);
  const base = p.base != null ? parseQuantity(p.base) : 0n;
  const premium = p.premium != null ? parseQuantity(p.premium) : 0n;
  const total = base + premium;
  return {
    name,
    durationYears: Number(duration),
    base: toQuantity(base),
    premium: toQuantity(premium),
    total: toQuantity(total),
    totalDisplay: formatQtov(total),
  };
}

// Step 1 of registration (commit-reveal, §14.3). The node derives the commitment
// hash from (name, owner, secret); we return it plus an *unsigned* commit
// transaction. The secret is never sent on-chain at this step — keep it private.
// *(→ q_qnsMakeCommitment, then Qns.commit)*
async function qnsCommit({ body }) {
  body = body || {};
  const name = parseQnsName(body.name);
  const owner = parseQAddress(body.owner);
  const secret = parseSecret(body.secret);
  const commitment = await rpc('q_qnsMakeCommitment', [name, owner, secret]);
  return {
    name,
    commitment,
    unsignedTransaction: {
      pallet: 'Qns',
      call: 'commit',
      args: { commitment },
      signer: owner,
    },
    next: 'sign locally and submit via POST /v1/transactions, then wait the minimum commitment age before POST /v1/qns/reveal',
  };
}

// Step 2 of registration: reveal the committed name and register it. Returns the
// price quote plus an *unsigned* register transaction carrying the same secret
// used at commit time. *(→ q_qnsPrice, then Qns.register)*
async function qnsReveal({ body }) {
  body = body || {};
  const name = parseQnsName(body.name);
  const owner = parseQAddress(body.owner);
  const secret = parseSecret(body.secret);
  const duration = body.duration != null ? BigInt(body.duration) : 1n;
  if (duration < 1n) throw badRequest('`duration` (years) must be >= 1');

  const price = await qnsPrice({ params: { name }, query: { duration: duration.toString() } });

  return {
    quote: price,
    unsignedTransaction: {
      pallet: 'Qns',
      call: 'register',
      args: { name, owner, durationYears: toQuantity(duration), secret },
      signer: owner,
    },
    next: 'sign locally with your post-quantum key, then submit via POST /v1/transactions',
  };
}

// ===========================================================================
// Handlers — smart contracts (precompiles & source verification)
// ===========================================================================

// The chain's precompiled contracts (fixed addresses + what they implement).
// *(→ q_getPrecompiles)*
async function contractsPrecompiles() {
  const precompiles = await rpc('q_getPrecompiles');
  return { precompiles: Array.isArray(precompiles) ? precompiles : [] };
}

// Source-verification status for a deployed contract (verified flag, compiler,
// metadata). Returned verbatim from the node's verifier. *(→ q_getContractVerification)*
async function contractVerification({ params }) {
  const addr = parseQAddress(params.address);
  const v = await rpc('q_getContractVerification', [addr]);
  if (v == null) throw notFound('no contract (or no verification record) at this address');
  return { address: addr, ...v };
}

// ===========================================================================
// Handler — discovery index
// ===========================================================================

async function apiIndex() {
  return {
    service: 'quantova-rest-api',
    version: '1.0.0',
    upstream: CONFIG.rpcUrl,
    encoding: {
      address: 'canonical Q-format string (e.g. Qa0018bcd…2416)',
      quantity: '0x-prefixed hex integer, no leading zeroes',
      data: '0x-prefixed hex byte array',
      hash: '32-byte 0x SHA3 hex (never Q)',
      block: 'number (decimal or 0x QUANTITY) or 32-byte 0x hash; named tags not accepted',
    },
    endpoints: ROUTES.filter((r) => r.path !== '/healthz').map((r) => `${r.method} ${r.path}`),
  };
}

// ===========================================================================
// Router
// ===========================================================================

const ROUTES = [];
function add(method, path, handler) {
  const names = [];
  const pattern = path.replace(/:[^/]+/g, (m) => {
    names.push(m.slice(1));
    return '([^/]+)';
  });
  ROUTES.push({ method, path, regex: new RegExp('^' + pattern + '$'), names, handler });
}

// Discovery
add('GET', '/v1', apiIndex);
// Accounts & state
add('POST', '/v1/accounts/faucet', accountsFaucet);
add('GET', '/v1/accounts/:address/balance', accountBalance);
add('GET', '/v1/accounts/:address/transaction-count', accountTxCount);
add('GET', '/v1/accounts/:address/code', accountCode);
// Contracts
add('GET', '/v1/contracts/precompiles', contractsPrecompiles);
add('GET', '/v1/contracts/:address/storage/:slot', contractStorage);
add('GET', '/v1/contracts/:address/verification', contractVerification);
// Blocks
add('GET', '/v1/blocks/latest', blockLatest);
add('GET', '/v1/blocks/finalized', blockFinalized);
add('GET', '/v1/blocks/number/:number/transaction-count', blockTxCountByNumber);
add('GET', '/v1/blocks/number/:number', blockByNumber);
add('GET', '/v1/blocks/hash/:hash/transaction-count', blockTxCountByHash);
add('GET', '/v1/blocks/hash/:hash', blockByHash);
// Transactions
add('GET', '/v1/transactions/:hash/receipt', transactionReceipt);
add('GET', '/v1/transactions/:hash', transactionByHash);
add('POST', '/v1/transactions/call', contractCall);
add('POST', '/v1/transactions/estimate-gas', estimateGas);
add('POST', '/v1/transactions', sendRawTransaction);
// Gas & fees
add('GET', '/v1/gas-price', gasPrice);
add('GET', '/v1/fees/priority', feesPriority);
add('GET', '/v1/fees/history', feesHistory);
add('GET', '/v1/fees/estimate', feesEstimate);
add('POST', '/v1/fees/simulate', feesSimulate);
// Network & node
add('GET', '/v1/chain/id', chainId);
add('GET', '/v1/network/version', networkVersion);
add('GET', '/v1/network/listening', networkListening);
add('GET', '/v1/node/syncing', nodeSyncing);
add('GET', '/v1/node/client-version', nodeClientVersion);
add('GET', '/v1/node/accounts', nodeAccounts);
// Staking / NPoS
add('GET', '/v1/staking/validators/waiting', stakingWaitingValidators);
add('GET', '/v1/staking/delegators/:address/rewards', stakingDelegatorRewards);
add('GET', '/v1/staking/parameters', stakingParameters);
// QNS
add('GET', '/v1/qns/resolve/:name', qnsResolve);
add('GET', '/v1/qns/reverse/:address', qnsReverse);
add('GET', '/v1/qns/info/:name', qnsInfo);
add('GET', '/v1/qns/price/:name', qnsPrice);
add('POST', '/v1/qns/commit', qnsCommit);
add('POST', '/v1/qns/reveal', qnsReveal);
// Bridge
add('POST', '/v1/bridge/quote', bridgeQuote);
add('POST', '/v1/bridge/initiate', bridgeInitiate);
add('GET', '/v1/bridge/status/:tx', bridgeStatus);
add('POST', '/v1/bridge/claim', bridgeClaim);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(badRequest('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(badRequest('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // CORS (permissive by default; lock down via CORS_ORIGIN in production).
  res.setHeader('Access-Control-Allow-Origin', CONFIG.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let pathname = '/';
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = url.pathname.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(url.searchParams.entries());

    // Liveness probe (plain text).
    if (req.method === 'GET' && pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }

    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      const result = await r.handler({ params, query, body, req });
      return sendJson(res, 200, result);
    }
    throw notFound(`no route for ${req.method} ${pathname}`);
  } catch (err) {
    if (err instanceof ApiError) {
      const error = { code: err.code, message: err.message };
      if (err.data !== undefined) error.data = err.data;
      return sendJson(res, err.status, { error });
    }
    // Unexpected internal error.
    return sendJson(res, 500, { error: { code: -32603, message: String((err && err.message) || err) } });
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(
    `Quantova REST API listening on http://${CONFIG.host}:${CONFIG.port}  →  upstream ${CONFIG.rpcUrl}`
  );
});

// Exported for testing / embedding.
module.exports = { server, ROUTES, CONFIG };
