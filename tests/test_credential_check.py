import json

import pytest

CONTRACT_PATH = "contracts/credential_check.py"

PROFILE = "https://example.com/in/jane-doe"
VERIFY_A = "https://example.org/registry/diploma/jane-doe"
VERIFY_B = "https://example.net/cert/aws/ABC123"
EXTRA_PROFILE = "https://example.com/portfolio/jane-doe"
EXTRA_SOURCE = "https://example.org/registry/diploma/jane-doe-2020"


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


def _good_web():
    return {
        PROFILE: "Jane Doe — Bachelor of Science in Computer Science, Massachusetts Institute of Technology, class of 2020.",
        VERIFY_A: "Official diploma registry: Jane Doe, BSc Computer Science, MIT, conferred 2020. Record active.",
        VERIFY_B: "Amazon Web Services certification verify: Jane Doe, Solutions Architect Associate, credential ABC123, valid.",
        EXTRA_PROFILE: "Portfolio of Jane Doe, MIT Computer Science 2020, public projects and LinkedIn-equivalent bio.",
        EXTRA_SOURCE: "Second official lookup: Jane Doe degree record MIT Computer Science graduated 2020 confirmed.",
    }


def _submit(contract, vm, account, **overrides):
    vm.sender = account
    payload = {
        "credential_type": "Bachelor's Degree",
        "issuing_institution": "MIT",
        "claim_details": "Computer Science, graduated 2020",
        "profile_reference_urls": [PROFILE],
        "verification_source_urls": [VERIFY_A, VERIFY_B],
    }
    payload.update(overrides)
    return contract.submit_credential(
        payload["credential_type"],
        payload["issuing_institution"],
        payload["claim_details"],
        payload["profile_reference_urls"],
        payload["verification_source_urls"],
    )


def _resolve(contract, vm, credential_id, verdict, confidence=90, reason="Independent sources match the claim", web=None):
    sim_installMocks(
        vm,
        web=web or _good_web(),
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
    assert VERIFY_A in row["verification_source_urls"]
    assert VERIFY_B in row["verification_source_urls"]


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


def test_missing_profile_and_verification_urls_blocked(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    with pytest.raises(Exception):
        _submit(contract, vm, submitter, profile_reference_urls=[])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, verification_source_urls=[VERIFY_A])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, verification_source_urls=[])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, profile_reference_urls=["ftp://files.example/cv"])
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, credential_type="   ")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, issuing_institution="")
    with pytest.raises(Exception):
        _submit(contract, vm, submitter, claim_details="  ")

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
        contract.add_evidence(credential_id, [EXTRA_PROFILE], [EXTRA_SOURCE])
    assert _cred(contract, credential_id)["status"] == "DISPUTED"
    assert EXTRA_PROFILE not in _cred(contract, credential_id)["profile_reference_urls"]

    vm.sender = submitter
    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [], [])

    contract.add_evidence(credential_id, [EXTRA_PROFILE], [EXTRA_SOURCE])
    row = _cred(contract, credential_id)
    assert row["status"] == "SUBMITTED"
    assert row["verdict"] == ""
    assert int(row["confidence"]) == 0
    assert EXTRA_PROFILE in row["profile_reference_urls"]
    assert EXTRA_SOURCE in row["verification_source_urls"]

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
    sim_installMocks(
        vm,
        web={
            PROFILE: "",
            VERIFY_A: _good_web()[VERIFY_A],
            VERIFY_B: _good_web()[VERIFY_B],
        },
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

    sim_installMocks(vm, web=_good_web(), llm="this is not json at all")
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
        contract.add_evidence(credential_id, [EXTRA_PROFILE], [])
    assert EXTRA_PROFILE not in _cred(contract, credential_id)["profile_reference_urls"]


def test_add_evidence_stranger_and_unknown_credential(direct_vm, direct_deploy, direct_accounts):
    submitter = direct_accounts[1]
    stranger = direct_accounts[2]
    contract = direct_deploy(CONTRACT_PATH)
    vm = _active_vm(direct_vm)

    credential_id = _submit(contract, vm, submitter)
    vm.sender = submitter
    with pytest.raises(Exception):
        contract.add_evidence(credential_id, [EXTRA_PROFILE], [])
    assert _cred(contract, credential_id)["status"] == "SUBMITTED"

    vm.sender = stranger
    with pytest.raises(Exception):
        contract.resolve_credential("999")
    with pytest.raises(Exception):
        contract.get_credential("999")
    with pytest.raises(Exception):
        contract.add_evidence("999", [EXTRA_PROFILE], [EXTRA_SOURCE])


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
        credential_type="PMP",
        issuing_institution="Project Management Institute",
        claim_details="PMP, issued 2022, ID PMP-7781",
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
    assert _norm(alice_row["submitter"]) == _norm(_addr(alice))
