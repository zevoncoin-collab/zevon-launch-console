'use strict';

// Read-only preview. No signing methods, transaction submission, or secret keys.
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

async function buildSummary() {
  const { buildPlan } = require(process.cwd() + '/check-zevon-plan.cjs');
  const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
  const { reference: c, connection, BN, wallet } = buildPlan();
  const logo = fs.readFileSync('logo.png');
  assert.equal(crypto.createHash('sha256').update(logo).digest('hex'),
    'fc68e986ec84e452bc14aae18ed2556784981220c91438c9582b764007738ba8', 'Original logo changed');
  const [balance, configRent] = await Promise.all([
    connection.getBalance(wallet, 'finalized'),
    connection.getMinimumBalanceForRentExemption(1048, 'confirmed'),
  ]);
  const quote = new sdk.PoolService(connection, 'confirmed').getQuoteFromInputAmount({
    config: c, swapBaseForQuote: false, amountIn: new BN('1000000000'),
    slippageBps: 0, hasReferral: false, eligibleForFirstSwapWithMinFee: false,
    currentPoint: new BN(0),
  });
  assert.equal(quote.outputAmount.toString(), '31438793605717');
  const poolRent = 22070080; // Account rent measured in the successful rehearsal.
  const estimatedFees = 20000; // Both unsigned transaction fee checks returned 10,000 each.
  const estimatedTotal = 1000000000 + configRent + poolRent + estimatedFees;
  const decimal = (value, places) => {
    const digits = value.toString().padStart(places + 1, '0');
    return digits.slice(0, -places) + '.' + digits.slice(-places);
  };
  const summary = { name: 'ZEVON', symbol: 'ZEVON', wallet: wallet.toBase58(),
    supply: '1,000,000,000', decimals: c.tokenDecimal, buySOL: '1',
    expectedTokens: '31,438,793.605717', minimumOutputRaw: quote.outputAmount.toString(),
    bondingFeePercent: Number(c.poolFees.baseFee.cliffFeeNumerator.toString()) / 10000000,
    creatorTradingFeePercentage: c.creatorTradingFeePercentage,
    creatorLockedLP: c.creatorPermanentLockedLiquidityPercentage,
    partnerLockedLP: c.partnerPermanentLockedLiquidityPercentage,
    migrationThresholdSOL: decimal(c.migrationQuoteThreshold, 9),
    metadataURI: 'ipfs://bafkreifgqh2x744e7hcp5e3qnt6kyyy5agrac3teryahrykmtck7nxng7a',
    estimatedTotalSOL: decimal(estimatedTotal, 9), balanceSOL: decimal(balance, 9),
    estimatedRemainingSOL: balance >= estimatedTotal ? decimal(balance - estimatedTotal, 9) : 'Insufficient balance',
    builtAt: new Date().toISOString(), mode: 'preview-only' };
  const reviewFile = process.cwd() + '/.zevon-launch-state/review.json';
  if (fs.existsSync(reviewFile)) {
    // Read only the public review file, never the private keys file.
    const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    const { PublicKey } = require('@solana/web3.js');
    assert.equal(review.version, 1);
    assert.equal(review.mode, 'unsigned-draft');
    assert.equal(review.wallet, summary.wallet);
    assert.equal(review.metadataURI, summary.metadataURI);
    assert.equal(review.buyLamports, '1000000000');
    assert.equal(review.minimumOutputRaw, summary.minimumOutputRaw);
    const mint = new PublicKey(review.mint);
    const config = new PublicKey(review.config);
    assert.equal(sdk.deriveDbcPoolAddress(c.quoteMint, mint, config).toBase58(), review.pool);
    assert.ok(Number.isSafeInteger(review.configSimulationSlot) && review.configSimulationSlot > 0);
    assert.ok(Array.isArray(review.transactions) && review.transactions.length === 2);
    summary.draft = { mint: mint.toBase58(), config: config.toBase58(), pool: review.pool,
      configSimulationSlot: review.configSimulationSlot, preparedAt: review.builtAt,
      transactions: review.transactions.map(tx => ({ bytes: tx.bytes,
        computeBudget: tx.computeBudget, feeLamports: tx.feeLamports })) };
  }
  return summary;
}

function renderPreview(plan, nonce) {
  // Public summary only. Escape HTML-significant characters in inline JSON.
  const json = JSON.stringify(plan).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ZEVON launch preview</title>
<style nonce="${nonce}">
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#080b18;color:#eff1ff}
*{box-sizing:border-box}body{margin:0;padding:32px 20px}main{max-width:900px;margin:auto}
header{display:flex;align-items:center;gap:22px;margin-bottom:30px}img{width:110px;height:110px;object-fit:contain}
h1{font-size:36px;margin:4px 0}h2{font-size:20px;margin:0 0 20px}p{line-height:1.6;color:#bbc1dd}
.badge{color:#89e6ff;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:24px;border:1px solid #29324e;border-radius:18px;background:#11162a}
dl{margin:0}dt{font-size:13px;color:#a5aecb;margin-top:18px}dt:first-child{margin-top:0}dd{margin:5px 0 0;line-height:1.5;overflow-wrap:anywhere}
.big{font-size:27px;font-weight:700;color:#b6a5ff}.wide{grid-column:1/-1}button{font:inherit;font-weight:600;padding:13px 19px;border:0;border-radius:10px;background:#9edfff;color:#061326;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
#walletStatus{overflow-wrap:anywhere;min-height:50px}.success{color:#9ce8c0}.mismatch{color:#ffc091}
.note{font-size:13px}footer{margin-top:24px;font-size:13px;color:#9da8c8}@media(max-width:620px){.grid{grid-template-columns:1fr}body{padding:20px 14px}header{gap:12px}img{width:75px;height:75px}h1{font-size:27px}.card{padding:20px}}
</style></head><body><main>
<header><img src="/logo.png" alt="Original ZEVON logo"><div><div class="badge">Launch preview · Mainnet plan</div><h1>ZEVON <small>($ZEVON)</small></h1><p>Autonomous Intelligence, Evolved.</p></div></header>
<div class="grid"><section class="card"><h2>Token and first buy</h2><dl>
<dt>Supply</dt><dd id="supply"></dd><dt>Initial buy</dt><dd class="big">1 SOL</dd><dt>Quoted tokens received</dt><dd class="big" id="tokens"></dd><dt>Authorities after creation</dt><dd>Mint: removed · Freeze: removed<br>Metadata: immutable</dd></dl></section>
<section class="card"><h2>Estimated cost</h2><dl><dt>Total, including buy, rent, and both network fees</dt><dd class="big" id="total"></dd><dt>Wallet balance at preview creation</dt><dd id="balance"></dd><dt>Estimated remaining balance</dt><dd id="remaining"></dd></dl><p class="note">These are estimates from the successful rehearsal and current config rent. Final transactions need fresh fee and balance checks.</p></section>
<section class="card"><h2>Bonding and migration</h2><dl><dt>Route</dt><dd>Meteora DBC → DAMM v2</dd><dt>Bonding trading fee</dt><dd id="fee"></dd><dt>Creator share of trading fees</dt><dd id="creatorFee"></dd><dt>Permanently locked LP split</dt><dd id="locked"></dd><dt>Migration quote threshold</dt><dd id="threshold"></dd></dl></section>
<section class="card"><h2>Two transactions</h2><p>1. Create your ZEVON config.<br>2. Create the pool and make the 1 SOL buy together.</p><p class="note">The copied config passed mainnet simulation. Pool and buy passed a rehearsal with the matching AUTON reference config. The unsigned ZEVON transaction pair passed size and signer checks. The pool using your new config has not yet been simulated against live state.</p></section>
<section class="card wide"><h2>Your original creator wallet</h2><p>Creator, payer, fee claimer, and leftover receiver:</p><p id="expectedWallet"></p><button id="connect" type="button">Connect Phantom for address check</button><p id="walletStatus" aria-live="polite">No wallet connected. This page can only request your public address.</p><p class="note">This preview has no signing or launch controls. Connecting does not create a token or spend SOL.</p></section>
<section class="card wide" id="draftCard"><h2>Prepared ZEVON draft addresses</h2><dl>
<dt>Token mint</dt><dd id="draftMint"></dd><dt>Config</dt><dd id="draftConfig"></dd><dt>Pool</dt><dd id="draftPool"></dd>
<dt>Exact config simulation</dt><dd id="draftSlot"></dd><dt>Unsigned transaction sizes</dt><dd id="draftSizes"></dd></dl>
<p class="note">These addresses are saved in your Codespace for the launch review. They are not yet created on-chain. Pool creation using this new config still needs a live-state simulation after config creation. No launch controls are enabled here.</p></section>
<section class="card wide"><h2>Published metadata</h2><p id="uri"></p><p class="note">Original logo preserved.</p></section></div>
<footer id="timestamp"></footer></main>
<script nonce="${nonce}">
'use strict';const plan=${json};
const el=id=>document.getElementById(id);const text=(id,value)=>{el(id).textContent=value;};
text('supply',plan.supply+' ZEVON · '+plan.decimals+' decimals');text('tokens',plan.expectedTokens+' ZEVON');
text('total',plan.estimatedTotalSOL+' SOL');text('balance',plan.balanceSOL+' SOL');text('remaining',plan.estimatedRemainingSOL+' SOL');
text('fee',plan.bondingFeePercent+'%');text('creatorFee',plan.creatorTradingFeePercentage+'%');
text('locked',plan.creatorLockedLP+'% creator / '+plan.partnerLockedLP+'% partner');text('threshold',plan.migrationThresholdSOL+' SOL');
text('expectedWallet',plan.wallet);text('uri',plan.metadataURI);text('timestamp','Preview created '+new Date(plan.builtAt).toLocaleString());
if(plan.draft){text('draftMint',plan.draft.mint);text('draftConfig',plan.draft.config);text('draftPool',plan.draft.pool);text('draftSlot','Passed at slot '+plan.draft.configSimulationSlot);text('draftSizes','Config: '+plan.draft.transactions[0].bytes+' bytes · Pool and buy: '+plan.draft.transactions[1].bytes+' bytes');}else{el('draftCard').hidden=true;}
const status=publicKey=>{const address=publicKey?publicKey.toString():null;el('walletStatus').className=address===plan.wallet?'success':address?'mismatch':'';text('walletStatus',!address?'Wallet disconnected.':address===plan.wallet?'Confirmed: your original ZEVON wallet is connected.':'Different wallet connected: '+address+'. Select your original ZEVON wallet in Phantom.');};
const provider=window.phantom&&window.phantom.solana;
if(provider&&provider.isPhantom){provider.on('accountChanged',status);provider.on('disconnect',()=>status(null));}
el('connect').addEventListener('click',async()=>{
 if(!provider||!provider.isPhantom){text('walletStatus','Open this page in Chrome with your Phantom extension enabled.');return;}
 el('connect').disabled=true;try{const response=await provider.connect();status(response.publicKey);}catch(error){text('walletStatus','Connection was not completed: '+(error.message||'request declined'));}finally{el('connect').disabled=false;}
});
</script></body></html>`;
}

function createServer(plan, logoPath) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const html = renderPreview(plan, nonce);
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Read-only preview'); return; }
    const path = req.url.split('?')[0];
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : html); }
    else if (path === '/plan.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(plan)); }
    else if (path === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(logoPath)); }
    else { res.writeHead(404); res.end('Not found'); }
  });
}

async function main() {
  const plan = await buildSummary();
  const server = createServer(plan, process.cwd() + '/logo.png');
  server.on('error', error => { console.error('Preview server stopped:', error.message); process.exitCode = 1; });
  server.listen(3000, '0.0.0.0', () => {
    console.log('ZEVON read-only launch preview is running on port 3000.');
    console.log('In Codespaces: Ports → 3000 → Open in Browser. Keep the port Private.');
    console.log('You may connect Phantom to check the public address. There are no signing or spending controls.');
    console.log('Leave this terminal running. Ctrl+C stops the preview.');
  });
}

module.exports = { buildSummary, renderPreview, createServer };
if (!module.parent) main().catch(error => { console.error('Preview stopped:', error.message); process.exitCode = 1; });
