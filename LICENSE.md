# Quantova Licensing Overview

This repository contains software, specifications, and documentation developed and maintained by **Quantova Inc**.

This file serves as the authoritative licensing index for the Quantova technology stack and applies to all contents of this repository unless explicitly stated otherwise.

---

## Copyright and Ownership

© 2026 Quantova Inc

All rights reserved.

Quantova Inc is a company registered in Singapore and is the legal owner and steward of:

- The Quantova protocol
- The QRC20 network standards
- The Quantova Virtual Machine (QVM)
- The Provenance and Quantization Registry (PQR)
- Associated research, specifications, and reference implementations

---

## Primary License: Business Source License (BUSL-1.1)

Unless otherwise stated, all Quantova protocol code, including but not limited to:

- Consensus and finality logic
- Runtime and state transition code
- Quantova Virtual Machine (QVM)
- Networking and node implementation
- Protocol-level cryptographic integrations

is licensed under the **Business Source License, version 1.1 (BUSL-1.1)**.

The full license text is included in this repository at:

`/LICENSE-BUSL-1.1`

The authoritative BUSL-1.1 license text may also be obtained from: <https://mariadb.com/bsl11/>

---

## Validator and Node Operator Clarification

Running a validator node or full node on the canonical Quantova network is explicitly permitted under the BUSL-1.1 license and does not constitute restricted "Production Use."

A formal clarification for validators, node operators, exchanges, custodians, and infrastructure providers is provided at:

`/docs/validators/licensing.md`

Participation in staking, consensus, block production, and transaction processing on the Quantova network does not create additional licensing obligations.

---

## Restricted Use Under BUSL-1.1

The BUSL-1.1 license restricts the use of Quantova consensus, runtime, and QVM code to launch, operate, or market a competing blockchain network or distributed ledger that is not the canonical Quantova network.

This restriction applies to, but is not limited to:

- Independent or derivative mainnets
- Forks marketed as separate networks
- Networks intended to replace or compete with Quantova

Forking, modifying, or analyzing the code for testing, auditing, research, or contribution purposes is permitted.

---

## Canonical Network Definition

For licensing and authorization purposes, the canonical Quantova network is defined by all of the following:

- Official signed source releases published by Quantova Inc
- A unique post-quantum genesis hash
- Signed runtime and protocol artifacts
- Post-quantum cryptographic signatures, including CRYSTALS-Dilithium and Falcon

Any network deployment that does not match these identifiers is not the Quantova network and is not authorized under the Quantova BUSL license.

---

## Documentation and Specifications

Documentation, research materials, and protocol specifications included in this repository are licensed under BUSL-1.1 unless explicitly stated otherwise within the relevant file or directory.

Documentation is provided for informational and technical reference purposes and reflects protocol behavior enforced by code.

---

## Third-Party Software

This repository may include or depend on third-party open-source software. Such components remain subject to their original licenses.

Where applicable, third-party license notices are provided in:

`/THIRD_PARTY_LICENSES.md`

or within dependency manifests.

---

## No Legal, Financial, or Regulatory Advice

Nothing in this repository, including documentation and specifications, constitutes legal, financial, or regulatory advice.

Operators, validators, and users are responsible for ensuring compliance with applicable laws and regulations in their respective jurisdictions.

---

## Institutional and Licensing Inquiries

Licensing, institutional, and regulatory inquiries relating to the Quantova technology stack should be directed through official Quantova channels published by Quantova Inc.

Protocol identity and licensing intent are cryptographically anchored at genesis via an immutable on-chain commitment.

---

© 2026 Quantova Inc
