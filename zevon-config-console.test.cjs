'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSubmitter, createConsole, encodeBase58 } = require('./zevon-config-console.cjs');

function fixture(t, change = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zevon-signing-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const receiptFile = path.join(directory, 'receipt.json');
  const keys = crypto.generateKeyPairSync('ed25519');
  const rawPublic = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const wallet = { toBase58: () => 'test-wallet', toBytes: () => rawPublic };
  const config = { toBase58: () => 'test-config' };
  const expectedMessage = Buffer.from('exact-reviewed-message');
  const signedMessage = change.message || expectedMessage;
  const account = { owner: 'reviewed-program', data: ['reviewed-data', 'base64'], lamports: 6000000 };
  const pending = { message: expectedMessage, latest: { blockhash: 'test-blockhash', lastValidBlockHeight: 123 }, account };
  const events = [];
  const transaction = {
    message: { serialize: () => signedMessage, header: { numRequiredSignatures: 2 }, staticAccountKeys: [wallet, config] },
    signatures: [crypto.sign(null, signedMessage, keys.privateKey), Buffer.alloc(64)],
    sign: () => { events.push('config-sign'); transaction.signatures[1] = Buffer.alloc(64, 1); },
    serialize: () => Buffer.from('fully-signed-test-transaction')
  };
  if (change.invalidSignature) transaction.signatures[0][0] ^= 1;
  if (change.configSigned) transaction.signatures[1][0] = 1;
  if (change.wrongSigner) transaction.message.staticAccountKeys[1] = wallet;
  const expectedSignature = encodeBase58(transaction.signatures[0]);
  const connection = {
    isBlockhashValid: async () => ({ value: !change.expired }),
    simulateTransaction: async (tx, options) => {
      events.push('simulate'); assert.equal(options.sigVerify, true);
      assert.ok(tx.signatures[1].some(byte => byte !== 0));
      assert.equal(options.replaceRecentBlockhash, undefined);
      return { value: { err: change.simulationFailure ? 'failed' : null,
        accounts: [{ ...account, ...change.account }] } };
    },
    getFeeForMessage: async () => ({ value: change.fee ?? 10000 }),
    getBalance: async () => change.balance ?? 20000000,
    sendRawTransaction: async (bytes, options) => {
      events.push('broadcast'); assert.equal(options.skipPreflight, false);
      const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      assert.equal(receipt.signature, expectedSignature);
      assert.equal(receipt.status, 'submission-attempted');
      if (change.rpcFailure) throw Error('RPC unavailable');
      return expectedSignature;
    }
  };
  const submit = createSubmitter({ web3: { VersionedTransaction: { deserialize: () => transaction } },
    connection, wallet, configKeypair: { publicKey: config }, getPending: () => pending,
    receiptFile, verifyConfigAccount: async () => !!change.exists });
  return { submit: () => submit('AA=='), events, pending, receiptFile, expectedSignature };
}

test('Phantom signature is checked before config signing, simulation, and a single broadcast', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.submit(), { signature: f.expectedSignature });
  assert.deepEqual(f.events, ['config-sign', 'simulate', 'broadcast']);
  await assert.rejects(f.submit(), /submission already attempted/);
});

for (const [name, change, error] of [
  ['changed message', { message: Buffer.from('tampered') }, /differs from prepared/],
  ['invalid wallet signature', { invalidSignature: true }, /Invalid Phantom signature/],
  ['config signed too early', { configSigned: true }, /must be unsigned/],
  ['wrong signer', { wrongSigner: true }, /Unexpected configuration signer/],
  ['expired blockhash', { expired: true }, /expired/],
  ['existing config', { exists: true }, /already exists/],
  ['simulation failure', { simulationFailure: true }, /simulation failed/],
  ['changed config data', { account: { data: ['changed', 'base64'] } }, /differs from reviewed/],
  ['changed program owner', { account: { owner: 'wrong' } }, /Unexpected simulated config owner/],
  ['cost above approval', { fee: 5000000 }, /0.01 SOL ceiling/],
  ['insufficient balance', { balance: 1 }, /Insufficient SOL/]
]) test('rejects ' + name + ' without broadcasting', async t => {
  const f = fixture(t, change);
  await assert.rejects(f.submit(), error);
  assert.ok(!f.events.includes('broadcast'));
  assert.ok(!fs.existsSync(f.receiptFile));
});

test('an ambiguous RPC failure keeps a durable signature and prevents resubmission', async t => {
  const f = fixture(t, { rpcFailure: true });
  await assert.rejects(f.submit(), /RPC unavailable/);
  assert.equal(JSON.parse(fs.readFileSync(f.receiptFile)).signature, f.expectedSignature);
  await assert.rejects(f.submit(), /submission already attempted/);
  assert.equal(f.events.filter(event => event === 'broadcast').length, 1);
});

test('base58 handles leading zeros and known vectors', () => {
  assert.equal(encodeBase58(Buffer.from([0, 0, 1])), '112');
  assert.equal(encodeBase58(Buffer.from('Hello World')), 'JxF12TrwUP45BMd');
});

test('review mode refuses every signing route', async t => {
  const server = createConsole({ plan: {}, enabled: false, renderPreview: () => '<main></main></body>',
    browserJS: '', logoPath: '', prepare: () => { throw Error('must not run'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const route of ['/prepare-config', '/submit-config', '/verify-config']) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST' });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Signing is disabled' });
  }
});
