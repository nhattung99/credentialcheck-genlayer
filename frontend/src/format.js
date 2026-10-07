export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isEthAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || '').trim());
}

export function sameAddress(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function shortAddress(value) {
  const text = String(value || '');
  if (!isEthAddress(text)) return text || '—';
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function cleanUrls(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value || '').trim());
}

export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart === 'submit' ? 'submit' : 'lookup';
  const params = new URLSearchParams(queryPart || '');
  return {
    path,
    id: params.get('id') || '',
    address: params.get('address') || '',
  };
}

export function asNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function unwrapViewResult(res) {
  if (res === null || res === undefined) return res;
  if (typeof res === 'bigint') return Number(res);
  if (typeof res === 'number' || typeof res === 'boolean') return res;
  if (res instanceof Uint8Array) {
    return unwrapViewResult(new TextDecoder().decode(res));
  }
  if (res instanceof Map) {
    return unwrapViewResult(Object.fromEntries(res));
  }
  if (typeof res === 'object') {
    if (Array.isArray(res)) return res.map((item) => unwrapViewResult(item));
    if ('result' in res) return unwrapViewResult(res.result);
    if ('data' in res && (typeof res.data === 'string' || Array.isArray(res.data))) {
      return unwrapViewResult(res.data);
    }
    return res;
  }
  if (typeof res !== 'string') return res;

  const trimmed = res.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 4 && trimmed.length % 2 === 0) {
    try {
      const hex = trimmed.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      const text = new TextDecoder().decode(bytes).trim();
      if (text.startsWith('[') || text.startsWith('{') || /^\d+$/.test(text)) {
        return unwrapViewResult(text);
      }
    } catch {
      // keep the original string
    }
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return unwrapViewResult(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function normalizeIdList(raw) {
  const unwrapped = unwrapViewResult(raw);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map((item) => String(unwrapViewResult(item))).filter((item) => item !== '');
  }
  if (unwrapped && typeof unwrapped === 'object') {
    const nested = unwrapped.ids || unwrapped.credential_ids || unwrapped.result;
    if (nested) return normalizeIdList(nested);
  }
  if (unwrapped === null || unwrapped === undefined || unwrapped === '') return [];
  return [String(unwrapped)];
}

export function normalizeCredential(raw, fallbackId) {
  const row = unwrapViewResult(raw);
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = row.credential_id ?? row.id ?? fallbackId;
  return {
    id: id === null || id === undefined ? '' : String(id),
    submitter: String(row.submitter || ''),
    credentialType: String(row.credential_type || ''),
    institution: String(row.issuing_institution || ''),
    details: String(row.claim_details || ''),
    profileUrls: Array.isArray(row.profile_reference_urls) ? row.profile_reference_urls.map(String) : [],
    verificationUrls: Array.isArray(row.verification_source_urls) ? row.verification_source_urls.map(String) : [],
    status: String(row.status || ''),
    verdict: String(row.verdict || ''),
    reason: String(row.verdict_reason || ''),
    confidence: asNumber(row.confidence),
  };
}

export function statusMeta(status) {
  if (status === 'VERIFIED') {
    return { label: 'VERIFIED', tone: 'ok', hint: 'Nguồn độc lập xác nhận bằng cấp / chứng chỉ.' };
  }
  if (status === 'UNVERIFIED') {
    return { label: 'UNVERIFIED', tone: 'bad', hint: 'Không xác nhận được, hoặc nguồn độc lập mâu thuẫn với khai báo.' };
  }
  if (status === 'DISPUTED') {
    return { label: 'DISPUTED', tone: 'warn', hint: 'Độ tin cậy dưới 60. Người nộp có thể bổ sung nguồn rồi xác minh lại.' };
  }
  if (status === 'SUBMITTED') {
    return { label: 'SUBMITTED', tone: 'pending', hint: 'Đã ghi nhận, chưa có phán quyết.' };
  }
  return { label: status || 'UNKNOWN', tone: 'pending', hint: '' };
}
