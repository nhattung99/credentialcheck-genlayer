# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json

UserError = gl.vm.UserError

MIN_CONFIDENCE = 60
RENDER_CHAR_CAP = 2500
MAX_PROFILE_URLS = 6
MAX_VERIFICATION_URLS = 8


def _addr_hex(addr) -> str:
    if hasattr(addr, "as_hex"):
        return addr.as_hex.lower()
    if isinstance(addr, bytes):
        return "0x" + addr.hex().lower()
    text = str(addr).strip().lower()
    if not text.startswith("0x") and len(text) == 40:
        return "0x" + text
    return text


def _same_addr(a, b) -> bool:
    return _addr_hex(a) == _addr_hex(b)


def _clip(text, limit: int) -> str:
    cleaned = str(text or "").replace("```", "'''").replace("<<<", "[").replace(">>>", "]")
    if len(cleaned) > limit:
        return cleaned[:limit]
    return cleaned


def _iter_items(values):
    try:
        count = len(values)
    except Exception:
        return
    for index in range(count):
        yield values[index]


def _as_str_list(values) -> list:
    out = []
    for item in _iter_items(values):
        out.append(str(item))
    return out


def _clean_http_urls(urls, kind: str, minimum: int, maximum: int) -> list:
    cleaned = []
    for raw in _iter_items(urls):
        url = str(raw).strip()
        if not url:
            continue
        if not (url.startswith("http://") or url.startswith("https://")):
            raise UserError("Invalid " + kind + " URL: must start with http:// or https://")
        if len(url) > 500:
            raise UserError(kind + " URL is too long")
        cleaned.append(url)
    if len(cleaned) < minimum:
        raise UserError("At least " + str(minimum) + " " + kind + " URL(s) required")
    if len(cleaned) > maximum:
        raise UserError("At most " + str(maximum) + " " + kind + " URL(s) allowed")
    return cleaned


def _require_text(value: str, label: str, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) == 0:
        raise UserError(label + " cannot be empty")
    if len(text) > limit:
        raise UserError(label + " is too long")
    return text


def _leader_payload(leader_res):
    if hasattr(leader_res, "value") and isinstance(leader_res.value, dict):
        return leader_res.value
    if hasattr(leader_res, "calldata") and isinstance(leader_res.calldata, dict):
        return leader_res.calldata
    if isinstance(leader_res, dict):
        return leader_res
    return None


def _extract_result(result) -> dict:
    payload = _leader_payload(result)
    if payload is None:
        raise UserError("Invalid nondet consensus result")
    return payload


def _parse_verdict(raw) -> dict:
    """Broken JSON or a non-binary verdict raises UserError so the tx reverts with no partial write."""
    if isinstance(raw, dict):
        data = raw
    else:
        cleaned = str(raw or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if len(lines) >= 2 and lines[0].startswith("```"):
                lines = lines[1:]
            if len(lines) >= 1 and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            data = json.loads(cleaned)
        except Exception as err:
            raise UserError("Failed to parse AI verdict JSON: " + str(err))

    if not isinstance(data, dict):
        raise UserError("Failed to parse AI verdict JSON: response is not an object")

    verdict = str(data.get("verdict", "")).strip().upper()
    if verdict not in ("VERIFIED", "UNVERIFIED"):
        raise UserError("Failed to parse AI verdict JSON: verdict must be VERIFIED or UNVERIFIED")

    try:
        confidence = int(data.get("confidence"))
    except Exception:
        raise UserError("Failed to parse AI verdict JSON: confidence must be an integer 0-100")
    if confidence < 0 or confidence > 100:
        raise UserError("Failed to parse AI verdict JSON: confidence must be an integer 0-100")

    reason = _clip(data.get("reason", ""), 800).strip()
    return {
        "verdict": verdict,
        "confidence": confidence,
        "reason": reason,
    }


def _decisions_match(leader: dict, mine: dict) -> bool:
    """Absolute binary verdict, plus the same settle-vs-dispute branch. Raw confidence is not compared."""
    if not isinstance(leader, dict) or not isinstance(mine, dict):
        return False
    leader_verdict = str(leader.get("verdict", "")).strip().upper()
    my_verdict = str(mine.get("verdict", "")).strip().upper()
    if leader_verdict not in ("VERIFIED", "UNVERIFIED"):
        return False
    if my_verdict != leader_verdict:
        return False
    try:
        leader_conf = int(leader.get("confidence"))
        my_conf = int(mine.get("confidence"))
    except Exception:
        return False
    if not (0 <= leader_conf <= 100 and 0 <= my_conf <= 100):
        return False
    return (leader_conf >= MIN_CONFIDENCE) == (my_conf >= MIN_CONFIDENCE)


def _render_page(url: str, kind: str) -> str:
    label = "profile reference URL" if kind == "profile" else "verification source URL"
    try:
        res = gl.nondet.web.render(url, mode="text")
        raw = res.body if hasattr(res, "body") else res
        body = _clip(raw, RENDER_CHAR_CAP).strip()
    except UserError:
        raise
    except Exception as err:
        raise UserError("Failed to fetch " + label + ": " + url + " (" + str(err) + ")")
    if len(body) < 20:
        raise UserError("Failed to fetch " + label + ": " + url + " (empty or unreadable page)")
    return "[" + url + "]: " + body


@allow_storage
@dataclass
class Credential:
    submitter: Address
    credential_type: str
    issuing_institution: str
    claim_details: str
    profile_reference_urls: DynArray[str]
    verification_source_urls: DynArray[str]
    status: str
    verdict: str
    verdict_reason: str
    confidence: u256


class Contract(gl.Contract):
    credential_counter: bigint
    credentials: TreeMap[str, Credential]
    submitter_credential_ids: TreeMap[str, DynArray[str]]

    def __init__(self):
        self.credential_counter = bigint(0)

    def _store_submitter_id(self, sender, credential_id: str) -> None:
        sender_key = _addr_hex(sender)
        # DynArray() cannot be constructed in user code on this runner.
        # .get(key, default) is the verified TreeMap API; [] is the empty default.
        existing_ids = self.submitter_credential_ids.get(sender_key, [])
        ids = _as_str_list(existing_ids)
        ids.append(credential_id)
        self.submitter_credential_ids[sender_key] = ids

    @gl.public.write
    def submit_credential(
        self,
        credential_type: str,
        issuing_institution: str,
        claim_details: str,
        profile_reference_urls: DynArray[str],
        verification_source_urls: DynArray[str],
    ) -> str:
        credential_type = _require_text(credential_type, "Credential type", 160)
        issuing_institution = _require_text(issuing_institution, "Issuing institution", 160)
        claim_details = _require_text(claim_details, "Claim details", 2000)
        profiles = _clean_http_urls(profile_reference_urls, "profile reference", 1, MAX_PROFILE_URLS)
        sources = _clean_http_urls(verification_source_urls, "verification source", 2, MAX_VERIFICATION_URLS)

        credential_id = str(self.credential_counter)
        self.credential_counter = self.credential_counter + bigint(1)

        sender = gl.message.sender_address
        self.credentials[credential_id] = Credential(
            submitter=sender,
            credential_type=credential_type,
            issuing_institution=issuing_institution,
            claim_details=claim_details,
            profile_reference_urls=profiles,
            verification_source_urls=sources,
            status="SUBMITTED",
            verdict="",
            verdict_reason="",
            confidence=u256(0),
        )
        self._store_submitter_id(sender, credential_id)
        return credential_id

    @gl.public.write
    def add_evidence(
        self,
        credential_id: str,
        additional_profile_urls: DynArray[str],
        additional_verification_urls: DynArray[str],
    ) -> None:
        if credential_id not in self.credentials:
            raise UserError("Credential does not exist")
        current = self.credentials[credential_id]
        if not _same_addr(gl.message.sender_address, current.submitter):
            raise UserError("Only the submitter can add evidence")
        if current.status != "DISPUTED":
            raise UserError("Can only add evidence to DISPUTED credentials")

        extra_profiles = _clean_http_urls(additional_profile_urls, "profile reference", 0, MAX_PROFILE_URLS)
        extra_sources = _clean_http_urls(additional_verification_urls, "verification source", 0, MAX_VERIFICATION_URLS)
        if len(extra_profiles) + len(extra_sources) < 1:
            raise UserError("Add at least one profile or verification URL")

        profiles = _as_str_list(current.profile_reference_urls) + extra_profiles
        sources = _as_str_list(current.verification_source_urls) + extra_sources
        if len(profiles) > MAX_PROFILE_URLS:
            raise UserError("At most " + str(MAX_PROFILE_URLS) + " profile reference URL(s) allowed")
        if len(sources) > MAX_VERIFICATION_URLS:
            raise UserError("At most " + str(MAX_VERIFICATION_URLS) + " verification source URL(s) allowed")

        current.profile_reference_urls = profiles
        current.verification_source_urls = sources
        current.status = "SUBMITTED"
        current.verdict = ""
        current.verdict_reason = ""
        current.confidence = u256(0)
        self.credentials[credential_id] = current

    @gl.public.write
    def resolve_credential(self, credential_id: str) -> None:
        if credential_id not in self.credentials:
            raise UserError("Credential does not exist")
        current = self.credentials[credential_id]
        if current.status != "SUBMITTED":
            raise UserError("Credential not ready for resolution (status: " + current.status + ")")

        credential_type = current.credential_type
        institution = current.issuing_institution
        claim_details = current.claim_details
        profile_urls_list = _as_str_list(current.profile_reference_urls)
        verification_urls_list = _as_str_list(current.verification_source_urls)

        def leader_fn() -> dict:
            profile_contents = []
            for url in profile_urls_list:
                profile_contents.append(_render_page(url, "profile"))

            verification_contents = []
            for url in verification_urls_list:
                verification_contents.append(_render_page(url, "verification"))

            prompt = (
                "You are a neutral academic/professional credential verifier.\n"
                "Claimed credential type: \"" + _clip(credential_type, 160) + "\"\n"
                "Claimed issuing institution: \"" + _clip(institution, 160) + "\"\n"
                "Claimed details: \"" + _clip(claim_details, 2000) + "\"\n"
                "Submitter's profile/portfolio evidence: " + str(profile_contents) + "\n"
                "Independent verification sources (official lookups — prioritize these if they contradict the profile evidence): "
                + str(verification_contents) + "\n\n"
                "Decide strictly one of two outcomes:\n"
                "- \"VERIFIED\": independent sources confirm this credential genuinely exists and matches the claimed details.\n"
                "- \"UNVERIFIED\": independent sources contradict the claim, don't confirm it, or evidence is insufficient.\n\n"
                "Return ONLY raw JSON, no markdown:\n"
                "{\"verdict\": \"VERIFIED\" or \"UNVERIFIED\", \"confidence\": <0-100>, \"reason\": \"<short justification>\"}"
            )
            try:
                raw = gl.nondet.exec_prompt(prompt, response_format="json")
            except UserError:
                raise
            except Exception as err:
                raise UserError("Failed to parse AI verdict JSON: " + str(err))
            return _parse_verdict(raw)

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                # Re-run so a fetch/JSON UserError is compared and the transaction reverts cleanly.
                leader_fn()
                return False
            leader_data = _leader_payload(leader_res)
            if not isinstance(leader_data, dict):
                return False
            try:
                my_res = leader_fn()
            except Exception:
                return False
            return _decisions_match(leader_data, my_res)

        result = _parse_verdict(_extract_result(gl.vm.run_nondet(leader_fn, validator_fn)))

        current.verdict = result["verdict"]
        current.confidence = u256(result["confidence"])
        current.verdict_reason = result["reason"]
        if result["confidence"] < MIN_CONFIDENCE:
            current.status = "DISPUTED"
        elif result["verdict"] == "VERIFIED":
            current.status = "VERIFIED"
        else:
            current.status = "UNVERIFIED"
        self.credentials[credential_id] = current

    def _credential_dict(self, credential: Credential) -> dict:
        return {
            "submitter": _addr_hex(credential.submitter),
            "credential_type": credential.credential_type,
            "issuing_institution": credential.issuing_institution,
            "claim_details": credential.claim_details,
            "profile_reference_urls": _as_str_list(credential.profile_reference_urls),
            "verification_source_urls": _as_str_list(credential.verification_source_urls),
            "status": credential.status,
            "verdict": credential.verdict,
            "verdict_reason": credential.verdict_reason,
            "confidence": int(credential.confidence),
        }

    @gl.public.view
    def get_credential(self, credential_id: str) -> dict:
        if credential_id not in self.credentials:
            raise UserError("Credential does not exist")
        return self._credential_dict(self.credentials[credential_id])

    @gl.public.view
    def get_credentials_by_submitter(self, submitter: Address) -> DynArray[str]:
        sender_key = _addr_hex(submitter)
        return self.submitter_credential_ids.get(sender_key, [])

    @gl.public.view
    def get_credential_count(self) -> bigint:
        return self.credential_counter
