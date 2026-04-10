import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
} from "@x402/core/types";
import { getAddress } from "viem";
import { FacilitatorEvmSigner } from "../../signer";
import { ConfidentialEvmPayload, ConfidentialExtra, CompressedGroth16Proof } from "../types";
import { transferFromTypes, mercesABI, ZERO_COMMITMENT } from "../constants";
import { isOnBabyJubJubCurve, isInField, hashCiphertext } from "../crypto";

/**
 * Callback type for verifying a compressed client ZK proof off-chain.
 *
 * The facilitator calls this before submitting to the contract. The `publicSignals` array
 * contains the 15 values in circuit order: encrypt_pk(2), amount_c(1), ciphertexts(6), mpc_pks(6).
 * The `beta` is the random challenge from the compressed proof.
 *
 * The verifier should:
 * 1. Compute alpha = sha256(abi.encodePacked(publicSignals)), drop top 3 bits
 * 2. Compute gamma = UHF(alpha, beta, publicSignals) — Horner evaluation mod PRIME
 * 3. Verify the compressed proof against [beta, gamma, alpha]
 */
export type ProofVerifier = (
  proof: CompressedGroth16Proof,
  publicSignals: string[],
  beta: string,
) => Promise<boolean>;

/**
 * Verification for a confidential payment payload.
 *
 * 1. Scheme matches "confidential"
 * 2. Network matches
 * 3. Receiver matches payTo
 * 4. Deadline not expired (with 6s buffer)
 * 5. Commitment in BN254 field
 * 6. Ciphertext shares in field
 * 7. senderPk on BabyJubJub curve
 * 8. Nonce not used (on-chain check)
 * 9. Sender has balance (commitment != ZERO_COMMITMENT)
 * 10. EIP-712 signature valid (includes beta + ciphertextHash)
 * 11. Verify client ZK proof (if proofVerifier provided)
 */
export async function verifyConfidential(
  signer: FacilitatorEvmSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  confidentialPayload: ConfidentialEvmPayload,
  extra: ConfidentialExtra,
  proofVerifier?: ProofVerifier,
): Promise<VerifyResponse> {
  const payer = confidentialPayload.authorization.sender;

  // 1. Scheme matches
  if (payload.accepted.scheme !== "confidential" || requirements.scheme !== "confidential") {
    return { isValid: false, invalidReason: "unsupported_scheme", payer };
  }

  // 2. Network matches
  if (payload.accepted.network !== requirements.network) {
    return { isValid: false, invalidReason: "network_mismatch", payer };
  }

  // 3. Receiver matches payTo
  if (getAddress(confidentialPayload.authorization.receiver) !== getAddress(requirements.payTo)) {
    return { isValid: false, invalidReason: "receiver_mismatch", payer };
  }

  // 4. Deadline not expired (with 6-second buffer for block time)
  const now = Math.floor(Date.now() / 1000);
  if (BigInt(confidentialPayload.authorization.deadline) < BigInt(now + 6)) {
    return { isValid: false, invalidReason: "deadline_expired", payer };
  }

  // 5. Commitment in BN254 field
  const commitment = BigInt(confidentialPayload.authorization.amountCommitment);
  if (!isInField(commitment)) {
    return { isValid: false, invalidReason: "commitment_not_in_field", payer };
  }

  // 6. Ciphertext shares in field
  const ct = confidentialPayload.authorization.ciphertext;
  const allShares = [...ct.amount, ...ct.r];
  for (const share of allShares) {
    if (!isInField(BigInt(share))) {
      return { isValid: false, invalidReason: "ciphertext_share_not_in_field", payer };
    }
  }

  // 7. senderPk on BabyJubJub curve
  if (!isOnBabyJubJubCurve(BigInt(ct.senderPk.x), BigInt(ct.senderPk.y))) {
    return { isValid: false, invalidReason: "sender_pk_not_on_curve", payer };
  }

  // 8. Nonce not used (on-chain check)
  const confidentialToken = getAddress(extra.confidentialToken) as `0x${string}`;
  try {
    const nonceUsed = (await signer.readContract({
      address: confidentialToken,
      abi: mercesABI,
      functionName: "isNonceUsed",
      args: [payer, BigInt(confidentialPayload.authorization.nonce)],
    })) as boolean;

    if (nonceUsed) {
      return { isValid: false, invalidReason: "nonce_already_used", payer };
    }
  } catch {
    return { isValid: false, invalidReason: "nonce_check_failed", payer };
  }

  // 9. Sender has balance (commitment != ZERO_COMMITMENT)
  try {
    const balanceCommitment = (await signer.readContract({
      address: confidentialToken,
      abi: mercesABI,
      functionName: "getBalanceCommitment",
      args: [payer],
    })) as bigint;

    if (balanceCommitment === ZERO_COMMITMENT) {
      return {
        isValid: false,
        invalidReason: "no_balance",
        invalidMessage: "Sender has no confidential balance (zero commitment).",
        payer,
      };
    }
  } catch {
    // If balance check fails, continue — MPC will reject later if funds insufficient
  }

  // 10. EIP-712 signature valid (includes beta + ciphertextHash)
  const chainId = parseInt(requirements.network.split(":")[1]);
  const ciphertextHash = hashCiphertext(ct);
  const beta = BigInt(confidentialPayload.authorization.beta);

  const domain = {
    name: extra.eip712Domain.name,
    version: extra.eip712Domain.version,
    chainId,
    verifyingContract: confidentialToken,
  };

  const message = {
    sender: getAddress(payer),
    receiver: getAddress(confidentialPayload.authorization.receiver),
    amountCommitment: commitment,
    ciphertextHash,
    beta,
    nonce: BigInt(confidentialPayload.authorization.nonce),
    deadline: BigInt(confidentialPayload.authorization.deadline),
  };

  try {
    const isValid = await signer.verifyTypedData({
      address: payer,
      domain,
      types: transferFromTypes,
      primaryType: "TransferFromAuthorization",
      message,
      signature: confidentialPayload.signature,
    });

    if (!isValid) {
      return { isValid: false, invalidReason: "invalid_signature", payer };
    }
  } catch {
    return { isValid: false, invalidReason: "signature_verification_failed", payer };
  }

  // 11. Verify client ZK proof (if proofVerifier provided)
  if (proofVerifier) {
    if (!confidentialPayload.clientProof) {
      return { isValid: false, invalidReason: "missing_client_proof", payer };
    }

    // Public signals order: encrypt_pk(2) + amount_c(1) + ciphertexts(6, interleaved) + mpc_pks(6)
    const publicSignals = [
      ct.senderPk.x,
      ct.senderPk.y,
      confidentialPayload.authorization.amountCommitment,
      ct.amount[0], ct.r[0],
      ct.amount[1], ct.r[1],
      ct.amount[2], ct.r[2],
      ...extra.mpcPublicKeys.flatMap((pk) => [pk.x, pk.y]),
    ];

    try {
      const proofValid = await proofVerifier(
        confidentialPayload.clientProof,
        publicSignals,
        confidentialPayload.authorization.beta,
      );
      if (!proofValid) {
        return { isValid: false, invalidReason: "invalid_client_proof", payer };
      }
    } catch {
      return { isValid: false, invalidReason: "proof_verification_failed", payer };
    }
  }

  return { isValid: true, invalidReason: undefined, payer };
}
