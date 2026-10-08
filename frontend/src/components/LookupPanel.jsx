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
      setMessage('No contract address yet. Lookup opens after the contract is deployed on studionet and VITE_CONTRACT_ADDRESS is set.');
      return;
    }
    if (!value) {
      setMessage(nextMode === 'id' ? 'Enter a credential id.' : 'Enter the submitter wallet address.');
      return;
    }
    if (nextMode === 'address' && !isEthAddress(value)) {
      setMessage('Wallet address must be 0x followed by 40 hex characters.');
      return;
    }
    if (nextMode === 'id' && !/^\d+$/.test(value)) {
      setMessage('Credential id is a number, for example 0, 1, or 2.');
      return;
    }

    setLoading(true);
    try {
      const client = getReadClient();
      if (!client) throw new Error('Could not connect to studionet to read public data.');
      if (nextMode === 'id') {
        const row = await readCredential(client, value);
        setRecords(row ? [{ ...row, id: value }] : []);
        if (!row) setMessage('Could not read this credential.');
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
        if (!rows.length) setMessage('This wallet has no credentials on the registry.');
      }
      const params = new URLSearchParams();
      if (nextMode === 'id') params.set('id', value);
      else params.set('address', value);
      window.history.replaceState(null, '', `#lookup?${params.toString()}`);
    } catch (err) {
      console.warn('lookup failed:', err);
      setMessage(err?.message || 'Could not look this up. Try again in a few minutes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-copy">
        <p className="eyebrow">Public lookup</p>
        <h2>Recruiters can read results without a wallet</h2>
        <p>
          Enter a <strong>credential id</strong> or the <strong>submitter wallet address</strong>.
          VERIFIED, UNVERIFIED, and DISPUTED results stay on studionet for anyone to read.
        </p>
      </div>

      <form
        className="search-card"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className="segmented" role="tablist" aria-label="How to look up">
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
            Wallet address
          </button>
        </div>
        <label className="field">
          <span>{mode === 'id' ? 'Credential id' : 'Submitter wallet'}</span>
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
          Look up
        </button>
      </form>

      {message && <p className="notice" role="status">{message}</p>}
      {!searched && !message && (
        <p className="quiet">Example: id <code>0</code> after the first submission, or a wallet that called submit_credential.</p>
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
      window.alert('The browser blocked clipboard access. Paste with Ctrl+V instead.');
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
          <button type="button" className="icon-btn" onClick={() => paste(index)} title="Paste from clipboard">
            <ClipboardPaste size={16} />
          </button>
          {values.length > minCount && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onChange(values.filter((_, item) => item !== index))}
              title="Remove link"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="text-btn" onClick={() => onChange([...values, ''])}>
        <Plus size={14} /> Add link
      </button>
    </fieldset>
  );
}
