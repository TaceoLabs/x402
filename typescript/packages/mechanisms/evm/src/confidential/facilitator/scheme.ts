import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { FacilitatorEvmSigner } from "../../signer";
import {
  ConfidentialEvmPayload,
  ConfidentialExtra,
  BabyJubJubPoint,
  isConfidentialPayload,
} from "../types";
import { verifyConfidential } from "./verify";
import { settleConfidential } from "./settle";

/**
 * Configuration for the confidential facilitator scheme.
 */
export interface ConfidentialFacilitatorConfig {
  /** The facilitator signer for on-chain operations */
  signer: FacilitatorEvmSigner;
  /** The confidential token contract address */
  confidentialToken: string;
  /** EIP-712 domain parameters for the contract */
  eip712Domain: { name: string; version: string };
  /** The 3 MPC party BabyJubJub public keys */
  mpcPublicKeys: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint];
}

/**
 * EVM facilitator implementation for the Confidential payment scheme.
 *
 * Verifies confidential payment payloads (10-step verification) and settles
 * them by calling transferFrom() on the PrivateBalance contract.
 */
export class ConfidentialEvmScheme implements SchemeNetworkFacilitator {
  readonly scheme = "confidential";
  readonly caipFamily = "eip155:*";

  private readonly extra: ConfidentialExtra;

  constructor(private readonly config: ConfidentialFacilitatorConfig) {
    this.extra = {
      confidentialToken: config.confidentialToken,
      eip712Domain: config.eip712Domain,
      mpcPublicKeys: config.mpcPublicKeys,
    };
  }

  /**
   * Returns extra data for scheme discovery.
   * This is how clients receive the contract address, EIP-712 domain, and MPC public keys.
   */
  getExtra(_network: string): Record<string, unknown> | undefined {
    return this.extra as unknown as Record<string, unknown>;
  }

  /**
   * Returns the facilitator's signer addresses.
   */
  getSigners(_network: string): string[] {
    return [...this.config.signer.getAddresses()];
  }

  /**
   * Verify a confidential payment payload.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const rawPayload = payload.payload as Record<string, unknown>;

    if (!isConfidentialPayload(rawPayload)) {
      return {
        isValid: false,
        invalidReason: "invalid_confidential_payload_format",
        payer: undefined as unknown as string,
      };
    }

    const confidentialPayload = rawPayload as ConfidentialEvmPayload;

    return verifyConfidential(
      this.config.signer,
      payload,
      requirements,
      confidentialPayload,
      this.extra,
    );
  }

  /**
   * Settle a confidential payment by calling transferFrom on-chain.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const rawPayload = payload.payload as Record<string, unknown>;

    if (!isConfidentialPayload(rawPayload)) {
      return {
        success: false,
        errorReason: "invalid_confidential_payload_format",
        transaction: "",
        network: payload.accepted.network,
        payer: undefined as unknown as string,
      };
    }

    const confidentialPayload = rawPayload as ConfidentialEvmPayload;

    return settleConfidential(
      this.config.signer,
      payload,
      requirements,
      confidentialPayload,
      this.extra,
    );
  }
}
