/**
 * BN254 scalar field prime modulus.
 * All commitments, ciphertext shares, and field elements must be < this value.
 */
export const BN254_PRIME = BigInt(
  "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001",
);

/**
 * Poseidon2 commitment to (0, 0) with domain separator 0xDEADBEEF.
 * Used as the "zero balance" sentinel in the contract.
 */
export const ZERO_COMMITMENT = BigInt(
  "0x087f763a403ee4109adc79d4a7638af3cb8cb6a33f5b027bd1476ffa97361acb",
);

/**
 * Domain separator used by the Poseidon2 hasher in the contract.
 */
export const POSEIDON2_DOMAIN_SEP = BigInt("0xDEADBEEF");

/**
 * BabyJubJub curve parameters.
 */
export const BABY_JUBJUB_A = BigInt(168700);
export const BABY_JUBJUB_D = BigInt(168696);

/**
 * EIP-712 typed data types for the TransferFrom authorization.
 * Must match the TRANSFER_FROM_TYPEHASH in priv_balance.sol.
 */
export const transferFromTypes = {
  TransferFrom: [
    { name: "sender", type: "address" },
    { name: "receiver", type: "address" },
    { name: "amountCommitment", type: "uint256" },
    { name: "ciphertextHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Minimal ABI for the PrivateBalance contract functions used by the confidential scheme.
 */
export const privateBalanceABI = [
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "sender", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amountCommitment", type: "uint256" },
      {
        name: "ciphertext",
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
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isNonceUsed",
    inputs: [
      { name: "account", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBalanceCommitment",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
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
  {
    type: "function",
    name: "usedNonces",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

/**
 * ABI encoding parameters for the Ciphertext struct, used for keccak256 hashing.
 */
export const ciphertextAbiType = {
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
} as const;
