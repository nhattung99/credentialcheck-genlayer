import { createClient, chains } from 'genlayer-js';
import { TransactionHashVariant, TransactionStatus } from 'genlayer-js/types';
import {
  ZERO_ADDRESS,
  isEthAddress,
  normalizeCredential,
  normalizeIdList,
  unwrapViewResult,
} from './format.js';

const rawAddress = (import.meta.env.VITE_CONTRACT_ADDRESS || '').trim();

export const CONTRACT_ADDRESS = rawAddress || ZERO_ADDRESS;
export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com';
export const STUDIO_RPC = 'https://studio.genlayer.com/api';
export const VIEW_FROM = '0x0000000000000000000000000000000000000001';

export const hasContractAddress = Boolean(
  rawAddress &&
  rawAddress !== ZERO_ADDRESS &&
  isEthAddress(rawAddress)
);

export const studionet = chains.studionet;
const LATEST_VISIBLE = TransactionHashVariant.LATEST_NONFINAL;

export function studioRpcUrl(origin) {
  if (!origin || typeof origin !== 'string') return STUDIO_RPC;
  return `${origin.replace(/\/$/, '')}/api/genlayer`;
}

export function formatWalletError(err, fallback = 'Yêu cầu ví thất bại') {
  const raw = `${err?.shortMessage || ''} ${err?.details || ''} ${err?.message || ''}`.toLowerCase();
  if (raw.includes('user rejected') || raw.includes('user denied') || raw.includes('user cancel')) {
    return 'MetaMask đã hủy yêu cầu. Chuyển sang Genlayer Studio Network rồi bấm Confirm.';
  }
  if (raw.includes('no address provided') || raw.includes('no account')) {
    return 'Hãy kết nối ví trước, rồi thử lại.';
  }
  if (raw.includes('unrecognized chain') || raw.includes('chain disconnected') || raw.includes('4902')) {
    return 'Hãy chấp nhận thêm Genlayer Studio Network trong MetaMask, rồi gửi lại giao dịch.';
  }
  return err?.shortMessage || err?.message || fallback;
}

export function txExplorerUrl(hash) {
  if (!hash) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function addressExplorerUrl(addr) {
  if (!addr) return EXPLORER_BASE;
  return `${EXPLORER_BASE}/address/${addr}`;
}

function resolveReadAccount(account) {
  if (typeof account === 'string' && isEthAddress(account)) return { address: account };
  if (account && typeof account === 'object' && typeof account.address === 'string') {
    return { address: account.address };
  }
  return { address: VIEW_FROM };
}

function studioChain() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    ...studionet,
    rpcUrls: {
      default: {
        http: [studioRpcUrl(origin)],
      },
    },
  };
}

function makeClient(extra = {}) {
  return createClient({
    chain: studioChain(),
    ...extra,
  });
}

export function getReadClient() {
  try {
    return makeClient({
      account: resolveReadAccount(null).address,
    });
  } catch (err) {
    console.warn('Read client init failed:', err);
    return null;
  }
}

export function getWriteClient(account) {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Cần MetaMask để ký giao dịch CredentialCheck.');
  }
  return makeClient({
    account: resolveReadAccount(account).address,
    provider: window.ethereum,
  });
}

export async function ensureStudioNetwork() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Cần MetaMask để ký giao dịch CredentialCheck.');
  }
  const chainIdHex = `0x${studionet.id.toString(16)}`;
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === chainIdHex.toLowerCase()) return;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (err) {
    const missing = err?.code === 4902 || String(err?.message || '').toLowerCase().includes('unrecognized chain');
    if (!missing) throw err;
  }

  await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: chainIdHex,
      chainName: studionet.name || 'Genlayer Studio Network',
      nativeCurrency: studionet.nativeCurrency || { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
      rpcUrls: [studioRpcUrl(window.location.origin)],
      blockExplorerUrls: studionet.blockExplorers?.default?.url
        ? [studionet.blockExplorers.default.url]
        : [EXPLORER_BASE],
    }],
  });
}

export async function readView(client, functionName, args = [], fromAddress) {
  if (!client) throw new Error('Không tạo được kết nối đọc studionet');
  const res = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    account: resolveReadAccount(fromAddress || client.account),
    transactionHashVariant: LATEST_VISIBLE,
  });
  return unwrapViewResult(res);
}

export async function readCredential(client, credentialId) {
  const raw = await readView(client, 'get_credential', [String(credentialId)]);
  return normalizeCredential(raw, String(credentialId));
}

export async function readCredentialIds(client, submitter) {
  const raw = await readView(client, 'get_credentials_by_submitter', [submitter]);
  return normalizeIdList(raw);
}

export async function readCredentialCount(client, fromAddress) {
  const raw = unwrapViewResult(await readView(client, 'get_credential_count', [], fromAddress));
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

export async function waitForTx(client, hash, { retries = 40, interval = 2000, status = TransactionStatus.ACCEPTED } = {}) {
  if (!hash) return null;
  if (client && typeof client.waitForTransactionReceipt === 'function') {
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status,
        retries,
        interval,
      });
    } catch (err) {
      console.warn('wait ACCEPTED note:', err);
    }
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        retries: 40,
        interval,
      });
    } catch (err) {
      console.warn('wait FINALIZED note:', err);
    }
  }
  return hash;
}

function pickExecResult(receipt) {
  if (!receipt || typeof receipt !== 'object') return '';
  const raw =
    receipt.executionResult ??
    receipt.execution_result ??
    receipt.txExecutionResultName ??
    receipt.genvmResult ??
    receipt.genvm_result ??
    receipt.result ??
    receipt.status;
  return String(raw || '').toLowerCase();
}

export function receiptLooksFailed(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  const exec = pickExecResult(receipt);
  if (
    exec.includes('error') ||
    exec.includes('fail') ||
    exec.includes('revert') ||
    exec.includes('rollback')
  ) {
    return true;
  }
  const nested = receipt.genvm || receipt.execution || receipt.receipt;
  if (nested && nested !== receipt) return receiptLooksFailed(nested);
  return false;
}

export async function findOwnedCredential(client, account, beforeCount) {
  const start = Number.isFinite(beforeCount) ? beforeCount : 0;
  let end = start;
  try {
    const count = await readCredentialCount(client, account);
    if (typeof count === 'number') end = count;
  } catch (err) {
    console.warn('get_credential_count failed:', err);
  }
  for (let i = end - 1; i >= start; i -= 1) {
    try {
      const row = await readCredential(client, String(i));
      if (row && String(row.submitter).toLowerCase() === String(account).toLowerCase()) {
        return row;
      }
    } catch (err) {
      console.warn(`get_credential(${i}) failed:`, err);
    }
  }
  return null;
}

export async function pollCredential(client, credentialId, { attempts = 24, intervalMs = 4000, until } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      last = await readCredential(client, credentialId);
      if (!until || until(last)) return last;
    } catch (err) {
      console.warn('poll credential failed:', err);
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return last;
}
