# Confidential x402 Agent Demo

End-to-end demo of **privacy-preserving machine-to-machine payments** using [x402](https://github.com/coinbase/x402) and [TACEO's](https://github.com/TaceoLabs/private_deposit) confidential payment scheme on **Base Sepolia**.

An AI agent pays $0.05 USDC per API request — but unlike standard x402 where payment amounts are visible on-chain, this scheme **hides amounts** behind Poseidon2 hash commitments, encrypts the real values with BabyJubJub ECDH into secret shares for MPC operators, and proves correctness with a **client-side Groth16 ZK proof** verified both off-chain and on-chain.

## Architecture

```
Agent ──► Resource Server (:4021) ──► Facilitator (:4022) ──► Base Sepolia
               (paywall)              (verify + settle)       (PrivateBalance contract)
                                           │                     │
                                      Mock MPC (:4023)     ClientTransferVerifier
                                        ├── POST /balance-check      (on-chain Groth16)
                                        ├── POST /transfer-hint
                                        └── poll loop: read_queue → processMPC
```

**Payment flow:**

1. Agent requests data from a paid API endpoint
2. Server responds with `402 Payment Required` and the price ($0.05 USDC)
3. Agent generates a **Groth16 ZK proof** (~800ms) proving:
   - Poseidon2 commitment matches the amount
   - Additive 3-of-3 secret shares sum correctly
   - BabyJubJub ECDH encryption of shares to 3 MPC public keys
   - Amount fits in 80 bits
4. Agent sends the proof, commitment, encrypted ciphertext, and EIP-712 signature to the facilitator
5. Facilitator **verifies the ZK proof off-chain** (snarkjs, ~13ms), checks balance via MPC, verifies signature
6. Facilitator calls `transferFrom()` — the contract **verifies the proof on-chain** via `ClientTransferVerifier` (Groth16, ~300K gas), then queues the transfer
7. Only cryptographic commitments are stored on-chain — the $0.05 amount is never revealed
8. Mock MPC picks up the queued transfer (using a plaintext hint from the facilitator), updates balance commitments via `processMPC()`

## ZK Circuit

The client-side proof uses the `transfer_client(80)` circuit from [Consensys/private-transactions-taceo](https://github.com/Consensys/private-transactions-taceo) (`merces.circom`), with a modified commitment scheme for contract compatibility.

| Metric | Value |
|--------|-------|
| Non-linear constraints | 8,896 |
| Public signals | 15 (encrypt_pk + commitment + ciphertexts + mpc_pks) |
| Proof generation | ~800ms |
| Verification (off-chain) | ~13ms |
| Verification (on-chain) | ~300K gas |
| WASM size | 187 KB |
| Proving key (zkey) | 4.8 MB |

Circuit source is in `circom/`. Pre-compiled artifacts are in `artifacts/zk/`.

## Prerequisites

- **Node.js** >= 20
- **pnpm**

No Foundry required — contract artifacts are committed in the `artifacts/` directory.

## Quick Start: Local Anvil

Run the full demo locally with no testnet setup. Requires [Foundry](https://book.getfoundry.sh) (for `anvil`).

```bash
git clone -b feat/base-sepolia https://github.com/TaceoLabs/x402.git
cd x402/examples/typescript
pnpm install
cd agent-confidential
pnpm run setup              # builds @x402 workspace packages + frontend
./start-local.sh --agent    # deploys, starts all services, runs 3 ZK payments
```

Stop everything with `./start-local.sh --stop`.

## Quick Start: Base Sepolia (Pre-funded Wallets)

If you received `.env.sepolia` and `.mpc-balances.json` from a teammate:

```bash
git clone -b feat/base-sepolia https://github.com/TaceoLabs/x402.git
cd x402/examples/typescript
pnpm install

cd agent-confidential
pnpm run setup    # builds @x402 workspace packages + frontend

# Drop in the two files from your teammate
# cp /path/to/.env.sepolia .
# cp /path/to/.mpc-balances.json .

# Start everything
./start.sh

# Open http://localhost:4020
# Stop with: ./start.sh --stop
```

## Setup from Scratch (Base Sepolia)

### 1. Clone and install

```bash
git clone -b feat/base-sepolia https://github.com/TaceoLabs/x402.git
cd x402/examples/typescript
pnpm install

cd agent-confidential
pnpm run setup    # builds @x402 workspace packages + frontend
```

### 2. Generate wallets

```bash
pnpm run generate-wallets
```

This creates 4 fresh wallets (MPC, Facilitator, Agent, Server) and writes `.env.sepolia` with the private keys and Base Sepolia configuration.

### 3. Fund wallets

You need testnet ETH and USDC on Base Sepolia:

| Wallet | What to fund | Why |
|--------|-------------|-----|
| **MPC** | ~0.05 ETH | Deploys contracts + ongoing `processMPC` gas |
| **Facilitator** | ~0.02 ETH | `transferFrom` settlement transactions |
| **Agent** | ~0.002 ETH | `approve` + `deposit` gas |
| **Agent** | 20 USDC | Real USDC to deposit into the confidential system |

**ETH faucet** (Base Sepolia):
- https://www.alchemy.com/faucets/base-sepolia

**USDC faucet** (Base Sepolia):
- https://faucet.circle.com — select "Base Sepolia", enter the Agent address, request USDC

The wallet addresses are printed by `generate-wallets` and also in `.env.sepolia`.

### 4. Deploy contracts

```bash
pnpm run deploy:sepolia
```

This deploys Poseidon2, MockVerifier (MPC proof), ClientTransferVerifier (client ZK proof), QueryMapLib, and PrivateBalance to Base Sepolia using real USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`). It updates `.env.sepolia` with all deployed contract addresses.

### 5. Start and deposit

```bash
./start.sh --deposit
```

This starts all 4 services, then deposits the agent's USDC into the PrivateBalance contract (`approve()` → `deposit()`). The mock MPC automatically processes the deposit and creates the agent's balance commitment.

### 6. Run the demo

Open http://localhost:4020. Click "Enter Demo", then pick a ticker (ETH, BTC, SOL) to trigger a paid API request. The UI shows the full payment flow in real-time.

**CLI agent** (makes 3 consecutive paid requests with ZK proofs):

```bash
pnpm run agent:sepolia
```

**Stop everything:**

```bash
./start.sh --stop
```

**Restart later:**

```bash
./start.sh    # MPC balances persist across restarts
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Mock MPC | 4023 | Balance-check + transfer-hint endpoints + action queue processor |
| Facilitator | 4022 | Off-chain ZK proof verify, MPC balance check, on-chain settle |
| Resource Server | 4021 | Sentiment API behind $0.05 USDC confidential paywall |
| Dashboard | 4020 | React frontend with live flow visualization + SSE events |
| Agent (CLI) | — | Generates ZK proofs, makes 3 paid requests (ETH, BTC, SOL) |

## Contracts

| Contract | Purpose |
|----------|---------|
| **PrivateBalance** | Confidential token — Poseidon2 commitments, `transferFrom` with on-chain ZK verification, `deposit`, action queue |
| **ClientTransferVerifier** | On-chain Groth16 verifier for client ZK proofs (15 public signals) |
| **Poseidon2** | Hash function for balance commitments |
| **MockVerifier** | Always-true Groth16 verifier for mock MPC batch proofs |
| **USDC** | Real Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) |

Pre-compiled contract artifacts are in `artifacts/`. If you need to rebuild them from source, see the [private_deposit](https://github.com/TaceoLabs/private_deposit) repo (`forge build --skip test --skip script`).

## What's Real vs Mocked

| Component | Status |
|-----------|--------|
| x402 protocol flow (402 → sign → settle) | Real |
| EIP-712 signatures | Real |
| Poseidon2 commitments | Real |
| Client-side Groth16 ZK proof | Real (snarkjs, ~800ms) |
| On-chain ZK proof verification | Real (ClientTransferVerifier, ~300K gas) |
| Off-chain ZK proof verification | Real (snarkjs groth16.verify, ~13ms) |
| BabyJubJub ECDH encryption | Real |
| Ciphertext secret shares (3-of-3) | Real |
| On-chain settlement (`transferFrom`) | Real (Base Sepolia) |
| USDC deposits (`approve` → `deposit`) | Real (Base Sepolia USDC) |
| On-chain queue processing (`processMPC`) | Real (Base Sepolia) |
| MPC batch proof verification | Mocked (MockVerifier always returns true) |
| MPC network (3 nodes) | Mocked (single service with facilitator transfer hints) |

## Files

| File | Description |
|------|-------------|
| `start.sh` | One-command launcher — starts/stops all services |
| `generate-wallets.ts` | Creates 4 wallets, writes `.env.sepolia` template |
| `deploy.ts` | Deploys all contracts to local anvil |
| `deploy-sepolia.ts` | Deploys all contracts to Base Sepolia |
| `deposit-sepolia.ts` | Real USDC `approve()` → `deposit()` flow |
| `mock-mpc.ts` | Mock MPC — balance checks, transfer hints, action queue processing |
| `facilitator.ts` | x402 facilitator — ZK proof verification + MPC balance check + settle |
| `server.ts` | Resource server with x402 paywall middleware |
| `agent.ts` | CLI agent — generates ZK proofs, makes 3 paid requests |
| `dashboard.ts` | Express backend — SSE events, status API, payment orchestration |
| `frontend/` | React UI — flow diagram, event log, on-chain view |
| `artifacts/` | Pre-compiled Solidity contract ABIs and bytecode |
| `artifacts/zk/` | ZK circuit artifacts (WASM, proving key, verification key) |
| `circom/` | Circom circuit source (transfer_client, taceolib, circomlib) |

## Using the Confidential Scheme in Your Own App

The confidential payment scheme is implemented as a standard x402 scheme in the `@x402/evm` package, under the `confidential/` subpath. You can import it the same way you'd use the `exact` scheme:

```typescript
// Client — generates payments with ZK proofs
import { ConfidentialEvmScheme } from "@x402/evm/confidential/client";
import type { ProofGenerator } from "@x402/evm/confidential/client";

// Facilitator — verifies proofs + settles on-chain
import { ConfidentialEvmScheme } from "@x402/evm/confidential/facilitator";
import type { ProofVerifier } from "@x402/evm/confidential/facilitator";

// Resource Server — parses prices + enhances payment requirements
import { ConfidentialEvmScheme } from "@x402/evm/confidential/server";

// Shared types
import type {
  ConfidentialEvmPayload,
  ConfidentialCiphertext,
  BabyJubJubPoint,
  Groth16Proof,
} from "@x402/evm";
```

**Source code**: `typescript/packages/mechanisms/evm/src/confidential/`

The scheme plugs into the standard `x402Client`, `x402Facilitator`, and `x402ResourceServer` via `.register(network, scheme)` — see `agent.ts`, `facilitator.ts`, and `server.ts` in this demo for working examples.

## Troubleshooting

**"insufficient_confidential_balance"** — The agent hasn't deposited USDC or the mock MPC hasn't processed the deposit yet. Check `curl http://localhost:4023/status` to see tracked balances. Make sure mock-mpc is running.

**"invalid_client_proof"** — The ZK proof failed off-chain verification. Check that `artifacts/zk/verification_key.json` matches the proving key. Ensure the facilitator loaded the verification key (check startup logs).

**"nonce too low"** — Base Sepolia RPC nonce caching. Wait a few seconds and retry the command.

**Mock MPC not processing actions** — Ensure it's running (`curl http://localhost:4023/health`). The MPC wallet needs ETH for `processMPC` gas (~0.003 ETH per batch). Check that the facilitator sends transfer hints before settling (look for "Transfer hint received" in MPC logs).

**Deploy fails with "MPC wallet needs at least 0.01 ETH"** — Fund the MPC wallet address (shown in `.env.sepolia` as `MPC_ADDRESS`) with Base Sepolia ETH from a faucet.

**Dashboard shows stale data** — Hard refresh the browser. If the frontend was rebuilt, restart the dashboard service.

**MPC balance persistence** — The mock MPC saves balances to `.mpc-balances.json` so they survive restarts. Delete this file to reset to a clean state (you'll need to re-deposit).
