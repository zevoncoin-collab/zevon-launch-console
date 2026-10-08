# ZEVON Launch Console V3 — Read-only curve audit

Upload these files to the root of the existing GitHub Pages repository, replacing files of the same name and adding `audit.js`. Keep any existing unrelated files. The original `logo.png` is preserved unchanged from V2.

On iPhone open the website in Phantom, enter `https://solana-rpc.publicnode.com` in the HTTPS RPC field (if the default endpoint gives 403), and tap **Audit curve parameters**. The page reads the AUTON account, verifies its SHA-256 against the supplied snapshot, and extracts eleven raw integer fields at verified byte offsets. The export button saves a JSON report; iOS/Phantom may require Safari for downloads.

**This is not a launch tool.** No transaction signing, config creation, pool creation, or initial buy is implemented. No SOL can be spent by this page. The 11 integer comparisons are not a full Meteora PoolConfig schema decode. Before mainnet deployment, validate the SDK schema, all fee/vesting fields, metadata, signer permissions, rent/fees, and simulate both transactions with a current blockhash.

Do not share seed phrases or private keys.
