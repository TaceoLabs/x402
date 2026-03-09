import { encodeAbiParameters, keccak256 } from "viem";
import { BN254_PRIME, BABY_JUBJUB_A, BABY_JUBJUB_D } from "./constants";
import type { ConfidentialCiphertext } from "./types";

/**
 * Get a cryptographically secure random source (works in Node.js and browsers).
 */
function getCrypto(): { getRandomValues<T extends ArrayBufferView>(array: T): T } {
  if (typeof globalThis.crypto !== "undefined") {
    return globalThis.crypto;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("crypto").webcrypto;
}

/**
 * Generate a random element in the BN254 scalar field.
 * Returns a bigint in [0, PRIME - 1].
 */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  // Convert to bigint and reduce mod PRIME
  let value = BigInt(0);
  for (let i = 0; i < 32; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return ((value % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
}

/**
 * Create 3-of-3 additive secret shares over BN254.
 * s1, s2 are random; s3 = value - s1 - s2 mod PRIME.
 */
export function createSecretShares(value: bigint): [bigint, bigint, bigint] {
  const s1 = randomFieldElement();
  const s2 = randomFieldElement();
  const s3 = ((value - s1 - s2) % BN254_PRIME + BN254_PRIME) % BN254_PRIME;
  return [s1, s2, s3];
}

/**
 * Generate an ephemeral BabyJubJub keypair.
 * Uses a simple scalar multiplication of the base point.
 * For a production implementation, use circomlibjs or @zk-kit/baby-jubjub.
 *
 * For the demo, we generate a random point that is on the curve.
 * This is a placeholder — real ElGamal encryption would use proper key generation.
 */
export function generateEphemeralKeyPair(): { x: bigint; y: bigint } {
  // BabyJubJub base point (generator)
  const Bx = BigInt(
    "5299619240641551281634865583518297030282874472190772894086521144482721001553",
  );
  const By = BigInt(
    "16950150798460657717958625567821834550301663161624707787222815936182638968203",
  );
  // For demo purposes, return the base point itself.
  // A real implementation would do scalar multiplication: sk * B
  return { x: Bx, y: By };
}

/**
 * Build a Ciphertext struct from amount, randomness, and MPC public keys.
 *
 * In a real implementation, each share would be ElGamal-encrypted with the
 * corresponding MPC party's public key. For the demo, we use plain additive shares.
 */
export function createCiphertext(
  amount: bigint,
  randomness: bigint,
): ConfidentialCiphertext {
  const amountShares = createSecretShares(amount);
  const rShares = createSecretShares(randomness);
  const ephemeralKey = generateEphemeralKeyPair();

  return {
    amount: [
      amountShares[0].toString(),
      amountShares[1].toString(),
      amountShares[2].toString(),
    ],
    r: [rShares[0].toString(), rShares[1].toString(), rShares[2].toString()],
    senderPk: {
      x: ephemeralKey.x.toString(),
      y: ephemeralKey.y.toString(),
    },
  };
}

/**
 * Hash a ConfidentialCiphertext using keccak256(abi.encode(ciphertext)).
 * Must match the Solidity: keccak256(abi.encode(ciphertext)).
 */
export function hashCiphertext(ciphertext: ConfidentialCiphertext): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "amount", type: "uint256[3]" },
            { name: "r", type: "uint256[3]" },
            {
              name: "sender_pk",
              type: "tuple",
              components: [
                { name: "x", type: "uint256" },
                { name: "y", type: "uint256" },
              ],
            },
          ],
        },
      ],
      [
        {
          amount: [
            BigInt(ciphertext.amount[0]),
            BigInt(ciphertext.amount[1]),
            BigInt(ciphertext.amount[2]),
          ],
          r: [
            BigInt(ciphertext.r[0]),
            BigInt(ciphertext.r[1]),
            BigInt(ciphertext.r[2]),
          ],
          sender_pk: {
            x: BigInt(ciphertext.senderPk.x),
            y: BigInt(ciphertext.senderPk.y),
          },
        },
      ],
    ),
  );
}

/**
 * Check if a point (x, y) is on the BabyJubJub curve.
 * Curve equation: A*x^2 + y^2 = 1 + D*x^2*y^2 (mod PRIME)
 */
export function isOnBabyJubJubCurve(x: bigint, y: bigint): boolean {
  if (x === BigInt(0) && y === BigInt(1)) return true;
  if (x >= BN254_PRIME || y >= BN254_PRIME) return false;

  const p = BN254_PRIME;
  const xx = (x * x) % p;
  const yy = (y * y) % p;
  const axx = (BABY_JUBJUB_A * xx) % p;
  const dxxyy = (BABY_JUBJUB_D * ((xx * yy) % p)) % p;

  const lhs = (axx + yy) % p;
  const rhs = (BigInt(1) + dxxyy) % p;

  return lhs === rhs;
}

/**
 * Check that a value is within the BN254 scalar field.
 */
export function isInField(value: bigint): boolean {
  return value >= BigInt(0) && value < BN254_PRIME;
}
