/**
 * A point on the BabyJubJub curve (x, y coordinates as decimal strings).
 */
export type BabyJubJubPoint = {
  x: string;
  y: string;
};

/**
 * Ciphertext containing 3-of-3 encrypted secret shares of amount and randomness,
 * plus an ephemeral BabyJubJub public key.
 */
export type ConfidentialCiphertext = {
  amount: [string, string, string];
  r: [string, string, string];
  senderPk: BabyJubJubPoint;
};

/**
 * The authorization data signed by the client for a confidential transferFrom.
 */
export type ConfidentialAuthorization = {
  sender: `0x${string}`;
  receiver: `0x${string}`;
  amountCommitment: string;
  /** Random challenge for compressed proof verification. */
  beta: string;
  ciphertext: ConfidentialCiphertext;
  nonce: string;
  deadline: string;
};

/**
 * Compressed Groth16 proof (4 field elements).
 *
 * Uses the proof compression technique from https://eprint.iacr.org/2025/1500
 * to reduce the on-chain verification cost. The verifier contract receives
 * [beta, gamma, alpha] as the 3 compressed public inputs.
 */
export type CompressedGroth16Proof = {
  compressedProof: [string, string, string, string];
};

/**
 * Legacy uncompressed Groth16 proof (pA, pB, pC).
 * Kept for backwards compatibility with the old PrivateBalance contract.
 */
export type Groth16Proof = {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
};

/**
 * The full confidential payment payload sent by the client.
 */
export type ConfidentialEvmPayload = {
  signature: `0x${string}`;
  authorization: ConfidentialAuthorization;
  clientProof?: CompressedGroth16Proof;
  /** @deprecated Legacy blinding factor — not used with Merces contracts. */
  blindingFactor?: string;
};

/**
 * Extra data included in PaymentRequirements for the confidential scheme.
 * Provides the client with contract address, EIP-712 domain, and MPC public keys.
 */
export type ConfidentialExtra = {
  confidentialToken: string;
  eip712Domain: {
    name: string;
    version: string;
  };
  mpcPublicKeys: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint];
};

/**
 * Type guard: checks if payload matches the ConfidentialEvmPayload shape.
 */
export function isConfidentialPayload(
  payload: Record<string, unknown>,
): payload is ConfidentialEvmPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "signature" in payload &&
    "authorization" in payload &&
    typeof payload.authorization === "object" &&
    payload.authorization !== null &&
    "sender" in (payload.authorization as Record<string, unknown>) &&
    "amountCommitment" in (payload.authorization as Record<string, unknown>) &&
    "ciphertext" in (payload.authorization as Record<string, unknown>)
  );
}
