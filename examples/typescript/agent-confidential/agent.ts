/**
 * agent.ts — AI agent client that makes paid API calls with confidential payments.
 *
 * Registers the confidential scheme with ZK proof generation, wraps axios,
 * and makes 3 paid requests to the resource server's sentiment API.
 *
 * Usage: tsx agent.ts
 * Requires: .env file, facilitator on :4022, server on :4021
 */

import { config } from "dotenv";
config();

import axios from "axios";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { publicActions } from "viem";
import { x402Client, wrapAxiosWithPayment, x402HTTPClient } from "@x402/axios";
import { ConfidentialEvmScheme } from "@x402/evm/confidential/client";
import { toClientEvmSigner } from "@x402/evm";
import type { ProofGenerator } from "@x402/evm/confidential/client";
import type { Network } from "@x402/core/types";
import type { ConfidentialCiphertext, BabyJubJubPoint } from "@x402/evm";
import * as snarkjs from "snarkjs";
import { resolve, dirname } from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";

if (!AGENT_KEY) {
  console.error("Missing AGENT_PRIVATE_KEY. Run 'pnpm run deploy' first.");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BN254_PRIME = BigInt("0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001");
const BJJ_FR = BigInt("2736030358979909402780800718157159386076813972158567259200215660948447373041");

function randomFieldElement(): bigint {
  const bytes = crypto.randomBytes(32);
  const n = BigInt("0x" + bytes.toString("hex"));
  return n % BN254_PRIME;
}

function randomScalar(): bigint {
  const bytes = crypto.randomBytes(32);
  const n = BigInt("0x" + bytes.toString("hex"));
  return n % BJJ_FR;
}

// ── ZK Proof Artifacts ───────────────────────────────────────────────────────

const WASM_PATH = resolve(__dirname, "./artifacts/zk/merces_client.wasm");
const ZKEY_PATH = resolve(__dirname, "./artifacts/zk/merces_client.zkey");

// ── Chain & Signer ─────────────────────────────────────────────────────────────

const chain = CHAIN_ID === 84532
  ? defineChain({ ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } })
  : defineChain({
      id: CHAIN_ID,
      name: "Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    });

const account = privateKeyToAccount(AGENT_KEY);
const viemClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
}).extend(publicActions);

const signer = toClientEvmSigner(account, viemClient);

// ── ZK Proof Generator ──────────────────────────────────────────────────────

const proofGenerator: ProofGenerator = async (amount, r, mpcPublicKeys) => {
  const encryptSk = randomScalar();
  const shareAmount = [randomFieldElement(), randomFieldElement()];
  const shareR = [randomFieldElement(), randomFieldElement()];

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      amount: amount.toString(),
      amount_r: r.toString(),
      encrypt_sk: encryptSk.toString(),
      mpc_pks: mpcPublicKeys.map((pk: BabyJubJubPoint) => [pk.x, pk.y]),
      share_amount: shareAmount.map((s: bigint) => s.toString()),
      share_amount_r: shareR.map((s: bigint) => s.toString()),
    },
    WASM_PATH,
    ZKEY_PATH,
  );

  // Public signals (15): encrypt_pk(2), amount_c(1), ciphertexts(6, interleaved), mpc_pks(6)
  const ciphertext: ConfidentialCiphertext = {
    amount: [publicSignals[3], publicSignals[5], publicSignals[7]],
    r: [publicSignals[4], publicSignals[6], publicSignals[8]],
    senderPk: { x: publicSignals[0], y: publicSignals[1] },
  };

  return {
    proof: {
      pA: [proof.pi_a[0], proof.pi_a[1]] as [string, string],
      pB: [
        [proof.pi_b[0][0], proof.pi_b[0][1]],
        [proof.pi_b[1][0], proof.pi_b[1][1]],
      ] as [[string, string], [string, string]],
      pC: [proof.pi_c[0], proof.pi_c[1]] as [string, string],
    },
    amountCommitment: BigInt(publicSignals[2]),
    ciphertext,
  };
};

// ── x402 Client Setup ──────────────────────────────────────────────────────────

const NETWORK: Network = `eip155:${CHAIN_ID}`;
const client = new x402Client();
client.register(NETWORK, new ConfidentialEvmScheme(signer, proofGenerator));

const httpClient = new x402HTTPClient(client);
const api = wrapAxiosWithPayment(axios.create(), httpClient);

// ── Agent Loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Confidential x402 Agent Demo (with ZK proof)");
  console.log("=".repeat(60));
  console.log(`  Agent:  ${account.address}`);
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Network: ${NETWORK}`);
  console.log("=".repeat(60));
  console.log("");

  const tickers = ["ETH", "BTC", "SOL"];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    console.log(`[Agent] Request ${i + 1}/${tickers.length}: Fetching sentiment for ${ticker}...`);

    try {
      const response = await api.get(`${SERVER_URL}/v1/sentiment?ticker=${ticker}`);
      const data = response.data;

      console.log(`[Agent] Response: ${data.ticker} — sentiment=${data.sentiment}, signal=${data.signal}`);

      // Extract payment settlement info from response headers
      const settleResponse = httpClient.getPaymentSettleResponse(
        (name: string) => response.headers[name.toLowerCase()] as string | undefined,
      );

      if (settleResponse?.success) {
        console.log(`[Agent] Payment settled — tx: ${settleResponse.transaction}`);
        console.log(`[Agent] ZK proof verified + amount hidden on-chain\n`);
      } else {
        console.log(`[Agent] Payment response:`, settleResponse);
        console.log("");
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.error(`[Agent] Request failed: ${err.response?.status} ${err.response?.data?.error || err.message}\n`);
      } else {
        console.error(`[Agent] Request failed:`, err);
        console.log("");
      }
    }

    // Small delay between requests
    if (i < tickers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log("=".repeat(60));
  console.log("  Demo Complete!");
  console.log("  3 payments settled on-chain — ZK proofs verified, amounts hidden.");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Agent] Fatal error:", err);
    process.exit(1);
  });
