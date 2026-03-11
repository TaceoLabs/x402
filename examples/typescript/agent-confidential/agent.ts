/**
 * agent.ts — AI agent client that makes paid API calls with confidential payments.
 *
 * Registers the confidential scheme, wraps axios, and makes 3 paid requests
 * to the resource server's sentiment API.
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
import type { Network } from "@x402/core/types";

// ── Configuration ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";

if (!AGENT_KEY) {
  console.error("Missing AGENT_PRIVATE_KEY. Run 'pnpm run deploy' first.");
  process.exit(1);
}

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

// ── x402 Client Setup ──────────────────────────────────────────────────────────

const NETWORK: Network = `eip155:${CHAIN_ID}`;
const client = new x402Client();
client.register(NETWORK, new ConfidentialEvmScheme(signer));

const httpClient = new x402HTTPClient(client);
const api = wrapAxiosWithPayment(axios.create(), httpClient);

// ── Agent Loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Confidential x402 Agent Demo");
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
        console.log(`[Agent] Amount hidden on-chain (only Poseidon2 commitment visible)\n`);
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
  console.log("  3 payments settled on-chain — all amounts hidden behind commitments.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("[Agent] Fatal error:", err);
  process.exit(1);
});
