# ZEVON DBC fee claims

This standalone screen claims creator and partner trading fees from the existing ZEVON pool to the original wallet ending `8Pto`. It does not create a token, trade, migrate the pool, or withdraw liquidity. Protocol fees are excluded. Each claim needs a separate Phantom transaction approval.

## Run in your existing Codespace

Use Node.js 20 or later. Install the reviewed SDK if it is not already available:

```sh
npm install --no-save --package-lock=false --ignore-scripts @meteora-ag/dynamic-bonding-curve-sdk@1.5.13
node zevon-fees.cjs
```

Open port **3001** in the Codespaces Ports tab. Keep visibility **Private**. Open the forwarded URL in a browser with Phantom, using wallet `47jKwD5fkDcspPFoiRWN5SUrLjA3zw2THZV95Qu48Pto`.

1. Refresh fees.
2. Preview the creator claim. It must pass simulation.
3. Review the amount and recipient, then click **Approve this claim in Phantom**.
4. Review and approve in Phantom. Use **Check confirmation** until confirmed.
5. Repeat for the partner claim.

If a claim is submitted but its result is uncertain, check its Solscan link and do not repeat it. Submission receipts are kept locally in `.zevon-fee-receipts`; do not delete them while resolving a pending transaction.

The wallet needs enough SOL upfront for token-account rent and the transaction fee. At the initial check, both simulations were blocked by insufficient SOL. Adding 0.005 SOL to this same wallet provides a buffer. Temporary wrapped-SOL account rent returns on unwrapping; rent for a newly created ZEVON token account stays deposited in that account. Existing nonzero wrapped SOL is rejected to avoid unexpectedly unwrapping other funds.

Read-only checks:

```sh
node zevon-fees.cjs --check
node zevon-fees.cjs --simulate
node --test zevon-fees.test.cjs
```

`--simulate` constructs unsigned transactions and simulates them without broadcasting. The screen validates all instruction accounts and exact fee amounts, requires the original wallet, checks the signed message and signature, re-simulates before submission, and records the transaction signature before broadcasting. Wallet keys are never read or stored by this tool.

As of October 11, 2026, 10:04 PM Central: 1.079818335 SOL creator fees plus 1.079818394 SOL partner fees were unclaimed. The pool had not graduated; pool-creation and configured migration fees were zero. Refresh before signing; these amounts can change.
