'use strict';

// Prepare and simulate an unsigned draft. No signing or submission code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const PRIVATE_DIR = '.zevon-launch-state';
const URI = 'ipfs://bafkreifgqh2x744e7hcp5e3qnt6kyyy5agrac3teryahrykmtck7nxng7a';

function loadOrCreateDraft(root, wallet, fingerprint, Keypair) {
  // Exclude before writing. Refuse to use this folder if any file is already tracked.
  const tracked = execFileSync('git', ['ls-files', '--', PRIVATE_DIR], { cwd: root, encoding: 'utf8' });
  assert.equal(tracked.trim(), '', 'Launch state folder is tracked by Git; stop and inspect');
  const exclude = path.resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'],
    { cwd: root, encoding: 'utf8' }).trim());
  const rule = '/' + PRIVATE_DIR + '/';
  const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes(rule)) fs.appendFileSync(exclude, '\n' + rule + '\n');
  execFileSync('git', ['check-ignore', '--quiet', PRIVATE_DIR + '/keys.json'], { cwd: root });
  const folder = path.join(root, PRIVATE_DIR);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { mode: 0o700 });
  const folderStat = fs.lstatSync(folder);
  assert.ok(folderStat.isDirectory() && !folderStat.isSymbolicLink(), 'Invalid state folder');
  fs.chmodSync(folder, 0o700);
  const file = path.join(folder, 'keys.json');
  if (!fs.existsSync(file)) {
    const config = Keypair.generate();
    const mint = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify({ version: 1, wallet, fingerprint,
      config: Array.from(config.secretKey), mint: Array.from(mint.secretKey) }),
      { flag: 'wx', mode: 0o600 });
  }
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Invalid key storage file');
  assert.equal(stat.mode & 0o077, 0, 'Draft key file permissions must be private');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(record.version, 1);
  assert.equal(record.wallet, wallet, 'Draft belongs to a different wallet');
  assert.equal(record.fingerprint, fingerprint, 'Launch settings changed since draft preparation');
  return { folder, config: Keypair.fromSecretKey(Uint8Array.from(record.config)),
    mint: Keypair.fromSecretKey(Uint8Array.from(record.mint)) };
}

async function main() {
  const web3 = require('@solana/web3.js');
  const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
  const { buildPlan } = require(process.cwd() + '/check-zevon-plan.cjs');
  const { params, reference, connection, program, BN, wallet } = buildPlan();
  const normalize = value => {
    if (BN.isBN(value)) return value.toString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ params: normalize(params),
    wallet: wallet.toBase58(), name: 'ZEVON', symbol: 'ZEVON', uri: URI,
    buyLamports: '1000000000', minimumOutput: '31438793605717' })).digest('hex');
  const draft = loadOrCreateDraft(process.cwd(), wallet.toBase58(), fingerprint, web3.Keypair);
  const config = draft.config.publicKey;
  const mint = draft.mint.publicKey;
  const live = await connection.getAccountInfo(new web3.PublicKey(
    '4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis'), 'finalized');
  assert.ok(live && live.owner.equals(program.programId) && !live.executable);
  assert.equal(crypto.createHash('sha256').update(live.data).digest('hex'),
    '12c6893483a51aac0372360d13b2d37344bfe52bff71e0b75e9f76fde28a8e4d');
  const alreadyCreated = await connection.getMultipleAccountsInfo([config, mint], 'confirmed');
  assert.ok(alreadyCreated.every(account => account === null), 'A draft address already exists on-chain; stop and inspect');
  const client = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
  const pair = await client.partner.createConfigAndPoolWithFirstBuy({
    ...params, config, feeClaimer: wallet, leftoverReceiver: wallet,
    quoteMint: reference.quoteMint, payer: wallet,
    preCreatePoolParam: { baseMint: mint, name: 'ZEVON', symbol: 'ZEVON', uri: URI, poolCreator: wallet },
    firstBuyParam: { buyer: wallet, receiver: wallet, buyAmount: new BN('1000000000'),
      minimumAmountOut: new BN('31438793605717'), referralTokenAccount: null },
  });
  const latest = await connection.getLatestBlockhash('confirmed');
  const transactions = [];
  const budgets = [200000, 250000];
  const signerKeys = [[wallet, config], [wallet, mint]];
  for (const [index, tx] of [pair.createConfigTx, pair.createPoolWithFirstBuyTx].entries()) {
    const message = new web3.TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash,
      instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: budgets[index] }),
        ...tx.instructions] }).compileToV0Message();
    assert.deepEqual(message.staticAccountKeys.slice(0, message.header.numRequiredSignatures)
      .map(key => key.toBase58()).sort(), signerKeys[index].map(key => key.toBase58()).sort());
    const unsigned = new web3.VersionedTransaction(message);
    assert.ok(unsigned.signatures.every(sig => sig.every(byte => byte === 0)));
    assert.ok(unsigned.serialize().length <= 1232);
    const fee = await connection.getFeeForMessage(message, 'confirmed');
    assert.notEqual(fee.value, null);
    transactions.push({ unsigned, bytes: unsigned.serialize().length, fee: fee.value,
      digest: crypto.createHash('sha256').update(message.serialize()).digest('hex') });
  }
  const simulation = await connection.simulateTransaction(transactions[0].unsigned, {
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [config.toBase58()] },
  });
  if (simulation.value.err) {
    console.error('Config simulation logs:', (simulation.value.logs || []).join('\n'));
    throw new Error('Config simulation failed: ' + JSON.stringify(simulation.value.err));
  }
  const result = simulation.value.accounts?.[0];
  assert.ok(result && result.owner === program.programId.toBase58());
  assert.equal(result.data[1], 'base64');
  const created = program.coder.accounts.decode('poolConfig', Buffer.from(result.data[0], 'base64'));
  assert.deepEqual(created, { ...reference, feeClaimer: wallet, leftoverReceiver: wallet });
  const review = { version: 1, mode: 'unsigned-draft', wallet: wallet.toBase58(), fingerprint,
    mint: mint.toBase58(), config: config.toBase58(),
    pool: sdk.deriveDbcPoolAddress(reference.quoteMint, mint, config).toBase58(),
    metadataURI: URI, buyLamports: '1000000000', minimumOutputRaw: '31438793605717',
    configSimulationSlot: simulation.context.slot, configComputeUnits: simulation.value.unitsConsumed,
    transactions: transactions.map((tx, index) => ({ bytes: tx.bytes, feeLamports: tx.fee,
      messageDigest: tx.digest, computeBudget: budgets[index] })),
    builtAt: new Date().toISOString(), poolSimulation: 'Reference-config rehearsal passed; new-config pool simulation pending' };
  fs.writeFileSync(path.join(draft.folder, 'review.json'), JSON.stringify(review, null, 2), { mode: 0o600 });
  console.log('PASS: exact draft config simulation matches AUTON with your recipient addresses');
  console.log('PASS: both unsigned draft transactions fit packet limits and require only expected signers');
  console.log('Draft ZEVON mint:', review.mint);
  console.log('Draft ZEVON config:', review.config);
  console.log('Draft ZEVON pool:', review.pool);
  console.log('Config simulation slot:', review.configSimulationSlot);
  console.log('Draft saved privately in Codespace and excluded from Git. Same addresses will be reused.');
  console.log('No signing or submission. Keep the private state folder in your Codespace; do not upload it.');
}

module.exports = { loadOrCreateDraft };
if (!module.parent) main().catch(error => { console.error('Draft preparation stopped:', error.message); process.exitCode = 1; });
