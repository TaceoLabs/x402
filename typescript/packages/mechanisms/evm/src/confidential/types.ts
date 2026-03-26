/**
 * A point on the BabyJubJub curve (x, y coordinates as hex strings).
 */
export type BabyJubJubPoint = {
  x: string;
  y: string;
};

/**
 * Ciphertext containing 3-of-3 secret shares of amount and randomness,
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
  ciphertext: ConfidentialCiphertext;
  nonce: string;
  deadline: string;
};

/**
 * Groth16 proof for client-side ZK verification.
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
  clientProof?: Groth16Proof;
  /** Blinding factor r — sent in plaintext so facilitator can recompute commit(amount, r) */
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
