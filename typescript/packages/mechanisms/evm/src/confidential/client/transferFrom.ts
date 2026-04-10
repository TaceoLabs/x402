import { PaymentRequirements, PaymentPayloadResult } from "@x402/core/types";
import { getAddress } from "viem";
import { ClientEvmSigner } from "../../signer";
import { transferFromTypes } from "../constants";
import { ConfidentialEvmPayload, ConfidentialExtra, ConfidentialCiphertext, CompressedGroth16Proof, BabyJubJubPoint } from "../types";
import { randomFieldElement, createCiphertext, hashCiphertext } from "../crypto";

/**
 * Callback type for generating a compressed Groth16 ZK proof of
 * commitment + secret sharing + BabyJubJub ECDH encryption.
 *
 * Returns the compressed proof (4 field elements), beta (random challenge),
 * commitment, and ciphertext (encrypted shares from circuit output).
 */
export type ProofGenerator = (
  amount: bigint,
  r: bigint,
  mpcPublicKeys: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint],
) => Promise<{
  proof: CompressedGroth16Proof;
  /** Random challenge for compressed proof verification. */
  beta: bigint;
  amountCommitment: bigint;
  ciphertext: ConfidentialCiphertext;
}>;

/**
 * Creates a confidential transferFrom payload with EIP-712 signature.
 *
 * 1. Generates random blinding factor and computes commitment + ciphertext (via ZK proof or legacy path)
 * 2. Signs EIP-712 TransferFromAuthorization including beta and ciphertextHash
 * 3. Returns the payload ready for the facilitator to submit
 */
export async function createTransferFromPayload(
  signer: ClientEvmSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  proofGenerator?: ProofGenerator,
): Promise<PaymentPayloadResult> {
  const extra = paymentRequirements.extra as unknown as ConfidentialExtra;
  if (!extra?.confidentialToken || !extra?.eip712Domain) {
    throw new Error(
      "Payment requirements missing confidential extra (confidentialToken, eip712Domain)",
    );
  }

  const amount = BigInt(paymentRequirements.amount);
  const receiver = getAddress(paymentRequirements.payTo);
  const chainId = parseInt(paymentRequirements.network.split(":")[1]);
  const confidentialToken = getAddress(extra.confidentialToken) as `0x${string}`;

  // 1. Generate random blinding factor
  const r = randomFieldElement();

  let amountCommitment: bigint;
  let ciphertext: ConfidentialCiphertext;
  let clientProof: CompressedGroth16Proof | undefined;
  let beta: bigint = BigInt(0);

  if (proofGenerator) {
    // ZK proof path: circuit computes commitment + encrypted shares + compressed proof
    const result = await proofGenerator(amount, r, extra.mpcPublicKeys);
    amountCommitment = result.amountCommitment;
    ciphertext = result.ciphertext;
    clientProof = result.proof;
    beta = result.beta;
  } else {
    // Legacy path: on-chain commitment + plaintext shares (no proof, no beta)
    amountCommitment = (await signer.readContract({
      address: confidentialToken,
      abi: [
        {
          type: "function",
          name: "commit",
          inputs: [
            { name: "input", type: "uint256" },
            { name: "randomness", type: "uint256" },
          ],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "commit",
      args: [amount, r],
    })) as bigint;

    ciphertext = createCiphertext(amount, r);
  }

  // 2. Generate random nonce and compute deadline
  const nonce = randomFieldElement();
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + paymentRequirements.maxTimeoutSeconds);

  // 3. Compute ciphertext hash for EIP-712 signing
  const ciphertextHash = hashCiphertext(ciphertext);

  // 4. Sign EIP-712 TransferFromAuthorization
  const domain = {
    name: extra.eip712Domain.name,
    version: extra.eip712Domain.version,
    chainId,
    verifyingContract: confidentialToken,
  };

  const message = {
    sender: getAddress(signer.address),
    receiver,
    amountCommitment,
    ciphertextHash,
    beta,
    nonce,
    deadline,
  };

  const signature = await signer.signTypedData({
    domain,
    types: transferFromTypes,
    primaryType: "TransferFromAuthorization",
    message,
  });

  // 5. Build the payload
  const payload: ConfidentialEvmPayload = {
    signature,
    authorization: {
      sender: getAddress(signer.address),
      receiver,
      amountCommitment: amountCommitment.toString(),
      beta: beta.toString(),
      ciphertext,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
    clientProof,
  };

  return {
    x402Version,
    payload,
  };
}
