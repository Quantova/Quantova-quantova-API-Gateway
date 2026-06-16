# Quantova Universal Bridge — Specification & Current Position

Canonical, honest spec of the Quantova cross-chain bridge as currently built. Quantova is a
post-quantum L1 and the **hub**: every transfer has Quantova on one side. Foreign assets are issued
**1:1** as wrapped q-assets and **burned on redeem** (proof-of-reserves; no treasury holds wrapped
assets). On-chain logic is `pallet-universal-bridge` + per-family verifier pallets in the Quantova
runtime; this supersedes the earlier single `pallet-bridge` (BSC/ETH/Tron only).

- **Networks:** 36 foreign chains. **Assets:** 67.
- **Issuance:** 1:1 wrapped q-assets; only **BTC→WBTC** and **ETH→WETH** carry the `W` prefix — every
  other asset keeps its own ticker (USDT stays USDT).
- **Tiers ratchet up only:** Federated → SPV → LightClient → Native. Never silently downgraded.
- **Consensus:** the bridge passes no message back to consensus; Quantova consensus is post-quantum
  end to end. Recipients are H160 (Moonbeam/Frontier model) → canonical Quantova `AccountId`.

---

## Supported networks (36)

`Network` enum (append-only indices):

| # | Network | # | Network | # | Network | # | Network |
|--|--|--|--|--|--|--|--|
| 0 | BSC | 9 | Polkadot | 18 | Stellar | 27 | Injective |
| 1 | Ethereum | 10 | Avalanche | 19 | Hyperliquid | 28 | Sei |
| 2 | Tron | 11 | NEAR | 20 | Arbitrum | 29 | Bittensor |
| 3 | Bitcoin | 12 | Sui | 21 | Base | 30 | Zcash |
| 4 | Solana | 13 | Aptos | 22 | Optimism | 31 | Monero |
| 5 | Bitcoin Cash | 14 | Hedera | 23 | Polygon | 32 | Linea |
| 6 | Dogecoin | 15 | Algorand | 24 | Litecoin | 33 | Scroll |
| 7 | XRP | 16 | VeChain | 25 | Cosmos | 34 | Mantle |
| 8 | Cardano | 17 | TON | 26 | Celestia | 35 | zkSync Era |

---

## Trustless verification — proofs by chain family

Inbound deposits are verified **on-chain** by the verifier for each family:

| Verifier | Networks | Verified on-chain | Tier |
|---|---|---|---|
| **Bitcoin SPV** | Bitcoin, Bitcoin Cash | PoW most-work header chain + Merkle inclusion + N confirmations (BCH: **ASERT** difficulty). | SPV (trustless) |
| **EVM light client** | Ethereum, BSC | Source finality — **ETH sync-committee BLS**, **BSC Parlia BLS** — + **EIP-1186** account/storage MPT proof of the deposit against the finalized state root. Strictly-increasing finalized height enforced. | LightClient (trustless) |
| **Cosmos light client** | Cosmos, Celestia, Injective, Sei | **Tendermint** header update (≥⅔ voting power) → finalized `app_hash` + **ICS-23** membership proof. Deposit-key namespace prefix enforced. | LightClient (trustless) |
| **Substrate light client** | Polkadot, Bittensor | **GRANDPA** finality → finalized state root + **sp-trie** state read-proof. Deposit-key namespace prefix enforced. | LightClient (trustless) |
| **EVM (anchored)** | Arbitrum, Base, Optimism, Polygon, Avalanche, Linea, Scroll, Mantle, zkSync, VeChain, Hyperliquid | EIP-1186 proof vs a governance/relayer-anchored root. An optimistic/zk-rollup root is not L1-final on its own → honestly **Federated** until an L1-anchored proof ships. | Federated |
| **Federated relayers** | Solana, TRON, XRP, Cardano, NEAR, TON, Stellar, Hedera, Sui, Aptos, Algorand, Litecoin, Dogecoin, Zcash | **≥⅔ relayer quorum**, strict nonce order, replay-proof. A configured ≥⅔ threshold is required before any mint (an unset threshold is refused). | Federated |
| **Monero (view-key)** | Monero | View-key watcher federation decodes incoming amount + embedded recipient. Monero is private — there is **no public deposit proof** — so this tier is **inherently trusted** and is never labelled trustless. | Federated (trusted) |

Proof crates (ETH sync-committee, BSC Parlia, Tendermint, ICS-23, GRANDPA, MPT) are the audited
implementations from the Quantova **hyperbridge** fork.

---

## Custody & settlement

- **Inbound:** verifier confirms → mint 1:1 to the H160 recipient (canonical `AccountId`). Proof tiers
  key replay per deposit; federated finalizes in strict nonce order.
- **Outbound:** **burn** the q-asset (checked supply / proof-of-reserves) → release on the foreign chain.
  A 0.10% protocol fee routes to the Quantova treasury.
- **BTC:** an **over-collateralized vault** (Interlay/iBTC). Redeem burns WBTC and atomically earmarks a
  vault's BTC; the vault proves payout via **SPV** or is **slashed** to over-compensate the user. Direct
  vault redeem is governance-gated — no redeem without a backing burn. No trusted signer, no BitVM2.
- **Non-BTC outbound** is custody-operational (federation/threshold release proven by `SettlementVerifier`)
  and is not represented as trustless.

---

## Supported assets (67)

Only BTC→WBTC and ETH→WETH are wrapped with the `W` prefix; all others keep their ticker.

**Majors:** BTC, ETH, BNB, SOL, XRP, ADA, DOGE, TRX, DOT, AVAX, LINK, TON, HBAR, XLM, LTC, BCH, NEAR,
APT, SUI, ALGO, VET, HYPE · **Stablecoins:** USDT, USDC, DAI, USDe, FDUSD, TUSD, PYUSD, EURC ·
**DeFi:** UNI, AAVE, ONDO, ENA, PENDLE, EIGEN, ETHFI, AERO, INJ, POL · **Liquid staking:** wstETH,
weETH, rETH · **AI:** TAO, FET, RENDER, WLD, VIRTUAL, AIXBT, AI16Z · **L2:** ARB, OP, POL ·
**Cosmos:** ATOM, TIA, INJ, SEI · **RWA:** PAXG, XAUT · **Privacy:** XMR, ZEC ·
**Memes:** SHIB, PEPE, BONK, WIF, PENGU, MOG, POPCAT, BRETT.

---

## Governance & audit posture

- Bridge custody (chain config, relayer sets, thresholds, tier ratchets, light-client init) is gated by
  `EitherOf<Root, Bridge>`: sudo on testnet; on mainnet custody passes to the **`Bridge` OpenGov track**
  (≥80% approval / ≥40% support, multi-week timelock). EVM-side liquidity (BridgeVault) has immutable
  verifier/`IMAGE_ID` and migrates only behind an immutable ≥3-day timelock with withdrawals open — no
  instant admin drain.
- An internal multi-agent **pre-audit** of the runtime, pallets, precompile, EVM contracts, and frontend
  was completed and **every finding fixed and retested**. An **external third-party audit** is the gate
  before real-funds mainnet.

## Honest trust boundaries

1. EVM L2s are Federated, not trustless (state isn't L1-final at proof time).
2. Monero is trusted (view-key watcher).
3. Non-BTC outbound release depends on the custody backend.
4. Light-client checkpoints are governance-anchored at init and sourced/verified independently.

---

© 2026 Quantova Inc · BUSL-1.1
