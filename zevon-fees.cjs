'use strict';
// ZEVON DBC fee claims only. No private keys are read or stored.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const w = require('@solana/web3.js');
const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
const A = {
 wallet:'47jKwD5fkDcspPFoiRWN5SUrLjA3zw2THZV95Qu48Pto',
 pool:'hZdyeFJM2qLvSXMxR3GzeYx5bqLKsYCRQHXWXGW8dtv',
 mint:'AJpUGbp5tpyqv1989VTgjk4p53NZKdYffuzhnZBWeKLV',
 config:'EJgRDwmyjgWCrok2kxTYLzuKskmzWNSYWuS4SAWR8hn',
 program:'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
 authority:'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM',
 baseVault:'BYgToKTUfApUXc6CQRDLwWuncu9nn4nQPXaANwfWLjAh',
 quoteVault:'ArKDe2imc6BZTWECy9PcTPXBo3UaTYDCAdCQ2ySMCJJ3',
 sol:'So11111111111111111111111111111111111111112',
 token:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 ata:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
 lighthouse:'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'
};
const pk = s => new w.PublicKey(s);
const sol = n => (Number(n)/1e9).toFixed(9);
const associated = mint => w.PublicKey.findProgramAddressSync([pk(A.wallet).toBuffer(),pk(A.token).toBuffer(),pk(mint).toBuffer()],pk(A.ata))[0];
const baseATA=associated(A.mint), quoteATA=associated(A.sol);
const eventAuthority=w.PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],pk(A.program))[0];
function validateInstructions(instructions,role,amount) {
 assert.ok(['creator','partner'].includes(role),'Unknown claim role');
 assert.equal(instructions.length,4,'Unexpected claim instruction count');
 const [base,quote,claim,close]=instructions;
 for(const [ix,mint,ata] of [[base,A.mint,baseATA],[quote,A.sol,quoteATA]]) {
  assert.equal(ix.programId.toString(),A.ata);
  assert.equal(ix.data.toString('hex'),'01');
  assert.deepEqual(ix.keys.map(k=>k.pubkey.toString()),[A.wallet,ata.toString(),A.wallet,mint,w.SystemProgram.programId.toString(),A.token]);
 }
 const name=role==='creator'?'claim_creator_trading_fee':'claim_trading_fee';
 const data=Buffer.alloc(24);crypto.createHash('sha256').update('global:'+name).digest().copy(data,0,0,8);
 data.writeBigUInt64LE(BigInt(amount),16);
 assert.equal(claim.programId.toString(),A.program);
 assert.ok(claim.data.equals(data),'Unexpected fee claim or amount');
 const accounts=[A.authority,...(role==='partner'?[A.config]:[]),A.pool,baseATA.toString(),quoteATA.toString(),A.baseVault,A.quoteVault,A.mint,A.sol,A.wallet,A.token,A.token,eventAuthority.toString(),A.program];
 assert.deepEqual(claim.keys.map(k=>k.pubkey.toString()),accounts,'Unexpected claim account');
 assert.equal(close.programId.toString(),A.token);assert.equal(close.data.toString('hex'),'09');
 assert.deepEqual(close.keys.map(k=>k.pubkey.toString()),[quoteATA.toString(),A.wallet,A.wallet],'Wrong SOL recipient');
 for(const ix of instructions) for(const key of ix.keys) if(key.isSigner) assert.equal(key.pubkey.toString(),A.wallet,'Unexpected signer');
}
function messageDifference(beforeBytes,afterMessage) {
 try {
  const before=w.VersionedMessage.deserialize(beforeBytes);
  const a=w.TransactionMessage.decompile(before),b=w.TransactionMessage.decompile(afterMessage);
  const changes=[];
  if(before.version!==afterMessage.version)changes.push('transaction format changed');
  if(a.recentBlockhash!==b.recentBlockhash)changes.push('blockhash changed');
  if(!a.payerKey.equals(b.payerKey))changes.push('payer changed');
  const item=ix=>JSON.stringify({program:ix.programId.toString(),data:ix.data.toString('hex'),keys:ix.keys.map(k=>[k.pubkey.toString(),k.isSigner,k.isWritable])});
  if(a.instructions.length!==b.instructions.length)changes.push('instruction count '+a.instructions.length+' -> '+b.instructions.length);
  for(let i=0;i<Math.max(a.instructions.length,b.instructions.length);i++){
   const x=a.instructions[i],y=b.instructions[i];
   if(!x||!y||item(x)!==item(y))changes.push('instruction '+i+': '+(x?x.programId.toString()+' data='+x.data.toString('hex'):'none')+' -> '+(y?y.programId.toString()+' data='+y.data.toString('hex'):'none'));
  }
  return changes.join('; ')||'account encoding changed';
 }catch{return 'message could not be compared';}
}
function computeInstructions() {
 // Fix both settings before preview so wallets need not add a priority fee.
 // 200,000 CU * 10,000 micro-lamports = 2,000 lamports (0.000002 SOL).
 return [w.ComputeBudgetProgram.setComputeUnitLimit({units:200000}),w.ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000})];
}
function validateMessage(message,pending) {
 const original=w.VersionedMessage.deserialize(pending.message);
 assert.equal(message.version,0,'Unexpected transaction format');
 assert.equal(original.version,0);
 assert.equal(message.addressTableLookups.length,0,'Lookup tables are not permitted');
 assert.equal(message.recentBlockhash,original.recentBlockhash,'Preview expired or blockhash changed. Preview again.');
 const before=w.TransactionMessage.decompile(original),after=w.TransactionMessage.decompile(message);
 assert.equal(after.payerKey.toString(),A.wallet,'Unexpected payer');
 const entry=ix=>({program:ix.programId.toString(),data:ix.data.toString('hex'),keys:ix.keys.map(k=>[k.pubkey.toString(),k.isSigner,k.isWritable])});
 assert.ok(after.instructions.length>=before.instructions.length&&after.instructions.length<=before.instructions.length+2,'Unexpected added instructions');
 for(let i=0;i<before.instructions.length;i++)assert.deepEqual(entry(after.instructions[i]),entry(before.instructions[i]),'Reviewed claim instruction changed: '+i);
 // Preserve all original account privileges; the sole optional new key is the
 // read-only Lighthouse program. No added signer, recipient, or writable key.
 const known=new Map(original.staticAccountKeys.map((key,i)=>[key.toString(),{signer:original.isAccountSigner(i),writable:original.isAccountWritable(i)}]));
 const seen=new Set();
 message.staticAccountKeys.forEach((key,i)=>{
  const id=key.toString();assert.ok(!seen.has(id),'Duplicate account key');seen.add(id);
  const expected=known.get(id)||{signer:false,writable:false};
  assert.ok(known.has(id)||id===A.lighthouse,'Unexpected extra account');
  assert.equal(message.isAccountSigner(i),expected.signer,'Account signer changed');
  assert.equal(message.isAccountWritable(i),expected.writable,'Account permissions changed');
 });
 for(const id of known.keys())assert.ok(seen.has(id),'Original account missing');
 const tags=new Set();
 for(const ix of after.instructions.slice(before.instructions.length)) {
  assert.equal(ix.programId.toString(),A.lighthouse,'Unrecognized appended program');
  assert.equal(ix.keys.length,1,'Unexpected Lighthouse account count');
  assert.ok(ix.data.length>=3&&ix.data.length<=512,'Invalid Lighthouse data');
  const tag=ix.data[0];assert.ok([6,10].includes(tag)&&!tags.has(tag),'Only account-info and token-account assertions are permitted');tags.add(tag);
  // Lighthouse enum 6 = AssertAccountInfoMulti; 10 = AssertTokenAccountMulti.
  // Source: Jac0xb/lighthouse programs/lighthouse/src/instruction.rs and the
  // assert_target_account/assert_token_account processors: evaluation only, no CPI.
  assert.equal(ix.keys[0].pubkey.toString(),tag===6?A.wallet:baseATA.toString(),'Unexpected assertion target');
 }
 assert.equal(message.header.numRequiredSignatures,1);
}
function validateSigned(tx,pending) {
 validateMessage(tx.message,pending);
 assert.equal(tx.message.header.numRequiredSignatures,1);
 assert.equal(tx.message.staticAccountKeys[0].toString(),A.wallet);
 assert.equal(tx.signatures.length,1);
 const publicKey=crypto.createPublicKey({format:'der',type:'spki',key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pk(A.wallet).toBuffer()])});
 assert.ok(crypto.verify(null,Buffer.from(tx.message.serialize()),publicKey,Buffer.from(tx.signatures[0])),'Invalid Phantom signature');
}
function base58(bytes) {
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';
 while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b)break;s='1'+s;}return s;
}
async function engine() {
 const connection=new w.Connection(process.env.ZEVON_RPC_URL||'https://api.mainnet-beta.solana.com','confirmed');
 const client=new sdk.DynamicBondingCurveClient(connection,'confirmed');
 const program=client.state.getProgram();assert.equal(program.programId.toString(),A.program);
 let pending=null;
 const folder=path.join(__dirname,'.zevon-fee-receipts');
 async function status() {
  const raw=await client.state.getPool(pk(A.pool));const p=raw.poolState||raw;
  const config=await client.state.getPoolConfig(p.config);
  for(const [key,value] of Object.entries({creator:A.wallet,config:A.config,baseMint:A.mint,baseVault:A.baseVault,quoteVault:A.quoteVault}))assert.equal(p[key].toString(),value,'Pool identity changed: '+key);
  assert.equal(config.feeClaimer.toString(),A.wallet,'Partner authority changed');assert.equal(config.quoteMint.toString(),A.sol);
  assert.equal(config.tokenType,0);assert.equal(config.quoteTokenFlag,0);
  const balance=await connection.getBalance(pk(A.wallet),'confirmed');
  return {p,view:{wallet:A.wallet,pool:A.pool,creator:sol(p.creatorQuoteFee),partner:sol(p.partnerQuoteFee),total:sol(BigInt(p.creatorQuoteFee.toString())+BigInt(p.partnerQuoteFee.toString())),balance:sol(balance),checkedAt:new Date().toISOString()}};
 }
 async function simulate(tx,verifySignature=false) {
  const result=await connection.simulateTransaction(tx,{sigVerify:verifySignature,commitment:'confirmed',accounts:{encoding:'base64',addresses:[A.wallet]}});
  if(result.value.err){const logs=(result.value.logs||[]).join('\n');throw Error(/insufficient lamports|insufficient funds/i.test(logs)?'Not enough SOL for account creation. Add 0.005 SOL to your own 47jK…8Pto wallet, then refresh.': 'Claim simulation failed: '+JSON.stringify(result.value.err));}
  const before=await connection.getBalance(pk(A.wallet),'confirmed');
  assert.ok(result.value.accounts?.[0]?.lamports>before,'Simulation did not show a net SOL receipt');
  return result;
 }
 async function reconcile() {
  if(!fs.existsSync(folder))return;
  for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json'))) {
   const file=path.join(folder,name),r=JSON.parse(fs.readFileSync(file,'utf8'));
   if(r.status==='confirmed'||r.status==='failed')continue;
   const found=(await connection.getSignatureStatuses([r.signature],{searchTransactionHistory:true})).value[0];
   if(found?.err)r.status='failed';else if(found&&['confirmed','finalized'].includes(found.confirmationStatus))r.status='confirmed';
   else throw Error('A previous claim may still be pending. Check this signature before retrying: '+r.signature);
   fs.writeFileSync(file,JSON.stringify(r,null,2),{mode:0o600});
  }
 }
 async function prepare(role) {
  assert.ok(['creator','partner'].includes(role),'Unknown claim role');await reconcile();
  const {p}=await status();const amount=p[role+'QuoteFee'];assert.ok(!amount.isZero(),'No unclaimed fees for this role');
  const wrapped=await connection.getAccountInfo(quoteATA);
  if(wrapped){assert.equal(wrapped.owner.toString(),A.token);assert.equal(wrapped.data.readBigUInt64LE(64),0n,'Existing wrapped SOL balance: unwrap it in Phantom before using this screen');}
  const params={pool:pk(A.pool),payer:pk(A.wallet),maxBaseAmount:new amount.constructor(0),maxQuoteAmount:amount};
  const tx=role==='creator'?await client.creator.claimCreatorTradingFee({...params,creator:pk(A.wallet)}):await client.partner.claimPartnerTradingFee({...params,feeClaimer:pk(A.wallet)});
  validateInstructions(tx.instructions,role,amount.toString());
  const latest=await connection.getLatestBlockhash('confirmed');
  const message=new w.TransactionMessage({payerKey:pk(A.wallet),recentBlockhash:latest.blockhash,instructions:[...computeInstructions(),...tx.instructions]}).compileToV0Message();
  assert.equal(message.header.numRequiredSignatures,1);assert.equal(message.staticAccountKeys[0].toString(),A.wallet);
  const unsigned=new w.VersionedTransaction(message);assert.ok(unsigned.serialize().length<=1232);
  const fee=(await connection.getFeeForMessage(message,'confirmed')).value;assert.ok(fee!==null&&fee<=100000,'Network fee unavailable or exceeds 0.0001 SOL');
  await simulate(unsigned);
  pending={message:Buffer.from(message.serialize()),latest,role,amount:amount.toString(),submitted:false};
  return {transaction:Buffer.from(unsigned.serialize()).toString('base64'),amount:sol(amount),role,networkFee:sol(fee),wallet:A.wallet};
 }
 async function submit(encoded) {
  assert.ok(pending&&!pending.submitted,'Prepare a fresh claim first');
  const bytes=Buffer.from(encoded,'base64');assert.ok(bytes.length<=1232);
  const tx=w.VersionedTransaction.deserialize(bytes);validateSigned(tx,pending);
  assert.ok((await connection.isBlockhashValid(pending.latest.blockhash,'confirmed')).value,'Preview expired. Refresh and prepare again.');
  const finalFee=(await connection.getFeeForMessage(tx.message,'confirmed')).value;
  assert.ok(finalFee!==null&&finalFee<=100000,'Final network fee exceeds 0.0001 SOL or is unavailable');
  await simulate(tx,true);
  const signature=base58(tx.signatures[0]);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(folder,signature+'.json'),JSON.stringify({signature,role:pending.role,amount:pending.amount,status:'submission-attempted',message:Buffer.from(tx.message.serialize()).toString('base64'),...pending.latest},null,2),{flag:'wx',mode:0o600});
  pending.submitted=true;pending.signature=signature;
  try {const sent=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3});assert.equal(sent,signature);}catch(e){return {signature,notice:'Submission outcome uncertain. Check this signature; do not repeat the claim. '+e.message};}
  return {signature};
 }
 async function verify(signature) {
  assert.match(signature,/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  const file=path.join(folder,signature+'.json');const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
  const tx=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  if(!tx)return {confirmed:false,signature};
  assert.ok(Buffer.from(tx.transaction.message.serialize()).equals(Buffer.from(receipt.message,'base64')),'Confirmed message mismatch');
  receipt.status=tx.meta?.err?'failed':'confirmed';fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});
  assert.ok(tx.meta&&tx.meta.err===null,'Claim failed on-chain');
  return {confirmed:true,signature,receivedSOL:sol(tx.meta.postBalances[0]-tx.meta.preBalances[0])};
 }
 return {status,prepare,submit,verify};
}
function html(token,nonce) {return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZEVON fee claims</title><style nonce="${nonce}">body{background:#101322;color:#eef0ff;font:17px system-ui;max-width:780px;margin:40px auto;padding:20px}section{padding:24px;background:#1b2035;border-radius:18px;margin:20px 0}button{padding:13px 18px;border:0;border-radius:10px;background:#9d91ff;color:#101322;font-weight:700;margin:6px;cursor:pointer}button:disabled{opacity:.45}pre,p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}a{color:#79d6ff}</style></head><body><h1>ZEVON fee claims</h1><p>Claim accrued SOL fees to your original Phantom wallet.</p><section><p>Receiving wallet: ${A.wallet}</p><button id="refresh">Refresh fees</button><pre id="balances">Loading…</pre></section><section><button id="creator">Preview creator claim</button><button id="partner">Preview partner claim</button><p id="preview">Preview a claim first. Each claim needs your approval in Phantom.</p><button id="approve" disabled>Approve this claim in Phantom</button><p id="result" aria-live="polite"></p><a id="explorer" hidden target="_blank" rel="noopener noreferrer">View transaction on Solscan</a><button id="check" hidden>Check confirmation</button></section><p>Account creation may require roughly 0.004 SOL upfront. Temporary wrapped-SOL account rent is returned when the claim unwraps to SOL. Any newly created ZEVON token account retains its rent deposit.</p><script nonce="${nonce}" src="/web3.js"></script><script nonce="${nonce}">
const api=async(route,payload={})=>{const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Zevon-Session':${JSON.stringify(token)}},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
const el=id=>document.getElementById(id);let prepared=null,signature=localStorage.getItem('zevon-fee-last-signature');let busy=false;
function controls(disabled){for(const id of ['refresh','creator','partner','approve','check'])el(id).disabled=disabled;el('approve').disabled=disabled||!prepared;}
async function run(fn){if(busy)return;busy=true;controls(true);try{await fn();}catch(e){el('result').textContent=e.message;}finally{busy=false;controls(false);}}
async function refresh(){const s=await api('/status');el('balances').textContent='Creator fees: '+s.creator+' SOL\\nPartner fees: '+s.partner+' SOL\\nTotal: '+s.total+' SOL\\nWallet balance: '+s.balance+' SOL';}
function showSignature(){if(!signature)return;el('explorer').hidden=false;el('explorer').href='https://solscan.io/tx/'+signature;el('check').hidden=false;}
el('refresh').onclick=()=>run(refresh);
for(const role of ['creator','partner'])el(role).onclick=()=>run(async()=>{prepared=null;el('result').textContent='Checking accounts and simulating…';prepared=await api('/prepare',{role});el('preview').textContent='Claim '+prepared.amount+' SOL in '+role+' fees to '+prepared.wallet+'. Network fee: '+prepared.networkFee+' SOL. Simulation passed.';el('result').textContent='Ready for your review and Phantom approval.';});
el('approve').onclick=()=>run(async()=>{const p=prepared;prepared=null;if(!p)throw Error('Preview a claim first.');const provider=window.phantom&&window.phantom.solana;if(!provider?.isPhantom)throw Error('Open in a browser with Phantom installed, or inside Phantom’s browser.');const account=await provider.connect();if(account.publicKey.toString()!==p.wallet)throw Error('Select the original ZEVON wallet ending 8Pto.');const tx=solanaWeb3.VersionedTransaction.deserialize(Uint8Array.from(atob(p.transaction),c=>c.charCodeAt(0)));if(tx.message.staticAccountKeys[0].toString()!==p.wallet)throw Error('Unexpected payer.');el('result').textContent='Review the fee claim in Phantom.';const signed=await provider.signTransaction(tx);let binary='';for(const b of signed.serialize())binary+=String.fromCharCode(b);el('result').textContent='Validating and submitting your approved claim…';const sent=await api('/submit',{transaction:btoa(binary)});signature=sent.signature;localStorage.setItem('zevon-fee-last-signature',signature);showSignature();el('result').textContent=sent.notice||'Submitted. Use Check confirmation before making another claim.';});
el('check').onclick=()=>run(async()=>{const r=await api('/verify',{signature});el('result').textContent=r.confirmed?'Confirmed. Net wallet increase: '+r.receivedSOL+' SOL. Refresh fees to see the remaining balance.':'Still waiting for confirmation. Check again shortly; do not repeat this claim.';if(r.confirmed)await refresh();});
showSignature();run(refresh);
</script></body></html>`;}
async function main() {
 const app=await engine();
 if(process.argv.includes('--check')){console.log(JSON.stringify((await app.status()).view,null,2));return;}
 if(process.argv.includes('--simulate')){for(const role of ['creator','partner']){try{const p=await app.prepare(role);console.log(JSON.stringify({role,amount:p.amount,simulation:'PASS'}));}catch(e){console.log(JSON.stringify({role,simulation:'BLOCKED',reason:e.message}));process.exitCode=1;}}return;}
 const token=crypto.randomBytes(32).toString('hex'),nonce=crypto.randomBytes(16).toString('base64');
 const browserFile=path.join(path.dirname(require.resolve('@solana/web3.js')),'index.iife.min.js');
 const browserJS=fs.readFileSync(browserFile);let busy=false;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  const reply=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(token,nonce));return;}
  if(req.method==='GET'&&req.url==='/web3.js'){res.setHeader('Content-Type','application/javascript');res.end(browserJS);return;}
  if(req.method!=='POST'||req.headers['x-zevon-session']!==token){reply(403,{error:'Invalid session'});return;}
  if(busy){reply(409,{error:'Another operation is running'});return;}busy=true;
  try {let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw Error('Request too large');}const p=JSON.parse(body);
   if(req.url==='/status')reply(200,(await app.status()).view);
   else if(req.url==='/prepare')reply(200,await app.prepare(p.role));
   else if(req.url==='/submit'){assert.equal(typeof p.transaction,'string');reply(200,await app.submit(p.transaction));}
   else if(req.url==='/verify')reply(200,await app.verify(p.signature));
   else reply(404,{error:'Not found'});
  }catch(e){reply(400,{error:e.message});}finally{busy=false;}
 });
 server.listen(3001,'0.0.0.0',()=>console.log('ZEVON fee claims ready on port 3001. Keep the Codespaces port Private. Open it in your browser. Each claim requires Phantom approval.'));
}
module.exports={A,validateInstructions,validateSigned,validateMessage,messageDifference,computeInstructions,base58,html};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
