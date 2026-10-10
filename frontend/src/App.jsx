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
        setConnectError('Install MetaMask to sign a credential submission.');
        return;
      }
      setConnectError('');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0] || null);
      try {
        await ensureStudioNetwork();
      } catch (err) {
        console.warn('studionet switch note:', err);
        setConnectError(formatWalletError(err, 'Could not switch to studionet'));
      }
    } catch (err) {
      setConnectError(formatWalletError(err, 'Could not connect the wallet'));
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
          No contract address yet. The app still opens so you can read the form, but on-chain reads and writes stay off until the contract is deployed on <strong>studionet</strong> and <code>VITE_CONTRACT_ADDRESS</code> is set.
        </div>
      )}

      <header className="topbar">
        <a className="brand" href="#lookup" onClick={() => setRoute('lookup')}>
          <span className="seal" aria-hidden="true"><BadgeCheck size={22} /></span>
          <span>
            <strong>CredentialCheck</strong>
            <small>Public credential registry on GenLayer</small>
          </span>
        </a>
        <nav>
          <button type="button" className={route === 'lookup' ? 'nav on' : 'nav'} onClick={() => go('lookup')}>
            Look up
          </button>
          <button type="button" className={route === 'submit' ? 'nav on' : 'nav'} onClick={() => go('submit')}>
            Submit
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
              <Wallet size={15} /> Connect wallet
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">Education / HR · no escrow · no GEN transfer</p>
        <h1>Public credential checks, cheap enough for short-term hiring.</h1>
        <p>
          The registry owner pins the official pages. A candidate submits the holder name, the claim, and a profile.
          Those pinned pages are the only basis for <em>VERIFIED</em>. A profile cannot authenticate the claim.
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
        <p>The verdict is binary. Confidence below 60 keeps the record DISPUTED. Extra evidence can only add profile context. Official sources stay pinned.</p>
      </footer>
    </div>
  );
}
