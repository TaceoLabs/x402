/**
 * deploy.ts — Deploy all contracts to local anvil for the confidential x402 demo.
 *
 * Reads compiled forge artifacts from the private_deposit repo and deploys:
 *   1. MockUSDC (test ERC-20 token — needed because real USDC can't be minted on local chain)
 *   2. Poseidon2 hasher
 *   3. Groth16Verifier (the real verifier from private_deposit)
 *   4. QueryMapLib (library used by PrivateBalance)
 *   5. PrivateBalance (confidential token contract)
 *
 * Then seeds the agent's confidential balance using setBalancesForDemo().
 *
 * Usage: tsx deploy.ts
 * Requires: anvil running on http://127.0.0.1:8545
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");

// Anvil default accounts
const MPC_KEY = (process.env.MPC_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const AGENT_KEY = (process.env.AGENT_PRIVATE_KEY ||
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6") as `0x${string}`;
const SERVER_KEY = (process.env.SERVER_PRIVATE_KEY ||
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") as `0x${string}`;

// Path to forge artifacts
const CONTRACTS_OUT = resolve(
  __dirname,
  process.env.CONTRACTS_OUT_DIR || "../../../../../private_deposit/contracts/out",
);

// BabyJubJub base point (a valid point on the curve — used as mock MPC public keys)
const BABYJUBJUB_BASE = {
  x: BigInt("5299619240641551281634865583518297030282874472190772894086521144482721001553"),
  y: BigInt("16950150798460657717958625567821834550301663161624707787222815936182638968203"),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const anvil = defineChain({
  id: CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

function loadArtifact(contractDir: string, contractName: string) {
  const path = resolve(CONTRACTS_OUT, contractDir, `${contractName}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    abi: raw.abi,
    bytecode: raw.bytecode.object as `0x${string}`,
    linkReferences: raw.bytecode.linkReferences as Record<string, Record<string, Array<{ start: number; length: number }>>>,
  };
}

/**
 * Link a library address into bytecode, replacing the __$...$__ placeholder.
 */
function linkBytecode(
  bytecode: string,
  linkReferences: Record<string, Record<string, Array<{ start: number; length: number }>>>,
  libraries: Record<string, `0x${string}`>,
): `0x${string}` {
  let linked = bytecode;
  for (const [file, libs] of Object.entries(linkReferences)) {
    for (const [libName, offsets] of Object.entries(libs)) {
      const addr = libraries[libName];
      if (!addr) throw new Error(`Missing library address for ${file}:${libName}`);
      // Address without 0x prefix, lowercased, 40 chars
      const addrHex = addr.slice(2).toLowerCase();
      for (const { start, length } of offsets) {
        // Offsets are in bytes; bytecode string is hex with 0x prefix, so chars = 2 + start*2
        const charStart = 2 + start * 2;
        const charLen = length * 2;
        linked = linked.slice(0, charStart) + addrHex + linked.slice(charStart + charLen);
      }
    }
  }
  return linked as `0x${string}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[Deploy] Starting deployment to anvil...\n");

  const mpcAccount = privateKeyToAccount(MPC_KEY);
  const agentAccount = privateKeyToAccount(AGENT_KEY);
  const serverAccount = privateKeyToAccount(SERVER_KEY);

  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account: mpcAccount,
    chain: anvil,
    transport: http(RPC_URL),
  });

  // 1. Deploy MockUSDC
  console.log("[Deploy] Deploying MockUSDC...");
  const mockUSDC = loadArtifact("MockUSDC.sol", "MockUSDC");
  const usdcHash = await walletClient.deployContract({
    abi: mockUSDC.abi,
    bytecode: mockUSDC.bytecode,
  });
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  const usdcAddress = usdcReceipt.contractAddress!;
  console.log(`[Deploy] MockUSDC deployed at ${usdcAddress}\n`);

  // 2. Deploy Poseidon2
  console.log("[Deploy] Deploying Poseidon2 hasher...");
  const poseidon2 = loadArtifact("poseidon2.sol", "Poseidon2T2_BN254");
  const poseidonHash = await walletClient.deployContract({
    abi: poseidon2.abi,
    bytecode: poseidon2.bytecode,
  });
  const poseidonReceipt = await publicClient.waitForTransactionReceipt({ hash: poseidonHash });
  const poseidonAddress = poseidonReceipt.contractAddress!;
  console.log(`[Deploy] Poseidon2 deployed at ${poseidonAddress}\n`);

  // 3. Deploy Groth16Verifier (the real one from private_deposit)
  console.log("[Deploy] Deploying Groth16Verifier...");
  const verifier = loadArtifact("groth16_verifier.sol", "Groth16Verifier");
  const verifierHash = await walletClient.deployContract({
    abi: verifier.abi,
    bytecode: verifier.bytecode,
  });
  const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierHash });
  const verifierAddress = verifierReceipt.contractAddress!;
  console.log(`[Deploy] Groth16Verifier deployed at ${verifierAddress}\n`);

  // 4. Deploy QueryMapLib (library used by PrivateBalance)
  console.log("[Deploy] Deploying QueryMapLib...");
  const queryMapLib = loadArtifact("action_queue.sol", "QueryMapLib");
  const queryMapHash = await walletClient.deployContract({
    abi: queryMapLib.abi,
    bytecode: queryMapLib.bytecode,
  });
  const queryMapReceipt = await publicClient.waitForTransactionReceipt({ hash: queryMapHash });
  const queryMapAddress = queryMapReceipt.contractAddress!;
  console.log(`[Deploy] QueryMapLib deployed at ${queryMapAddress}\n`);

  // 5. Deploy PrivateBalance (with QueryMapLib linked)
  console.log("[Deploy] Deploying PrivateBalance...");
  const privBalance = loadArtifact("priv_balance.sol", "PrivateBalance");
  const linkedBytecode = linkBytecode(
    privBalance.bytecode,
    privBalance.linkReferences,
    { QueryMapLib: queryMapAddress as `0x${string}` },
  );
  const privBalanceHash = await walletClient.deployContract({
    abi: privBalance.abi,
    bytecode: linkedBytecode,
    args: [
      verifierAddress,                // _verifierAddress
      poseidonAddress,                // _poseidon2Address
      mpcAccount.address,             // _mpcAddress (MPC operator)
      usdcAddress,                    // _usdcAddress
      BABYJUBJUB_BASE,               // _mpc_pk1
      BABYJUBJUB_BASE,               // _mpc_pk2
      BABYJUBJUB_BASE,               // _mpc_pk3
      true,                           // _allow_all (no whitelist for demo)
    ],
  });
  const privBalanceReceipt = await publicClient.waitForTransactionReceipt({ hash: privBalanceHash });
  const privBalanceAddress = privBalanceReceipt.contractAddress!;
  console.log(`[Deploy] PrivateBalance deployed at ${privBalanceAddress}\n`);

  // ── Seed Agent Balance ───────────────────────────────────────────────────────

  console.log("[Seed] Setting up agent balance...");

  // Compute a Poseidon2 commitment for the agent's balance (100 USDC = 100_000_000 units)
  const agentBalance = BigInt(100_000_000); // 100 USDC in 6-decimal units
  // Use a fixed randomness for the demo (in production this would be random)
  const agentRandomness = BigInt("12345678901234567890");

  const balanceCommitment = await publicClient.readContract({
    address: privBalanceAddress,
    abi: privBalance.abi,
    functionName: "commit",
    args: [agentBalance, agentRandomness],
  }) as bigint;

  console.log(`[Seed] Agent balance commitment: 0x${balanceCommitment.toString(16)}`);
  console.log(`[Seed] (Represents ${agentBalance} units = ${Number(agentBalance) / 1e6} USDC)\n`);

  // Set balance via setBalancesForDemo (called as MPC operator)
  const setBalanceTx = await walletClient.writeContract({
    address: privBalanceAddress,
    abi: privBalance.abi,
    functionName: "setBalancesForDemo",
    args: [
      [getAddress(agentAccount.address), getAddress(serverAccount.address)],
      [balanceCommitment, BigInt(0)], // Agent has balance; server starts with 0 (will get ZERO_COMMITMENT)
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: setBalanceTx });

  // Verify
  const storedCommitment = await publicClient.readContract({
    address: privBalanceAddress,
    abi: privBalance.abi,
    functionName: "getBalanceCommitment",
    args: [agentAccount.address],
  }) as bigint;
  console.log(`[Seed] Verified agent commitment on-chain: 0x${storedCommitment.toString(16)}`);
  console.log(`[Seed] Agent ${agentAccount.address} has confidential balance set\n`);

  // ── Write .env ───────────────────────────────────────────────────────────────

  const envContent = `# Generated by deploy.ts — DO NOT EDIT
# Anvil default accounts
MPC_PRIVATE_KEY=${MPC_KEY}
FACILITATOR_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
SERVER_PRIVATE_KEY=${SERVER_KEY}
AGENT_PRIVATE_KEY=${AGENT_KEY}

# Chain
CHAIN_ID=${CHAIN_ID}
RPC_URL=${RPC_URL}

# Contract addresses
USDC_ADDRESS=${usdcAddress}
POSEIDON2_ADDRESS=${poseidonAddress}
VERIFIER_ADDRESS=${verifierAddress}
PRIVATE_BALANCE_ADDRESS=${privBalanceAddress}

# Derived addresses
MPC_ADDRESS=${mpcAccount.address}
FACILITATOR_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
SERVER_ADDRESS=${serverAccount.address}
AGENT_ADDRESS=${agentAccount.address}

# MPC Public Keys (BabyJubJub base point used for all 3 in demo)
MPC_PK_X=${BABYJUBJUB_BASE.x.toString()}
MPC_PK_Y=${BABYJUBJUB_BASE.y.toString()}

# Forge artifacts path
CONTRACTS_OUT_DIR=${process.env.CONTRACTS_OUT_DIR || "../../../../private_deposit/contracts/out"}
`;

  const envPath = resolve(__dirname, ".env");
  writeFileSync(envPath, envContent);
  console.log(`[Deploy] Contract addresses written to ${envPath}\n`);

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("  Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`  USDC (test):     ${usdcAddress}`);
  console.log(`  Poseidon2:       ${poseidonAddress}`);
  console.log(`  Groth16Verifier: ${verifierAddress}`);
  console.log(`  PrivateBalance:  ${privBalanceAddress}`);
  console.log("");
  console.log(`  MPC Operator:    ${mpcAccount.address}`);
  console.log(`  Facilitator:     0x70997970C51812dc3A010C7d01b50e0d17dc79C8`);
  console.log(`  Server:          ${serverAccount.address}`);
  console.log(`  Agent:           ${agentAccount.address}`);
  console.log(`  Agent Balance:   ${Number(agentBalance) / 1e6} USDC (confidential)`);
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("  1. Start facilitator:  pnpm run facilitator");
  console.log("  2. Start server:       pnpm run server");
  console.log("  3. Run agent:          pnpm run agent");
}

main().catch((err) => {
  console.error("[Deploy] Fatal error:", err);
  process.exit(1);
});
