/* Read-only on-chain reference inspection. Does not request signatures. */
const SOURCE_CONFIG = '4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis';
const DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const out = document.getElementById('chainstatus');
const inspectBtn = document.getElementById('inspect');
const downloadBtn = document.getElementById('download-config');
let latestInspection = null;
inspectBtn.addEventListener('click', async () => {
  out.textContent = 'Reading AUTON PoolConfig from Solana mainnet…';
  downloadBtn.hidden = true;
  try {
    const rpc = document.getElementById('rpc').value.trim();
    const url = new URL(rpc);
    if (url.protocol !== 'https:') throw new Error('RPC endpoint must use HTTPS');
    const request = {jsonrpc:'2.0',id:1,method:'getAccountInfo',params:[SOURCE_CONFIG,{encoding:'base64',commitment:'confirmed'}]};
    const response = await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    if(!response.ok) throw new Error('RPC HTTP '+response.status);
    const json = await response.json();
    if(json.error) throw new Error(JSON.stringify(json.error));
    const account = json.result?.value;
    if(!account) throw new Error('PoolConfig not found. Check the source account address.');
    if(account.owner!==DBC_PROGRAM) throw new Error('Unexpected account owner: '+account.owner);
    const bytes = Uint8Array.from(atob(account.data[0]),c=>c.charCodeAt(0));
    if(bytes.length!==1048) throw new Error('Unexpected config size: '+bytes.length+' bytes');
    const digest = await crypto.subtle.digest('SHA-256',bytes);
    const sha256 = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    latestInspection={referenceConfig:SOURCE_CONFIG,owner:account.owner,lamports:account.lamports,space:bytes.length,sha256,base64:account.data[0],slot:json.result.context.slot,inspectedAt:new Date().toISOString(),note:'Reference account only. Not decoded or confirmed equivalent to ZEVON launch parameters.'};
    out.textContent='Verified on-chain DBC account ('+bytes.length+' bytes). Slot: '+latestInspection.slot+'. SHA-256: '+sha256+'. Full fee and curve decoding still required.';
    downloadBtn.hidden=false;
  }catch(e){out.textContent='Could not inspect reference: '+e.message+'. This may be an RPC/CORS limitation; no transactions were attempted.';}
});
downloadBtn.addEventListener('click',()=>{
  if(!latestInspection)return;
  const blob=new Blob([JSON.stringify(latestInspection,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='auton-reference-account.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
});
