import React, { useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { CATEGORIES, CUSTOM_INSTITUTION } from '../presets.js';
import { CredentialCard } from './CredentialCard.jsx';
import { UrlFields } from './LookupPanel.jsx';
import {
  CONTRACT_ADDRESS,
  ensureStudioNetwork,
  findOwnedCredential,
  formatWalletError,
  getReadClient,
  getWriteClient,
  hasContractAddress,
  pollCredential,
  readCredentialCount,
  receiptLooksFailed,
  txExplorerUrl,
  waitForTx,
} from '../genlayerClient.js';
import { cleanUrls, isHttpUrl, sameAddress } from '../format.js';

export function SubmitPanel({ account }) {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [credentialType, setCredentialType] = useState(CATEGORIES[0].credentialType);
  const [institutionChoice, setInstitutionChoice] = useState(CATEGORIES[0].institutions[0]);
  const [customInstitution, setCustomInstitution] = useState('');
  const [details, setDetails] = useState('');
  const [profileUrls, setProfileUrls] = useState(['']);
  const [sourceUrls, setSourceUrls] = useState(['', '']);
  const [extraProfiles, setExtraProfiles] = useState(['']);
  const [extraSources, setExtraSources] = useState(['']);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [record, setRecord] = useState(null);

  const category = CATEGORIES.find((item) => item.id === categoryId) || CATEGORIES[0];
  const institutions = category.institutions;
  const institution = institutionChoice === CUSTOM_INSTITUTION ? customInstitution.trim() : institutionChoice;

  const stageLabel = useMemo(() => {
    if (stage === 'record') return 'Writing the credential to studionet…';
    if (stage === 'resolve') return 'AI is reading the profile and comparing verification sources…';
    if (stage === 'evidence') return 'Adding evidence…';
    if (stage === 'refresh') return 'Reading the result again…';
    return '';
  }, [stage]);

  const selectCategory = (next) => {
    setCategoryId(next.id);
    setCredentialType(next.credentialType);
    setInstitutionChoice(next.institutions[0] || CUSTOM_INSTITUTION);
    setDetails('');
  };

  const validateUrls = (urls, minimum, label) => {
    const cleaned = cleanUrls(urls);
    if (cleaned.length < minimum) {
      throw new Error(`${label}: at least ${minimum} link(s) required.`);
    }
    const bad = cleaned.find((url) => !isHttpUrl(url));
    if (bad) throw new Error(`Invalid link: ${bad}`);
    return cleaned;
  };

  const requireReady = () => {
    if (!hasContractAddress) {
      throw new Error('No contract address yet. Deploy on GenLayer Studio, then set VITE_CONTRACT_ADDRESS.');
    }
    if (!account) throw new Error('Connect a wallet to sign. Public lookup does not need a wallet.');
  };

  const write = async (functionName, args, { ai = false } = {}) => {
    await ensureStudioNetwork();
    const client = getWriteClient(account);
    const hash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      account: { address: account },
    });
    setTxHash(hash);
    const receipt = await waitForTx(client, hash, ai
      ? { retries: 90, interval: 5000 }
      : { retries: 40, interval: 2000 });
    if (receiptLooksFailed(receipt)) {
      throw new Error(`Transaction rolled back. See the explorer: ${txExplorerUrl(hash)}`);
    }
    return { client, hash };
  };

  const refreshRecord = async (credentialId) => {
    const reader = getReadClient();
    return pollCredential(reader, credentialId, {
      attempts: 20,
      intervalMs: 4000,
      until: (row) => row && row.status && row.status !== 'SUBMITTED',
    });
  };

    const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setTxHash('');
    try {
      const type = credentialType.trim();
      const org = institution.trim();
      const claim = details.trim();
      if (!type) throw new Error('Choose or enter a credential type.');
      if (!org) throw new Error('Enter the issuing institution.');
      if (!claim) throw new Error('Enter the claim details.');
      const profiles = validateUrls(profileUrls, 1, 'Profile');
      const sources = validateUrls(sourceUrls, 2, 'Verification sources');
      requireReady();

      setStage('record');
      const reader = getReadClient();
      const before = reader ? await readCredentialCount(reader, account) : 0;
      const { client } = await write('submit_credential', [type, org, claim, profiles, sources]);

      setStage('refresh');
      let created = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        created = await findOwnedCredential(client, account, before ?? 0);
        if (created?.id) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!created?.id) {
        throw new Error('The transaction was sent, but the credential id is not readable yet. Look up the wallet address in a few minutes.');
      }
      setRecord(created);

      setStage('resolve');
      await write('resolve_credential', [created.id], { ai: true });
      setStage('refresh');
      const settled = await refreshRecord(created.id);
      setRecord(settled || created);
      if (!settled || settled.status === 'SUBMITTED') {
        setError(`No final verdict yet. Credential #${created.id} is still SUBMITTED. Verify again once the source pages can be fetched.`);
      }
    } catch (err) {
      setError(formatWalletError(err, 'Could not submit the credential'));
    } finally {
      setStage('');
    }
  };

  const onAddEvidence = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    setError('');
    try {
      requireReady();
      if (!sameAddress(account, record.submitter)) {
        throw new Error('Only the wallet that submitted this credential can add evidence.');
      }
      const profiles = cleanUrls(extraProfiles).filter(isHttpUrl);
      const sources = cleanUrls(extraSources).filter(isHttpUrl);
      const invalid = [...cleanUrls(extraProfiles), ...cleanUrls(extraSources)].find((url) => !isHttpUrl(url));
      if (invalid) throw new Error(`Invalid link: ${invalid}`);
      if (profiles.length + sources.length < 1) {
        throw new Error('Add at least one profile or verification link.');
      }
      setStage('evidence');
      await write('add_evidence', [record.id, profiles, sources]);
      setStage('resolve');
      await write('resolve_credential', [record.id], { ai: true });
      setStage('refresh');
      const settled = await refreshRecord(record.id);
      setRecord(settled || record);
      setExtraProfiles(['']);
      setExtraSources(['']);
    } catch (err) {
      setError(formatWalletError(err, 'Could not add evidence'));
    } finally {
      setStage('');
    }
  };

  const busy = Boolean(stage);

  return (
    <section className="panel">
      <div className="panel-copy">
        <p className="eyebrow">Submit a credential</p>
        <h2>State the claim, attach at least two independent sources, and let the AI decide</h2>
        <p>
          No GEN is locked and there is no background-check fee. The wallet only signs
          {' '}<code>submit_credential</code> and <code>resolve_credential</code> on studionet.
        </p>
      </div>

      <form className="form-card" onSubmit={onSubmit}>
        <div className="chips" role="group" aria-label="Credential type">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === categoryId ? 'chip on' : 'chip'}
              onClick={() => selectCategory(item)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Degree or certificate type</span>
          <input
            value={credentialType}
            onChange={(event) => setCredentialType(event.target.value)}
            placeholder={category.credentialType || 'Degree or certificate name'}
          />
        </label>

        <label className="field">
          <span>Issuing institution</span>
          <select
            value={institutions.includes(institutionChoice) ? institutionChoice : CUSTOM_INSTITUTION}
            onChange={(event) => setInstitutionChoice(event.target.value)}
          >
            {institutions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            <option value={CUSTOM_INSTITUTION}>Enter manually…</option>
          </select>
        </label>
        {(institutionChoice === CUSTOM_INSTITUTION || institutions.length === 0) && (
          <label className="field">
            <span>Institution name</span>
            <input
              value={customInstitution}
              onChange={(event) => setCustomInstitution(event.target.value)}
              placeholder="University or issuing organization"
            />
          </label>
        )}

        <label className="field">
          <span>Claim details</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={category.claimPlaceholder}
            rows={3}
          />
        </label>

        <UrlFields
          label="Personal profile"
          hint="At least 1 public LinkedIn, portfolio, or profile link."
          values={profileUrls}
          onChange={setProfileUrls}
          minCount={1}
        />
        <UrlFields
          label="Independent verification sources"
          hint="At least 2 links: an official diploma lookup, AWS Certification Verify, PSI/Pearson VUE, or another official page."
          values={sourceUrls}
          onChange={setSourceUrls}
          minCount={2}
        />

        {error && <p className="notice warn" role="alert">{error}</p>}
        {stageLabel && (
          <p className="notice loading" role="status">
            <Loader2 size={16} className="spin" /> {stageLabel}
          </p>
        )}
        {txHash && (
          <p className="quiet">
            Transaction{' '}
            <a href={txExplorerUrl(txHash)} target="_blank" rel="noreferrer">{String(txHash).slice(0, 18)}…</a>
          </p>
        )}

        <button className="btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
          Request AI verification
        </button>
      </form>

      {record && (
        <div className="result-stack">
          <CredentialCard credential={record} />
          {record.status === 'DISPUTED' && (
            <form className="form-card" onSubmit={onAddEvidence}>
              <h3>Add evidence</h3>
              <p className="field-hint">Only the submitter wallet can call this while the status is DISPUTED. The AI then verifies again.</p>
              <UrlFields
                label="Add profile links"
                hint="Leave this empty if you are only adding verification sources."
                values={extraProfiles}
                onChange={setExtraProfiles}
                minCount={0}
              />
              <UrlFields
                label="Add verification sources"
                hint="A new official lookup page."
                values={extraSources}
                onChange={setExtraSources}
                minCount={0}
              />
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                Send evidence and verify again
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
