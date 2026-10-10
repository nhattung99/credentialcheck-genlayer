import React from 'react';
import { ExternalLink } from 'lucide-react';
import { statusMeta } from '../format.js';

export function CredentialCard({ credential }) {
  if (!credential) return null;
  const meta = statusMeta(credential.status);
  return (
    <article className={`record tone-${meta.tone}`}>
      <header className="record-head">
        <div>
          <p className="eyebrow">Credential #{credential.id || '—'}</p>
          <h3>{credential.credentialType || 'Credential'}</h3>
          <p className="institution">{credential.institution}</p>
          {credential.holderName && <p className="institution">Holder: {credential.holderName}</p>}
        </div>
        <span className={`badge tone-${meta.tone}`}>{meta.label}</span>
      </header>
      {credential.details && <p className="details">{credential.details}</p>}
      {meta.hint && <p className="hint">{meta.hint}</p>}
      {(credential.verdict || credential.reason || credential.confidence !== null) && (
        <dl className="verdict-grid">
          <div>
            <dt>Verdict</dt>
            <dd>{credential.verdict || '—'}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{credential.confidence === null ? '—' : `${credential.confidence}/100`}</dd>
          </div>
          <div className="span-2">
            <dt>Reason</dt>
            <dd>{credential.reason || '—'}</dd>
          </div>
        </dl>
      )}
      <div className="link-columns">
        <UrlGroup title="Profile" urls={credential.profileUrls} />
        <UrlGroup title="Pinned official sources" urls={credential.verificationUrls} />
      </div>
      {credential.submitter && (
        <p className="submitter">Submitted by <code>{credential.submitter}</code></p>
      )}
    </article>
  );
}

function UrlGroup({ title, urls }) {
  const list = Array.isArray(urls) ? urls : [];
  return (
    <div>
      <h4>{title}</h4>
      {list.length === 0 && <p className="empty-inline">No links yet.</p>}
      <ul>
        {list.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {url} <ExternalLink size={12} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
