'use strict';

// Config stage only. Disabled unless ZEVON_ENABLE_CONFIG_CREATE=yes is explicitly set.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function createConsole({ plan, enabled, renderPreview, prepare, submit, verify, browserJS, logoPath }) {
  const token = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(18).toString('base64');
  let busy = false;
  const panel = `<style nonce="${nonce}">.configStage{margin-top:20px}</style><section class="card configStage"><h2>Stage 1: create ZEVON config</h2>
<p>Config rent plus network fee is expected to be about 0.006 SOL. The app enforces a 0.01 SOL ceiling for this stage.</p>
<p>Token creation and the 1 SOL buy are a separate stage. They are unavailable on this screen.</p>
<p><strong>${enabled ? 'Config creation enabled. Your next click requests a Phantom transaction approval.' : 'Signing disabled. Waiting for explicit approval before enabling config creation.'}</strong></p>
<button id="createConfig" ${enabled ? '' : 'disabled'}>Create config with Phantom</button><p id="configResult" aria-live="polite"></p></section>`;
  const client = `<script nonce="${nonce}" src="/solana-web3.js"></script><script nonce="${nonce}">
document.getElementById('createConfig').addEventListener('click',async()=>{
 const output=document.getElementById('configResult');const button=document.getElementById('createConfig');button.disabled=true;
 const api=async(route,payload)=>{const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Zevon-Token':${JSON.stringify(token)}},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
 try{
  const provider=window.phantom&&window.phantom.solana;if(!provider||!provider.isPhantom)throw Error('Phantom extension is unavailable.');
  const connected=await provider.connect();if(connected.publicKey.toString()!==plan.wallet)throw Error('Select the original ZEVON wallet.');
  if(!confirm('Create the saved ZEVON config on mainnet? Estimated cost about 0.006 SOL, maximum 0.01 SOL. This screen does not create the token or perform the 1 SOL buy.')){output.textContent='Cancelled.';button.disabled=false;return;}
  const prepared=await api('/prepare-config',{wallet:connected.publicKey.toString()});
  const bytes=Uint8Array.from(atob(prepared.transaction),c=>c.charCodeAt(0));const transaction=solanaWeb3.VersionedTransaction.deserialize(bytes);
  if(transaction.message.staticAccountKeys[0].toString()!==plan.wallet)throw Error('Unexpected transaction payer.');
  output.textContent='Review the config-creation transaction in Phantom.';
  const signed=await provider.signTransaction(transaction);
  if(!signed||!signed.message||!signed.serialize)throw Error('Phantom did not return a signed transaction.');
  const signedBytes=signed.serialize();let binary='';for(const byte of signedBytes)binary+=String.fromCharCode(byte);
  output.textContent='Phantom approved. Validating signatures and simulating before submission. Do not repeat.';
  const sent=await api('/submit-config',{transaction:btoa(binary)});
  localStorage.setItem('zevon-config-signature-'+plan.draft.config,sent.signature);
  output.textContent='Submitted: '+sent.signature+'. Waiting for on-chain verification. Do not repeat the transaction.';
  const result=await api('/verify-config',{signature:sent.signature});output.textContent='PASS: config confirmed and all 43 fields verified. Signature: '+result.signature+'. Stop here; pool creation requires a separate approval.';
 }catch(error){output.textContent=error.message+' Stop here and send the result to ChatGPT.';}
});</script>`;
  const html = renderPreview(plan, nonce).replace('</main>', panel + '</main>')
    .replace('</body>', client + '</body>');
  const reply = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
    const route = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (route === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
      else if (route === '/solana-web3.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(browserJS); }
      else if (route === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(fs.readFileSync(logoPath)); }
      else reply(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'POST') { reply(res, 405, { error: 'Method not allowed' }); return; }
    if (!enabled) { reply(res, 403, { error: 'Signing is disabled' }); return; }
    if (req.headers['x-zevon-token'] !== token) { reply(res, 403, { error: 'Invalid session token' }); return; }
    if (!['/prepare-config', '/submit-config', '/verify-config'].includes(route)) { reply(res, 404, { error: 'Not found' }); return; }
    if (busy) { reply(res, 409, { error: 'An operation is already running' }); return; }
    busy = true;
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw Error('Request too large'); }
      const payload = JSON.parse(body);
      if (route === '/prepare-config') {
        assert.equal(payload.wallet, plan.wallet, 'Wrong wallet');
        reply(res, 200, await prepare());
      } else if (route === '/submit-config') {
        assert.equal(typeof payload.transaction, 'string', 'Missing signed transaction');
        assert.match(payload.transaction, /^[A-Za-z0-9+/]+={0,2}$/, 'Invalid transaction encoding');
        reply(res, 200, await submit(payload.transaction));
      } else {
        assert.match(payload.signature, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/, 'Invalid signature');
        reply(res, 200, await verify(payload.signature));
      }
    } catch (error) { reply(res, 400, { error: error.message }); }
    finally { busy = false; }
  });
}

function encodeBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let result = '';
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}

// The browser returns only Phantom's signature. Validate the exact prepared message
// and payer signature before the server adds the saved configuration signature.
function validateWalletSignature(transaction, pending, wallet, config) {
  const message = Buffer.from(transaction.message.serialize());
  assert.ok(message.equals(pending.message), 'Signed transaction differs from prepared config');
  const signers = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures);
  assert.equal(signers.length, 2, 'Unexpected signer count');
  assert.equal(signers[0].toBase58(), wallet.toBase58(), 'Unexpected payer');
  assert.equal(signers[1].toBase58(), config.toBase58(), 'Unexpected configuration signer');
  assert.equal(transaction.signatures.length, 2, 'Unexpected signature count');
  assert.ok(transaction.signatures[1].every(byte => byte === 0), 'Config must be unsigned before Phantom approval');
  const publicKey = crypto.createPublicKey({ format: 'der', type: 'spki',
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(wallet.toBytes())]) });
  assert.ok(crypto.verify(null, message, publicKey, Buffer.from(transaction.signatures[0])), 'Invalid Phantom signature');
}

function createSubmitter({ web3, connection, wallet, configKeypair, getPending, receiptFile, verifyConfigAccount }) {
  return async encoded => {
    const pending = getPending();
    assert.ok(pending && !pending.submissionAttempted, 'No pending transaction or submission already attempted; reconcile before retrying');
    assert.ok(!fs.existsSync(receiptFile), 'A signature was already recorded; reconcile before retrying');
    const bytes = Buffer.from(encoded, 'base64');
    assert.ok(bytes.length <= 1232, 'Transaction exceeds size limit');
    const transaction = web3.VersionedTransaction.deserialize(bytes);
    validateWalletSignature(transaction, pending, wallet, configKeypair.publicKey);
    assert.ok(!await verifyConfigAccount(), 'Config already exists; do not recreate it');
    assert.ok((await connection.isBlockhashValid(pending.latest.blockhash, { commitment: 'confirmed' })).value,
      'Transaction expired; stop and prepare again after reconciliation');
    transaction.sign([configKeypair]);
    const simulated = await connection.simulateTransaction(transaction, { sigVerify: true,
      commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [configKeypair.publicKey.toBase58()] } });
    assert.equal(simulated.value.err, null, 'Fully signed config simulation failed');
    const account = simulated.value.accounts?.[0];
    assert.ok(account, 'Simulated config is missing');
    assert.equal(account.owner, pending.account.owner, 'Unexpected simulated config owner');
    assert.equal(account.data[0], pending.account.data[0], 'Simulated config differs from reviewed settings');
    const fee = await connection.getFeeForMessage(transaction.message, 'confirmed');
    assert.notEqual(fee.value, null, 'Fee unavailable');
    const cost = account.lamports + fee.value;
    assert.ok(cost <= 10000000, 'Config cost exceeds the approved 0.01 SOL ceiling');
    assert.ok(await connection.getBalance(wallet, 'confirmed') >= cost, 'Insufficient SOL');
    const signature = encodeBase58(transaction.signatures[0]);
    // Persist the known signature BEFORE broadcast so interruptions cannot hide it.
    fs.writeFileSync(receiptFile, JSON.stringify({ signature, status: 'submission-attempted',
      config: configKeypair.publicKey.toBase58(), ...pending.latest }), { mode: 0o600, flag: 'wx' });
    pending.submissionAttempted = true;
    const sent = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
    assert.equal(sent, signature, 'RPC returned an unexpected signature; reconcile before retrying');
    return { signature };
  };
}

async function main() {
  const root = process.cwd();
  const web3 = require('@solana/web3.js');
  const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
  const { buildPlan } = require(root + '/check-zevon-plan.cjs');
  const { buildSummary, renderPreview } = require(root + '/preview-zevon-launch.cjs');
  const { loadOrCreateDraft, getPlanFingerprint } = require(root + '/prepare-zevon-launch.cjs');
  const { params, reference, connection, program, BN, wallet } = buildPlan();
  const plan = await buildSummary();
  assert.ok(plan.draft, 'Prepare the saved draft first');
  const draft = loadOrCreateDraft(root, wallet.toBase58(), getPlanFingerprint(params, wallet.toBase58(), BN), web3.Keypair);
  assert.equal(draft.config.publicKey.toBase58(), plan.draft.config);
  assert.equal(draft.mint.publicKey.toBase58(), plan.draft.mint);
  const enabled = process.env.ZEVON_ENABLE_CONFIG_CREATE === 'yes';
  const browserFolder = path.dirname(require.resolve('@solana/web3.js'));
  const browserFile = ['index.iife.min.js', 'index.iife.js'].map(file => path.join(browserFolder, file)).find(file => fs.existsSync(file));
  assert.ok(browserFile, 'Installed Solana browser bundle is unavailable');
  const receiptFile = path.join(draft.folder, 'config-receipt.json');
  let pending = null;
  async function verifyConfigAccount() {
    const account = await connection.getAccountInfo(draft.config.publicKey, 'confirmed');
    if (!account) return false;
    assert.ok(account.owner.equals(program.programId) && !account.executable, 'Unexpected config owner');
    assert.deepEqual(program.coder.accounts.decode('poolConfig', account.data),
      { ...reference, feeClaimer: wallet, leftoverReceiver: wallet }, 'On-chain config differs from reviewed settings');
    return true;
  }
  const existing = await verifyConfigAccount();
  if (existing) { console.log('Config already exists and matches all 43 fields. Do not recreate it.'); }
  const prepare = async () => {
    assert.ok(enabled && !existing, 'Config creation is disabled or already complete');
    assert.ok(!pending, 'A config transaction was already prepared; stop and reconcile before retrying');
    assert.ok(!fs.existsSync(receiptFile), 'A signature was already recorded; reconcile it before retrying');
    assert.ok(!await verifyConfigAccount(), 'Config is already created');
    const client = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
    const tx = await client.partner.createConfig({ ...params, config: draft.config.publicKey,
      feeClaimer: wallet, leftoverReceiver: wallet, quoteMint: reference.quoteMint, payer: wallet });
    assert.equal(tx.instructions.length, 1);
    assert.ok(tx.instructions[0].programId.equals(program.programId));
    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new web3.TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash,
      instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), ...tx.instructions] }).compileToV0Message();
    assert.deepEqual(message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(key => key.toBase58()).sort(),
      [wallet.toBase58(), draft.config.publicKey.toBase58()].sort());
    const unsigned = new web3.VersionedTransaction(message);
    assert.ok(unsigned.serialize().length <= 1232);
    const simulated = await connection.simulateTransaction(unsigned, { sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [plan.draft.config] } });
    assert.equal(simulated.value.err, null, 'Fresh config simulation failed');
    const account = simulated.value.accounts?.[0];
    assert.ok(account && account.owner === program.programId.toBase58());
    assert.deepEqual(program.coder.accounts.decode('poolConfig', Buffer.from(account.data[0], 'base64')),
      { ...reference, feeClaimer: wallet, leftoverReceiver: wallet });
    const fee = await connection.getFeeForMessage(message, 'confirmed');
    assert.notEqual(fee.value, null);
    const cost = account.lamports + fee.value;
    assert.ok(cost <= 10000000, 'Config cost exceeds the approved 0.01 SOL ceiling');
    assert.ok(await connection.getBalance(wallet, 'confirmed') >= cost, 'Insufficient SOL');
    // Phantom must sign first; the configuration key is added only after validation.
    pending = { latest, message: Buffer.from(message.serialize()), account, submissionAttempted: false };
    return { transaction: Buffer.from(unsigned.serialize()).toString('base64'), estimatedCostSOL: cost / 1e9 };
  };
  const submit = createSubmitter({ web3, connection, wallet, configKeypair: draft.config,
    getPending: () => pending, receiptFile, verifyConfigAccount });
  const verify = async signature => {
    assert.ok(pending, 'No prepared config transaction in this session');
    assert.ok(pending.submissionAttempted, 'No submission was attempted');
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    assert.equal(signature, receipt.signature, 'Signature differs from recorded submission');
    fs.writeFileSync(receiptFile, JSON.stringify({ signature, status: 'pending', config: plan.draft.config }), { mode: 0o600 });
    const result = await connection.confirmTransaction({ signature, ...pending.latest }, 'confirmed');
    assert.equal(result.value.err, null, 'Config transaction failed on-chain');
    const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    assert.ok(transaction && transaction.meta && transaction.meta.err === null, 'Confirmed transaction details unavailable');
    assert.ok(Buffer.from(transaction.transaction.message.serialize()).equals(pending.message), 'Confirmed transaction differs from prepared config');
    assert.ok(await verifyConfigAccount(), 'Confirmed config is missing');
    fs.writeFileSync(receiptFile, JSON.stringify({ signature, status: 'verified', config: plan.draft.config,
      slot: transaction.slot }), { mode: 0o600 });
    return { signature, config: plan.draft.config, verified: true };
  };
  const server = createConsole({ plan, enabled: enabled && !existing, renderPreview, prepare, submit, verify,
    browserJS: fs.readFileSync(browserFile), logoPath: path.join(root, 'logo-public.png') });
  server.on('error', error => { console.error('Config console stopped:', error.message); process.exitCode = 1; });
  server.listen(3000, '0.0.0.0', () => {
    console.log('ZEVON config console running on port 3000. Keep the port Private.');
    console.log(enabled && !existing ? 'CONFIG CREATION ENABLED. Requires your explicit click and Phantom approval.' : 'SIGNING DISABLED. Review only.');
    console.log('Pool creation and the 1 SOL buy are unavailable in this console.');
  });
}

module.exports = { createConsole, createSubmitter, validateWalletSignature, encodeBase58 };
if (!module.parent) main().catch(error => { console.error('Config console stopped:', error.message); process.exitCode = 1; });

