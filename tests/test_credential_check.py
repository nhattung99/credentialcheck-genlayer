import json

import pytest

CONTRACT_PATH = "contracts/credential_check.py"

PROFILE = "https://example.com/in/jane-doe"
EXTRA_PROFILE = "https://example.org/portfolio/jane-doe"
HOLDER = "Jane Doe"
OFFICIAL_TEXT = "Official record: Jane Doe, Bachelor's Degree, MIT, Computer Science, graduated 2020. Record active."
PROFILE_TEXT = "Self-published profile of Jane Doe. This page is not an issuer registry."


def _active_vm(direct_vm):
    try:
        from gltest.direct.loader import _get_active_vm
        return _get_active_vm() or direct_vm
    except Exception:
        return direct_vm


def sim_installMocks(vm, web=None, llm=None):
    """Install nondet mocks before every AI transaction."""
    web = web or {}
    llm_payload = llm if isinstance(llm, str) or llm is None else json.dumps(llm)

    if hasattr(vm, "sim_installMocks"):
        vm.sim_installMocks({"web": web, "llm": llm_payload})
        return
    if hasattr(vm, "sim_install_mocks"):
        vm.sim_install_mocks({"web": web, "llm": llm_payload})
        return

    if hasattr(vm, "clear_mocks"):
        try:
            vm.clear_mocks()
        except Exception:
            pass
    for url, body in web.items():
        payload = body if isinstance(body, dict) else {"status": 200, "body": body}
        vm.mock_web(url, payload)
    if llm_payload is not None:
        vm.mock_llm(".*", llm_payload)


def _parse(raw):
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("{") or text.startswith("["):
            return json.loads(text)
        return raw
    return raw


def _as_list(raw):
    parsed = _parse(raw)
    if parsed is None:
        return []
    return list(parsed)


def _addr(account):
    if hasattr(account, "address"):
        return account.address
    if hasattr(account, "as_hex"):
        return account.as_hex
    return account


def _norm(addr):
    if hasattr(addr, "as_hex"):
        return str(addr.as_hex).lower()
    if isinstance(addr, bytes):
        return "0x" + addr.hex().lower()
    text = str(addr).strip().lower()
    if text.startswith("b'") or text.startswith('b"'):
        return text
    if not text.startswith("0x") and len(text) == 40:
        return "0x" + text
    return text


def _cred(contract, credential_id):
    return _parse(contract.get_credential(credential_id))


def _count(contract):
    return int(contract.get_credential_count())


def _good_web(contract, credential_id):
    row = _cred(contract, credential_id)
    web = {}
    for url in row["verification_source_urls"]:
        web[url] = OFFICIAL_TEXT
    for url in row["profile_reference_urls"]:
        web[url] = PROFILE_TEXT
    return web


def _submit(contract, vm, account, **overrides):
    vm.sender = account
    payload = {
        "credential_type": "Bachelor's Degree",
        "issuing_institution": "MIT",
        "holder_name": HOLDER,
        "claim_details": "Computer Science, graduated 2020",
        "profile_reference_urls": [PROFILE],
    }
    payload.update(overrides)
    return contract.submit_credential(
        payload["credential_type"],
        payload["issuing_institution"],
        payload["holder_name"],
        payload["claim_details"],
        payload["profile_reference_urls"],
    )


def _resolve(contract, vm, credential_id, verdict, confidence=90, reason="Pinned official pages name the holder", web=None):
    sim_installMocks(
        vm,
        web=web if web is not None else _good_web(contract, credential_id),
        llm={"verdict": verdict, "confidence": confidence, "reason": reason},
    )
    contract.resolve_credential(credential_id)


def test_happy_path_verified(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    assert credential_id == "0"
    assert _count(contract) == 1
    row = _cred(contract, credential_id)
    assert row["status"] == "SUBMITTED"
    assert row["verdict"] == ""
    assert _norm(row["submitter"]) == _norm(_addr(submitter))

    vm.sender = submitter
    _resolve(contract, vm, credential_id, "VERIFIED", 92, "Registry confirms the MIT degree")
    row = _cred(contract, credential_id)
    assert row["status"] == "VERIFIED"
    assert row["verdict"] == "VERIFIED"
    assert int(row["confidence"]) == 92
    assert "Registry" in row["verdict_reason"]
    assert PROFILE in row["profile_reference_urls"]
    assert row["holder_name"] == HOLDER
    pinned = _as_list(contract.get_official_sources("MIT"))
    assert row["verification_source_urls"] == pinned
    assert "example.com" not in " ".join(row["verification_source_urls"])
    assert len(pinned) >= 2


def test_happy_path_unverified(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    _resolve(contract, vm, credential_id, "UNVERIFIED", 88, "Official registry has no matching record")
    row = _cred(contract, credential_id)
    assert row["status"] == "UNVERIFIED"
    assert row["verdict"] == "UNVERIFIED"
    assert int(row["confidence"]) == 88


def test_caller_cannot_choose_verification_sources(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    with pytest.raises(Exception):
        _submit(contract, vm, submitter, profile_reference_urls=[])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, profile_reference_urls=["ftp://files.example/cv"])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, profile_reference_urls=["https://www.mit.edu/people/jane"])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, credential_type="   ")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, issuing_institution="")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, holder_name="  ")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, claim_details="  ")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, issuing_institution="Example College")

    assert _count(contract) == 0


def test_low_confidence_disputed_then_add_evidence_and_resolve(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    stranger = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    _resolve(contract, vm, credential_id, "VERIFIED", 41, "Pages loaded but the match is weak")
    row = _cred(contract, credential_id)
    assert row["status"] == "DISPUTED"
    assert row["verdict"] == "VERIFIED"
    assert int(row["confidence"]) == 41

    vm.sender = stranger
    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [EXTRA_PROFILE])
    assert _cred(contract, credential_id)["status"] == "DISPUTED"
    assert EXTRA_PROFILE not in _cred(contract, credential_id)["profile_reference_urls"]

    pinned = list(_cred(contract, credential_id)["verification_source_urls"])
    vm.sender = submitter
    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [])

    contract.add_evidence(credential_id, [EXTRA_PROFILE])
    row = _cred(contract, credential_id)
    assert row["status"] == "SUBMITTED"
    assert row["verdict"] == ""
    assert int(row["confidence"]) == 0
    assert EXTRA_PROFILE in row["profile_reference_urls"]
    assert row["verification_source_urls"] == pinned

    _resolve(contract, vm, credential_id, "VERIFIED", 91, "Added registry page confirms the degree")
    row = _cred(contract, credential_id)
    assert row["status"] == "VERIFIED"
    assert row["verdict"] == "VERIFIED"
    assert int(row["confidence"]) == 91


def test_web_fail_and_bad_json_revert_clean(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    web = _good_web(contract, credential_id)
    first_official = _cred(contract, credential_id)["verification_source_urls"][0]
    web[first_official] = ""
    sim_installMocks(
        vm,
        web=web,
        llm={"verdict": "VERIFIED", "confidence": 90, "reason": "should not be stored"},
    )
    with pytest.raises(Exception) as web_err:
        contract.resolve_credential(credential_id)
    assert "fail" in str(web_err.value).lower() or "url" in str(web_err.value).lower() or "fetch" in str(web_err.value).lower()
    row = _cred(contract, credential_id)
    assert row["status"] == "SUBMITTED"
    assert row["verdict"] == ""
    assert int(row["confidence"]) == 0
    assert row["verdict_reason"] == ""

    sim_installMocks(vm, web=_good_web(contract, credential_id), llm="this is not json at all")
    with pytest.raises(Exception) as json_err:
        contract.resolve_credential(credential_id)
    assert "json" in str(json_err.value).lower() or "parse" in str(json_err.value).lower()
    row = _cred(contract, credential_id)
    assert row["status"] == "SUBMITTED"
    assert row["verdict"] == ""
    assert int(row["confidence"]) == 0
    assert _count(contract) == 1


def test_double_resolve_blocked(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    _resolve(contract, vm, credential_id, "UNVERIFIED", 80, "No matching certificate")
    assert _cred(contract, credential_id)["status"] == "UNVERIFIED"

    with pytest.raises(Exception):
        contract.resolve_credential(credential_id)
    row = _cred(contract, credential_id)
    assert row["status"] == "UNVERIFIED"
    assert row["verdict"] == "UNVERIFIED"
    assert int(row["confidence"]) == 80

    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [EXTRA_PROFILE])
    assert EXTRA_PROFILE not in _cred(contract, credential_id)["profile_reference_urls"]


def test_add_evidence_stranger_and_unknown_credential(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    stranger = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [EXTRA_PROFILE])
    assert _cred(contract, credential_id)["status"] == "SUBMITTED"

    vm.sender = stranger
    with pytest.raises(Exception):
        contract.resolve_credential("999")
    with pytest.raises(Exception):
        contract.get_credential("999")
    with pytest.raises(Exception):
        contract.add_evidence("999", [EXTRA_PROFILE])


def test_get_credentials_by_submitter_lists_many(direct_vm, direct_deploy, direct_accounts):
    alice = direct_accounts[1]
    bob = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    first = _submit(contract, vm, alice)
    second = _submit(
        contract,
        vm,
        alice,
        credential_type="AWS Certified Solutions Architect",
        issuing_institution="Amazon Web Services",
        claim_details="Associate level, cert ID ABC123",
    )
    third = _submit(
        contract,
        vm,
        bob,
        credential_type="Bachelor's Degree",
        issuing_institution="Harvard University",
        claim_details="Economics, graduated 2019",
    )

    alice_ids = _as_list(contract.get_credentials_by_submitter(_addr(alice)))
    bob_ids = _as_list(contract.get_credentials_by_submitter(_addr(bob)))
    assert alice_ids == [first, second]
    assert bob_ids == [third]
    if len(direct_accounts) > 3:
        unknown = _as_list(contract.get_credentials_by_submitter(_addr(direct_accounts[3])))
        assert unknown == []
    assert _count(contract) == 3

    alice_row = _cred(contract, second)
    assert alice_row["credential_type"] == "AWS Certified Solutions Architect"
    assert alice_row["issuing_institution"] == "Amazon Web Services"
    assert alice_row["verification_source_urls"] == _as_list(contract.get_official_sources("Amazon Web Services"))
    assert _norm(alice_row["submitter"]) == _norm(_addr(alice))


def test_profile_cannot_override_pinned_sources(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    row = _cred(contract, credential_id)
    web = {}
    for url in row["verification_source_urls"]:
        web[url] = "Example Domain. This page is for illustrative examples and does not list graduates."
    for url in row["profile_reference_urls"]:
        web[url] = "Jane Doe confirms her own MIT Bachelor's Degree in Computer Science, graduated 2020."
    vm.sender = submitter
    sim_installMocks(
        vm,
        web=web,
        llm={"verdict": "VERIFIED", "confidence": 99, "reason": "The profile says the degree is real"},
    )
    contract.resolve_credential(credential_id)
    settled = _cred(contract, credential_id)
    assert settled["status"] == "UNVERIFIED"
    assert settled["verdict"] == "UNVERIFIED"
    assert int(settled["confidence"]) == 90
    assert "holder" in settled["verdict_reason"].lower()


def test_only_owner_can_pin_official_sources(direct_vm, direct_deploy, direct_accounts):
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)
    owner = getattr(vm, "_sender", None)
    stranger = direct_accounts[1]
    assert _norm(owner) == _norm(contract.get_owner())
    assert _norm(stranger) != _norm(owner)

    vm.sender = stranger
    with pytest.raises(Exception):
        contract.register_institution("Example Registry", [
            "https://www.mit.edu/",
            "https://www.studentclearinghouse.org/",
        ])
    vm.sender = owner
    with pytest.raises(Exception):
        contract.register_institution("Example Registry", [
            "https://example.com/verify",
            "https://www.studentclearinghouse.org/",
        ])
    with pytest.raises(Exception):
        contract.register_institution("Example Registry", [
            "https://registrar.mit.edu/records",
            "https://www.mit.edu/",
        ])
    contract.register_institution("Example Registry", [
        "https://www.harvard.edu/",
        "https://www.studentclearinghouse.org/",
    ])
    pinned = _as_list(contract.get_official_sources("example registry"))
    assert "https://www.harvard.edu/" in pinned
    assert "https://www.studentclearinghouse.org/" in pinned
