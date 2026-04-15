# Taceo fork of x402 — `feat/real-mpc-integration`

This branch is the Taceo fork of [Coinbase's x402](https://github.com/coinbase/x402)
TypeScript stack. It adds **one** thing on top of upstream `main`: a
`confidential` payment scheme inside `@x402/evm`, sibling to the existing
`exact` scheme.

```
typescript/packages/mechanisms/evm/src/
├── exact/                  ← upstream
│   ├── client/
│   ├── facilitator/
│   └── server/
└── confidential/           ← us (this fork)
    ├── client/             ← builds payment payload, EIP-712 signs TransferFromAuthorization
    ├── facilitator/        ← verify + settle via Merces.transferFrom()
    ├── server/             ← resource-server side, builds paymentRequirements
    ├── types.ts
    ├── constants.ts        ← mercesABI, transferFromTypes, ZERO_COMMITMENT, BabyJubJub params
    └── crypto.ts           ← isOnBabyJubJubCurve, isInField, hashCiphertext
```

The scheme is designed to be upstreamable to Coinbase as a clean additive
PR — no upstream files are modified, only added.

## How this branch is used

The end-to-end demo lives in
[`TaceoLabs/Merces1_updated`](https://github.com/TaceoLabs/Merces1_updated)
on branch **`feat/x402-demo`**, in `x402-demo/`. That demo's
`pnpm-workspace.yaml` consumes the `@x402/*` packages from this branch via
relative paths, so the two repos must be checked out side-by-side:

```
<some-parent>/
├── Merces1_updated/        ← TaceoLabs/Merces1_updated @ feat/x402-demo
│   └── x402-demo/          ← the actual runnable demo
└── x402/
    └── repo/               ← TaceoLabs/x402 @ feat/real-mpc-integration  (this branch)
```

See `Merces1_updated/x402-demo/README.md` for setup + run instructions.

## Branch-specific commits

| Commit       | What                                                     |
| ------------ | -------------------------------------------------------- |
| `df3db3ae`   | `@x402/evm`: confidential scheme (types, ABI, verify, settle, server) |
| `f6fc6bef`   | `examples/` agent.ts + facilitator.ts (superseded by Merces1_updated/x402-demo) |
| `b06bb4f3`   | `examples/` deploy.ts (superseded by Merces1_updated/x402-demo) |

## Future work

- **PR upstream to Coinbase** — additive scheme, should be a clean diff.
- **Publish `@taceo/x402-evm` to npm** — would let consumers drop the
  side-by-side checkout in favor of a normal npm dep.
