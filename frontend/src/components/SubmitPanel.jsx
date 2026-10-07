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
    if (stage === 'record') return 'Đang ghi credential lên studionet…';
    if (stage === 'resolve') return 'AI đang đọc hồ sơ và đối chiếu nguồn xác minh…';
    if (stage === 'evidence') return 'Đang bổ sung bằng chứng…';
    if (stage === 'refresh') return 'Đang đọc lại kết quả…';
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
      throw new Error(`${label}: cần ít nhất ${minimum} link.`);
    }
    const bad = cleaned.find((url) => !isHttpUrl(url));
    if (bad) throw new Error(`Link không hợp lệ: ${bad}`);
    return cleaned;
  };

  const requireReady = () => {
    if (!hasContractAddress) {
      throw new Error('Chưa có địa chỉ contract. Deploy trên GenLayer Studio, rồi gán VITE_CONTRACT_ADDRESS.');
    }
    if (!account) throw new Error('Kết nối ví để ký giao dịch. Tra cứu công khai thì không cần ví.');
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
      throw new Error(`Giao dịch bị hoàn. Xem explorer: ${txExplorerUrl(hash)}`);
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
      if (!type) throw new Error('Chọn hoặc nhập loại bằng cấp / chứng chỉ.');
      if (!org) throw new Error('Nhập tổ chức cấp.');
      if (!claim) throw new Error('Nhập chi tiết khai báo.');
      const profiles = validateUrls(profileUrls, 1, 'Hồ sơ cá nhân');
      const sources = validateUrls(sourceUrls, 2, 'Nguồn xác minh');
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
        throw new Error('Đã gửi giao dịch nhưng chưa đọc được credential id. Tra cứu bằng địa chỉ ví sau ít phút.');
      }
      setRecord(created);

      setStage('resolve');
      await write('resolve_credential', [created.id], { ai: true });
      setStage('refresh');
      const settled = await refreshRecord(created.id);
      setRecord(settled || created);
      if (!settled || settled.status === 'SUBMITTED') {
        setError(`Chưa thấy phán quyết cuối. Credential #${created.id} vẫn SUBMITTED — bấm xác minh lại khi trang nguồn đã tải được.`);
      }
    } catch (err) {
      setError(formatWalletError(err, 'Không nộp được credential'));
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
        throw new Error('Chỉ ví đã nộp credential này mới bổ sung được bằng chứng.');
      }
      const profiles = cleanUrls(extraProfiles).filter(isHttpUrl);
      const sources = cleanUrls(extraSources).filter(isHttpUrl);
      const invalid = [...cleanUrls(extraProfiles), ...cleanUrls(extraSources)].find((url) => !isHttpUrl(url));
      if (invalid) throw new Error(`Link không hợp lệ: ${invalid}`);
      if (profiles.length + sources.length < 1) {
        throw new Error('Thêm ít nhất một link hồ sơ hoặc nguồn xác minh.');
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
      setError(formatWalletError(err, 'Không bổ sung được bằng chứng'));
    } finally {
      setStage('');
    }
  };

  const busy = Boolean(stage);

  return (
    <section className="panel">
      <div className="panel-copy">
        <p className="eyebrow">Nộp credential</p>
        <h2>Khai báo, đưa ít nhất hai nguồn độc lập, rồi để AI phán quyết</h2>
        <p>
          Không khóa GEN và không có phí kiểm tra lý lịch. Ví chỉ ký
          {' '}<code>submit_credential</code> và <code>resolve_credential</code> trên studionet.
        </p>
      </div>

      <form className="form-card" onSubmit={onSubmit}>
        <div className="chips" role="group" aria-label="Loại credential">
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
          <span>Loại bằng cấp / chứng chỉ</span>
          <input
            value={credentialType}
            onChange={(event) => setCredentialType(event.target.value)}
            placeholder={category.credentialType || 'Tên bằng cấp hoặc chứng chỉ'}
          />
        </label>

        <label className="field">
          <span>Tổ chức cấp</span>
          <select
            value={institutions.includes(institutionChoice) ? institutionChoice : CUSTOM_INSTITUTION}
            onChange={(event) => setInstitutionChoice(event.target.value)}
          >
            {institutions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            <option value={CUSTOM_INSTITUTION}>Tự nhập…</option>
          </select>
        </label>
        {(institutionChoice === CUSTOM_INSTITUTION || institutions.length === 0) && (
          <label className="field">
            <span>Tên tổ chức</span>
            <input
              value={customInstitution}
              onChange={(event) => setCustomInstitution(event.target.value)}
              placeholder="Tên trường hoặc tổ chức cấp"
            />
          </label>
        )}

        <label className="field">
          <span>Chi tiết khai báo</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={category.claimPlaceholder}
            rows={3}
          />
        </label>

        <UrlFields
          label="Hồ sơ cá nhân"
          hint="Ít nhất 1 link LinkedIn, portfolio, hoặc trang hồ sơ công khai."
          values={profileUrls}
          onChange={setProfileUrls}
          minCount={1}
        />
        <UrlFields
          label="Nguồn xác minh độc lập"
          hint="Bắt buộc tối thiểu 2 link: cổng tra cứu văn bằng, AWS Certification Verify, PSI/Pearson VUE, hoặc trang chính thức khác."
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
            Giao dịch{' '}
            <a href={txExplorerUrl(txHash)} target="_blank" rel="noreferrer">{String(txHash).slice(0, 18)}…</a>
          </p>
        )}

        <button className="btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
          Yêu cầu AI xác minh
        </button>
      </form>

      {record && (
        <div className="result-stack">
          <CredentialCard credential={record} />
          {record.status === 'DISPUTED' && (
            <form className="form-card" onSubmit={onAddEvidence}>
              <h3>Bổ sung bằng chứng</h3>
              <p className="field-hint">Chỉ ví người nộp gọi được khi trạng thái là DISPUTED. Sau đó AI xác minh lại.</p>
              <UrlFields
                label="Thêm hồ sơ"
                hint="Có thể để trống nếu bạn chỉ thêm nguồn xác minh."
                values={extraProfiles}
                onChange={setExtraProfiles}
                minCount={0}
              />
              <UrlFields
                label="Thêm nguồn xác minh"
                hint="Trang tra cứu chính thức mới."
                values={extraSources}
                onChange={setExtraSources}
                minCount={0}
              />
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                Gửi bằng chứng và xác minh lại
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
