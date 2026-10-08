# ZEVON iPhone launch console (pre-deployment)

This is a **working mobile-friendly pre-launch verification website**, not a functioning token deployment tool. It connects to Phantom using the wallet's injected provider, checks the expected public address, attempts to read the SOL balance, and checks ZEVON's pinned JSON metadata. **It cannot sign, create a config, mint tokens, or spend SOL.** The launch button is intentionally disabled.

## iPhone-only publishing (GitHub Pages)

1. In Safari on iPhone, visit https://github.com and create/sign in to your account.
2. Create a **new public repository**, for example `zevon-launch-console`.
3. Open the repository. Use **Add file → Upload files** to upload `index.html`, `style.css`, `script.js`, `logo.png`, `metadata.json`, and `launch-config.json` from this folder (extract ZIP first in the iPhone Files app). Safari's **Request Desktop Website** may help if the controls are hidden.
4. Commit the files. Open **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
5. Wait for the Pages deployment. The site URL should look like `https://YOUR-GITHUB-USERNAME.github.io/zevon-launch-console/`.
6. Open Phantom on iPhone, use its in-app browser to open the published URL, tap **Connect Phantom**, and confirm the displayed wallet matches `47jKwD5fkDcspPFoiRWN5SUrLjA3zw2THZV95Qu48Pto`.
7. Tap **Check IPFS metadata**. If the gateway blocks cross-origin browser requests, open the metadata link directly.

**Important:** Publishing this repository is not deploying a token. Do not send funds to any site or wallet based on these files. The deployment requires a separate, tested SDK transaction-builder implementation and review of all AUTON configuration parameters. Public GitHub Pages content and the source code are visible to others; this package includes only public data, never secrets.

Official Meteora SDK: https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
Official DBC developer docs: https://docs.meteora.ag/developer-guides/dbc

## Integration update: read-only on-chain inspection

This update adds `inspection.js`, a browser-based, read-only `getAccountInfo` check of the AUTON DBC PoolConfig on Solana mainnet. It validates the owner and expected 1048-byte length, computes a SHA-256 digest, and lets you download the raw base64 account snapshot for subsequent SDK decoding. Some public RPC servers block browser CORS; enter a trusted HTTPS RPC endpoint if needed. Never paste API secrets into a public repository.

**This is not a transaction builder.** The live launch button is deliberately disabled. To implement deployment, decode and compare every config field with the official SDK, verify exact fees/curve/vesting and fee recipient semantics, build `createConfig` and `createPoolWithFirstBuy`, simulate both, and obtain explicit Phantom approvals. Do not copy this source account as the ZEVON configuration without replacing wallet recipients.

To update GitHub Pages on iPhone: extract this ZIP, upload the files from the extracted folder to the **root** of your existing `zevon-launch-console` repository, overwrite matching files and commit to `main`. Wait for GitHub Pages to rebuild, then reopen in Phantom.
