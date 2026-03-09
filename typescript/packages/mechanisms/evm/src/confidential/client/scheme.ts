import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@x402/core/types";
import { ClientEvmSigner } from "../../signer";
import { createTransferFromPayload } from "./transferFrom";

/**
 * EVM client implementation for the Confidential payment scheme.
 *
 * Creates payment payloads with Poseidon2 commitments, secret-shared ciphertexts,
 * and EIP-712 signed transferFrom authorizations.
 */
export class ConfidentialEvmScheme implements SchemeNetworkClient {
  readonly scheme = "confidential";

  constructor(private readonly signer: ClientEvmSigner) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    _context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    return createTransferFromPayload(this.signer, x402Version, paymentRequirements);
  }
}
