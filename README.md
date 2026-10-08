# CredentialCheck

Public credential registry on GenLayer. A candidate (or a recruiter on their behalf) submits a degree or certificate plus at least two independent verification sources. The Intelligent Contract fetches those pages and returns one binary verdict: `VERIFIED` or `UNVERIFIED`. Anyone can look the result up later by `credential_id` or by the submitter wallet. No login is required to read.

There is no escrow, no payout, and no GEN transfer. The contract only records a public verification.

> CredentialCheck dies without GenLayer: no EVM contract can read an unstructured credential and compare it with independent verification sources in natural language, and no background-check service is cheap enough for freelance or small-scale hiring. Only GenLayer's decentralized AI consensus can verify this at near-zero cost and leave a public record anyone can look up.

## Why this is an Intelligent Contract submission

Portal category: **Intelligent Contracts** (0–300 pts), not Projects.

The product is one contract plus a thin public UI. It does not move value, split fees, or run a marketplace. GenLayer is in the loop because the decision itself is non-deterministic: unstructured profile pages have to be read and compared with official lookup pages, then a binary verdict has to be agreed by validators and stored on studionet.

## Live App

https://credentialcheck-genlayer.vercel.app

## Deployed Contract

- **Network:** studionet (GenLayer Studio)
- **Address:** `0xE964856aAee2DBC1953bb6948993c7408188a6E0`
- **Explorer:** https://genlayer-explorer.vercel.app/address/0xE964856aAee2DBC1953bb6948993c7408188a6E0

## Status

| Item | Value |
|---|---|
| Network | studionet only |
| Contract | `0xE964856aAee2DBC1953bb6948993c7408188a6E0` |
| Explorer | https://genlayer-explorer.vercel.app/address/0xE964856aAee2DBC1953bb6948993c7408188a6E0 |
| `VITE_CONTRACT_ADDRESS` | Set in `frontend/.env` and in the Vercel production environment |
| Live app | https://credentialcheck-genlayer.vercel.app |

Until the address is set, the frontend boots in preview mode: a banner explains that writes and on-chain reads are off, and the page does not crash.

## Architecture

```
submit_credential
  → status SUBMITTED
resolve_credential
  → gl.nondet.web.render each profile URL and each verification URL
  → gl.nondet.exec_prompt returns JSON {verdict, confidence, reason}
  → validators must agree on the verdict AND on whether confidence clears 60
  → confidence < 60: DISPUTED
  → else status = VERIFIED or UNVERIFIED
add_evidence (submitter only, DISPUTED only)
  → append URLs, status back to SUBMITTED
  → resolve_credential again
```

Failed page fetches and unparseable model output raise `UserError` inside the nondet block. Because nothing is paid out first, the whole transaction reverts and the credential stays `SUBMITTED`. Call `resolve_credential` again. There is no `retry_resolution`.

Validators compare the binary verdict exactly. They also require the same settle-versus-dispute branch (`confidence >= 60`), because that bit changes the stored status. They do not compare the raw confidence integer, so 90 and 74 can agree when both are `VERIFIED`.

### Verified APIs

| Need | API |
|---|---|
| Caller | `gl.message.sender_address` |
| TreeMap default | `map.get(key, default)` — empty default is `[]`, because `DynArray[str]()` raises `TypeError` on runner v0.2.16 |

Header pinned to the current Studio runner:

```python
# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

No payable methods and no `gl.message.value`. This contract never transfers GEN.

### Methods

Writes:

- `submit_credential(credential_type, issuing_institution, claim_details, profile_reference_urls, verification_source_urls) -> credential_id`
- `add_evidence(credential_id, additional_profile_urls, additional_verification_urls)`
- `resolve_credential(credential_id)`

Views:

- `get_credential(credential_id)`
- `get_credentials_by_submitter(submitter)`
- `get_credential_count()`

Rules:

- Credential type, issuing institution, and claim details are required.
- At least 1 `http(s)` profile URL and 2 `http(s)` verification URLs.
- `confidence < 60` stores `DISPUTED`. Only the submitter can add evidence, and only while disputed.
- A second `resolve_credential` is rejected unless status is `SUBMITTED` again.

## Tests

```bash
pip install -r requirements.txt
gltest tests/test_credential_check.py
```

Latest local run: **8 passed** (`gltest tests/test_credential_check.py`).

Covered:

- Happy path `VERIFIED`
- Happy path `UNVERIFIED`
- Missing profile URL, fewer than 2 verification URLs, empty fields
- Low confidence → `DISPUTED` → stranger blocked → submitter `add_evidence` → resolve succeeds
- Empty page and broken JSON raise `UserError` and leave `SUBMITTED`
- Double resolve blocked
- `add_evidence` blocked for a non-submitter and for a non-disputed record
- `get_credentials_by_submitter` returns the right ids after several submits

Frontend helpers:

```bash
cd frontend
npm test
npm run build
```

## Deploy on studionet (manual)

Do this in GenLayer Studio. The agent does not deploy the contract.

1. Open GenLayer Studio and select **studionet**. Do not switch the contract or the app to another testnet.
2. Create a new contract from `contracts/credential_check.py`. Keep the two header lines as they are.
3. Constructor takes no arguments. Deploy and wait until the transaction shows `Result: SUCCESS`.
4. Copy the contract address.

After that address exists:

1. Set `frontend/.env`:
   ```
   VITE_CONTRACT_ADDRESS=0xE964856aAee2DBC1953bb6948993c7408188a6E0
   ```
   Use the same name in the Vercel project environment.
2. `cd frontend && npm install && npm run build`
3. Run the app, connect MetaMask on **studionet**, submit a credential, then look it up by id and by wallet. Writes do not attach GEN.
4. Push the repo and deploy the `frontend` directory to Vercel. `vercel.json` proxies `/api/genlayer` to `https://studio.genlayer.com/api` so the browser can read studionet.

## Frontend

- **Look up** is the default page. Wallet connection is optional. Search by credential id or submitter address.
- **Submit** uses category chips (university degree, IT certificate, professional certificate, other). Each chip suggests a `claim_details` format and a short list of issuing organizations, with a free-text option. Every URL field has a clipboard paste button.
- **Request AI verification** submits, then calls `resolve_credential`, and shows a badge: green `VERIFIED`, red `UNVERIFIED`, amber `DISPUTED`, plus the reason and confidence.
- If the address is missing, the banner stays up and contract calls are not made.
