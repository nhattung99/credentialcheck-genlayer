import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { CredentialCard } from './CredentialCard.jsx';
import {
  hasContractAddress,
  readCredential,
  readCredentialIds,
  getReadClient,
} from '../genlayerClient.js';
import { isEthAddress, parseRoute } from '../format.js';

export function LookupPanel() {
  const initial = useMemo(() => parseRoute(window.location.hash), []);
  const [mode, setMode] = useState(initial.address ? 'address' : 'id');
  const [query, setQuery] = useState(initial.address || initial.id || '');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!hasContractAddress) return undefined;
    if (initial.id || initial.address) {
      runSearch(initial.address ? 'address' : 'id', initial.address || initial.id);
    }
    return undefined;
    // Search once from the incoming link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async (nextMode = mode, nextQuery = query) => {
    const value = String(nextQuery || '').trim();
    setSearched(true);
    setMessage('');
    setRecords([]);
    if (!hasContractAddress) {
      setMessage('Chưa có địa chỉ contract. Tra cứu sẽ mở khi contract được deploy trên studionet và gán VITE_CONTRACT_ADDRESS.');
      return;
    }
    if (!value) {
      setMessage(nextMode === 'id' ? 'Nhập credential id.' : 'Nhập địa chỉ ví người nộp.');
      return;
    }
    if (nextMode === 'address' && !isEthAddress(value)) {
      setMessage('Địa chỉ ví cần đúng dạng 0x và 40 ký tự hex.');
      return;
    }
    if (nextMode === 'id' && !/^\d+$/.test(value)) {
      setMessage('Credential id là số, ví dụ 0, 1, 2.');
      return;
    }

    setLoading(true);
    try {
      const client = getReadClient();
      if (!client) throw new Error('Không kết nối được studionet để đọc dữ liệu công khai.');
      if (nextMode === 'id') {
        const row = await readCredential(client, value);
        setRecords(row ? [{ ...row, id: value }] : []);
        if (!row) setMessage('Không đọc được credential này.');
      } else {
        const ids = await readCredentialIds(client, value);
        const rows = [];
        for (const id of ids) {
          try {
            const row = await readCredential(client, id);
            if (row) rows.push({ ...row, id });
          } catch (err) {
            console.warn(`lookup ${id} failed:`, err);
          }
        }
        setRecords(rows);
        if (!rows.length) setMessage('Ví này chưa có credential nào trên registry.');
      }
      const params = new URLSearchParams();
      if (nextMode === 'id') params.set('id', value);
      else params.set('address', value);
      window.history.replaceState(null, '', `#lookup?${params.toString()}`);
    } catch (err) {
      console.warn('lookup failed:', err);
      setMessage(err?.message || 'Không tra cứu được. Thử lại sau ít phút.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-copy">
        <p className="eyebrow">Tra cứu công khai</p>
        <h2>Nhà tuyển dụng xem kết quả, không cần ví</h2>
        <p>
          Nhập <strong>credential id</strong> hoặc <strong>địa chỉ ví người nộp</strong>.
          Kết quả VERIFIED, UNVERIFIED và DISPUTED nằm trên studionet, ai cũng đọc lại được.
        </p>
      </div>

      <form
        className="search-card"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className="segmented" role="tablist" aria-label="Cách tra cứu">
          <button
            type="button"
            className={mode === 'id' ? 'on' : ''}
            onClick={() => {
              setMode('id');
              setQuery('');
              setMessage('');
              setRecords([]);
            }}
          >
            Credential id
          </button>
          <button
            type="button"
            className={mode === 'address' ? 'on' : ''}
            onClick={() => {
              setMode('address');
              setQuery('');
              setMessage('');
              setRecords([]);
            }}
          >
            Địa chỉ ví
          </button>
        </div>
        <label className="field">
          <span>{mode === 'id' ? 'Credential id' : 'Ví người nộp'}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === 'id' ? '0' : '0x…'}
            spellCheck="false"
            autoComplete="off"
          />
        </label>
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
          Tra cứu
        </button>
      </form>

      {message && <p className="notice" role="status">{message}</p>}
      {!searched && !message && (
        <p className="quiet">Ví dụ: id <code>0</code> sau lần nộp đầu tiên, hoặc ví đã gọi submit_credential.</p>
      )}
      <div className="record-list">
        {records.map((row) => (
          <CredentialCard key={`${row.id}-${row.status}`} credential={row} />
        ))}
      </div>
    </section>
  );
}

export function UrlFields({ label, hint, values, onChange, minCount }) {
  const update = (index, value) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };

  const paste = async (index) => {
    try {
      const text = await navigator.clipboard.readText();
      update(index, String(text || '').trim());
    } catch (err) {
      console.warn('clipboard read failed:', err);
      window.alert('Trình duyệt chặn clipboard. Hãy dán bằng Ctrl+V vào ô.');
    }
  };

  return (
    <fieldset className="url-set">
      <legend>{label}</legend>
      <p className="field-hint">{hint}</p>
      {values.map((value, index) => (
        <div className="url-row" key={`${label}-${index}`}>
          <input
            value={value}
            onChange={(event) => update(index, event.target.value)}
            placeholder="https://"
            inputMode="url"
            spellCheck="false"
            aria-label={`${label} ${index + 1}`}
          />
          <button type="button" className="icon-btn" onClick={() => paste(index)} title="Dán từ clipboard">
            <ClipboardPaste size={16} />
          </button>
          {values.length > minCount && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onChange(values.filter((_, item) => item !== index))}
              title="Xóa link"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="text-btn" onClick={() => onChange([...values, ''])}>
        <Plus size={14} /> Thêm link
      </button>
    </fieldset>
  );
}
