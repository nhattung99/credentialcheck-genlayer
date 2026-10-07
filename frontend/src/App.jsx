import React, { useEffect, useState } from 'react';
import { BadgeCheck, Wallet } from 'lucide-react';
import { LookupPanel } from './components/LookupPanel.jsx';
import { SubmitPanel } from './components/SubmitPanel.jsx';
import {
  addressExplorerUrl,
  ensureStudioNetwork,
  formatWalletError,
  hasContractAddress,
  CONTRACT_ADDRESS,
} from './genlayerClient.js';
import { parseRoute, shortAddress } from './format.js';

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash).path);
  const [account, setAccount] = useState(null);
  const [connectError, setConnectError] = useState('');

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.hash).path);
    window.addEventListener('hashchange', sync);
    if (!window.location.hash) {
      window.location.replace('#lookup');
    }
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum?.on) return undefined;
    const onAccounts = (accounts) => {
      setAccount(Array.isArray(accounts) && accounts[0] ? accounts[0] : null);
    };
    window.ethereum.on('accountsChanged', onAccounts);
    window.ethereum.request({ method: 'eth_accounts' }).then(onAccounts).catch(() => {});
    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', onAccounts);
      }
    };
  }, []);

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        setConnectError('Cần cài MetaMask để ký giao dịch nộp credential.');
        return;
      }
      setConnectError('');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0] || null);
      try {
        await ensureStudioNetwork();
      } catch (err) {
        console.warn('studionet switch note:', err);
        setConnectError(formatWalletError(err, 'Chưa chuyển được sang studionet'));
      }
    } catch (err) {
      setConnectError(formatWalletError(err, 'Không kết nối được ví'));
    }
  };

  const go = (path) => {
    window.location.hash = path;
    setRoute(path);
  };

  return (
    <div className="app">
      {!hasContractAddress && (
        <div className="missing-banner" role="status">
          Chưa có địa chỉ contract. App vẫn mở được: bạn xem form và tra cứu, nhưng ghi / đọc on-chain tắt cho đến khi deploy trên <strong>studionet</strong> và gán <code>VITE_CONTRACT_ADDRESS</code>.
        </div>
      )}

      <header className="topbar">
        <a className="brand" href="#lookup" onClick={() => setRoute('lookup')}>
          <span className="seal" aria-hidden="true"><BadgeCheck size={22} /></span>
          <span>
            <strong>CredentialCheck</strong>
            <small>Registry bằng cấp trên GenLayer</small>
          </span>
        </a>
        <nav>
          <button type="button" className={route === 'lookup' ? 'nav on' : 'nav'} onClick={() => go('lookup')}>
            Tra cứu
          </button>
          <button type="button" className={route === 'submit' ? 'nav on' : 'nav'} onClick={() => go('submit')}>
            Nộp credential
          </button>
        </nav>
        <div className="wallet-slot">
          <span className="network"><i /> studionet</span>
          {account ? (
            <a className="wallet" href={addressExplorerUrl(account)} target="_blank" rel="noreferrer">
              {shortAddress(account)}
            </a>
          ) : (
            <button className="btn-ghost" type="button" onClick={connectWallet}>
              <Wallet size={15} /> Kết nối ví
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">Education / HR · không escrow · không chuyển GEN</p>
        <h1>Xác minh bằng cấp công khai, đủ rẻ cho tuyển dụng ngắn hạn.</h1>
        <p>
          Ứng viên nộp loại chứng chỉ, tổ chức cấp, và tối thiểu hai nguồn tra cứu độc lập.
          Đồng thuận AI của GenLayer ghi <em>VERIFIED</em> hoặc <em>UNVERIFIED</em> để nhà tuyển dụng tự tra.
        </p>
      </section>

      {connectError && <p className="notice warn">{connectError}</p>}
      {hasContractAddress && (
        <p className="contract-line">
          Contract <a href={addressExplorerUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer"><code>{CONTRACT_ADDRESS}</code></a>
        </p>
      )}

      {route === 'submit' ? <SubmitPanel account={account} /> : <LookupPanel />}

      <footer>
        <p>Phán quyết nhị phân. Confidence dưới 60 giữ bản ghi ở DISPUTED cho đến khi người nộp bổ sung nguồn.</p>
      </footer>
    </div>
  );
}
