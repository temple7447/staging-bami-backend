---
name: python-api-auditor
description: Security audit of Python backend APIs while you develop. Trigger on "api audit", "audit this api", "review api security", "check this endpoint" (Python targets). Modes - default (full repo) or a specific filename.
---

# Python API Security Audit

You are the orchestrator of a parallelized Python backend API security audit.

## Mode Selection

**Exclude pattern:** skip directories `venv/`, `.venv/`, `env/`, `__pycache__/`, `.pytest_cache/`, `tests/`, `test/`, `migrations/`, `site-packages/`, `build/`, `dist/`, `.tox/` and files matching `test_*.py`, `*_test.py`, `conftest.py`.

- **Default** (no arguments): scan all `.py` files using the exclude pattern. Use Bash `find` (not Glob).
- **`$filename ...`**: scan the specified file(s) only.

**Framework detection.** Read `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `poetry.lock` — and look for `manage.py` / `asgi.py` / `wsgi.py` / `app.py` / `main.py`. Classify: FastAPI, Django, Flask, Starlette, Tornado, aiohttp, Sanic, or mixed. The framework determines which framework-specific rules each agent applies.

**Flags:**

- `--file-output` (off by default) — also write the report to a markdown file per `{resolved_path}/report-formatting.md`. Never write unless explicitly passed.
- `--format <markdown|json>` (default `markdown`) — output format. Both contain the same findings; JSON is for CI / tooling integration.
- `--severity-threshold <critical|high|medium|low|info>` (default `info`) — omit findings below this severity from the report body. Still listed in the summary counts.
- `--exit-code-on <critical|high|medium|low>` (default off) — return non-zero exit code if any finding's severity is at or above this. For CI gating.
- `--since <git-ref>` (default off) — diff mode. After assembling findings, filter to only those whose `(file, line)` was modified vs `<ref>`. Uses `git log --name-only <ref>..HEAD` and `git diff --unified=0 <ref>..HEAD -- <file>` to compute line ranges.
- `--audit-ignore <path>` (default `.audit-ignore` at repo root, if it exists) — see `references/hacking-agents/shared-rules.md` for the file format. Suppresses findings by `group_key` match.

## Orchestration

**Turn 1 — Discover.** Print the banner, then make these parallel tool calls in one message:

a. Bash `find` for in-scope `.py` files per mode selection.
b. **Resolve `SKILL_DIR`** (the path where this skill's `references/` directory lives). Do NOT rely on `Glob` — it is cwd-scoped and the skill is usually mounted outside cwd. Use Bash with multiple fallbacks:

```bash
SKILL_DIR=""
for root in "$CLAUDE_PLUGIN_ROOT" "$HOME/.claude" "/tmp" "$(pwd)"; do
  [ -z "$root" ] && continue
  [ -d "$root" ] || continue
  found=$(find -L "$root" -maxdepth 8 -type f -path '*/python-api-auditor/SKILL.md' 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    SKILL_DIR="$(dirname "$found")"
    break
  fi
done
if [ -z "$SKILL_DIR" ] || [ ! -d "$SKILL_DIR/references" ]; then
  echo "⚠️  Could not resolve SKILL_DIR. Falling back to inline-rules mode (see Turn 3)."
  SKILL_DIR=""
fi
echo "SKILL_DIR=$SKILL_DIR"
```

c. ToolSearch `select:Agent`.
d. Read `pyproject.toml` (or `requirements.txt` / `setup.py`) at the target repo root.
e. Bash `mktemp -d /tmp/py-audit-XXXXXX` → store as `{bundle_dir}`.
f. (No cross-turn timestamp. Turn 4 computes its own `TS` + `RAND` inline — shell state does not persist across Bash tool calls.)

**Turn 2 — Prepare.** Two branches:

**Branch A — `SKILL_DIR` resolved** (preferred). In one message, parallel:
- `Read $SKILL_DIR/references/report-formatting.md`
- `Read $SKILL_DIR/references/judging.md`
- `Read $SKILL_DIR/references/hacking-agents/shared-rules.md`
- `Read $SKILL_DIR/references/attack-vectors/attack-vectors.md`
- If `.audit-ignore` exists at repo root, `Read .audit-ignore`.

Then build `{bundle_dir}/source.md` in a single Bash command using `cat` + in-scope `.py` source files + `pyproject.toml` / `requirements.txt`. Print line counts.

For each of the 8 agent rule files under `$SKILL_DIR/references/hacking-agents/`, Bash `cp "$SKILL_DIR/references/hacking-agents/{agent}.md" "{bundle_dir}/{agent}.md"`. The bundle_dir copy gives sub-agents a cwd-adjacent path that Read will always resolve.

**Branch B — `SKILL_DIR` unresolved**. Skip file staging. In Turn 3, inline the persona summary (see Appendix A) in each Agent prompt. Sub-agents operate on just the source + the inline summary. Reduced-coverage fallback; note it in the report Scope as "sub-agents ran with inline rules (SKILL_DIR unresolved)".

**Turn 3 — Spawn.** In one message, spawn all 8 agents as parallel foreground Agent calls.

Prompt template (substitute real values per agent):

```
You are the {agent-name} agent for a Python backend API audit.

== Your rules ==
[Branch A] Read `{bundle_dir}/{agent-name}.md` AND `{bundle_dir}/shared-rules.md`. These contain your persona's attack-plan, vulnerable-pattern catalog, safe patterns, and output-field spec.
[Branch B] Your persona summary is inlined below. Your output format is specified below.

{if Branch B — paste the matching Appendix A summary here}

== Your targets ==
Read these source files in parallel before producing findings:
{list all in-scope .py paths — one per line}

Also Read `{repo_root}/pyproject.toml` (or `requirements.txt` / `setup.py`) for dependency + framework context.
Target framework: {framework} (from config detection).

== Required output fields ==
For every FINDING, include ALL of these fields (even if blank "—"):
  severity: critical | high | medium | low | info   (per judging.md rubric)
  confidence: integer 0-100
  bug_class: kebab-tag (e.g., `bola`, `sqli`, `pickle-rce`)
  group_key: "{file} | {function-or-route} | {bug_class}"   (mandatory — drives dedup)
  proof: concrete code citation or trace (no proof → demote to LEAD)
  description: one short sentence
  fix: one-sentence suggestion (required only if confidence ≥ 80)
  cwe: "CWE-N" when applicable; omit if none
  owasp_api_top10: "APIN:YYYY" (e.g., "API1:2023"); omit if none
  file:line: cite the file and starting line number for location

For every LEAD, include: bug_class, group_key, code_smells, description, file:line.

Do NOT include severity or confidence on LEADs.

Return findings + leads as structured blocks. One vulnerability per block.
```

**Turn 4 — Deduplicate, validate & output.** Single-pass.

1. **Deduplicate.** Parse every FINDING and LEAD from all 8 agents. Group by `group_key`. Merge synonymous bug_class tags; keep best version per group; annotate `[agents: N]`.

   Check for **composite chains**: A → B where combined impact exceeds either. Confidence = min(A, B).

2. **Gate evaluation.** Run each deduplicated finding through the four gates in `judging.md`. Evaluate once, fixed order (auth dependency → input parsing → handler body → persistence → response). `UNCERTAIN` = `ALLOWS`.

3. **Apply `.audit-ignore`**: drop matching findings from the report body; retain in "Suppressed findings" section. Never suppress Critical.

4. **Apply `--since <ref>`** if set: keep findings whose `file:line` falls in changed hunks.

5. **Lead promotion & guardrails.**
   - Promote LEAD → FINDING (confidence 75) if complete exploit chain traced, OR `[agents: 2+]` demoted.
   - `[agents: 2+]` does NOT override a concrete refutation.
   - No "assumed deployer intent" reasoning.
   - A FastAPI route without a `Depends(get_current_user)` (or router-level `dependencies=`) is unauthenticated. Quote the decorator.

6. **Fix verification** (confidence ≥ 80): trace fix, verify no new regression, list all pattern locations.

7. **Compute the output filename — MANDATORY and SELF-CONTAINED.**

Run EXACTLY this Bash block. It computes the full filename from scratch — do NOT rely on any variable set in an earlier Turn (shell state does not persist across Bash tool calls):

```bash
PROJECT=$(basename "$(pwd)")
TS=$(date +%Y%m%d-%H%M%S)
RAND=$(openssl rand -hex 2 2>/dev/null || printf '%04x' $RANDOM)
OUT_DIR="assets/findings"
mkdir -p "$OUT_DIR"
# For --format markdown (default):
OUT_PATH="$OUT_DIR/${PROJECT}-api-audit-report-${TS}-${RAND}.md"
# For --format json: swap .md for .json
echo "OUT_PATH=$OUT_PATH"
```

Capture the echoed `OUT_PATH` value LITERALLY. Pass that exact string as the `file_path` argument to the Write tool in step 8.

**Rules (non-negotiable):**
- The filename MUST contain the full `${TS}-${RAND}` suffix. `${TS}` is the 15-char `YYYYMMDD-HHMMSS` date; `${RAND}` is 4 hex chars.
- The filename MUST NOT be simplified to `security-audit-report.md`, `audit.md`, `{project}-api-audit-report-{date}-audit.md`, or any other shorter form. Downstream tools (runtime-audit `--from-report`, CI diff) glob on this exact pattern.
- Compute once in this step. Do not recompute between step 7 and step 8 — the timestamp would drift.
- If `openssl` is unavailable, the `printf '%04x' $RANDOM` fallback handles it. Do not fall back to a hand-picked suffix.

**Sanity check before moving on:** verify the computed OUT_PATH matches the regex `^assets/findings/[^/]+-api-audit-report-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}\.(md|json)$`. If it doesn't, stop and recompute.

8. **Write the report** to `$OUT_PATH` per `report-formatting.md`. Scope section MUST include: Mode, Framework, Files reviewed, `SKILL_DIR resolved: yes|no (fallback mode)`, Confidence threshold, Severity threshold, Diff mode, Summary table by severity.

9. **Print terminal confirmation**: `Report written to <OUT_PATH>. {N} findings: {A} Critical, {B} High, {C} Medium, {D} Low, {E} Info.`

10. **Apply exit-code gating**. If `--exit-code-on <severity>` and any finding at or above: exit non-zero.

## Appendix A — Compact agent summaries (Branch B fallback)

When `SKILL_DIR` is unresolved (Turn 2 Branch B), inline the matching summary below into each Agent prompt. Condensed versions of `references/hacking-agents/*.md`. Recall is reduced vs the full sheets, but the skill still produces useful output.

### authz-agent
Focus: BOLA / BFLA / BOPLA / tenant isolation. Every route with a user-supplied ID, every mutating endpoint without a role gate, every ORM query lacking a tenant predicate.
Patterns: `Model.objects.get(id=id)` / `session.get(Model, id)` without user scope; DRF `queryset = Model.objects.all()`; pydantic `ConfigDict(extra="allow")`; DRF `fields = "__all__"`; `User.objects.filter(id=u.id).update(**request.POST.dict())` mass assignment; FastAPI missing `response_model`; `@csrf_exempt` on state-changing views; `app.dependency_overrides[get_current_user]` outside tests; `/admin/` routes under same auth as user routes.
Safe: `.filter(id=id, user=request.user)`, `get_queryset` overrides, explicit `response_model=UserPublic`, `ConfigDict(extra="forbid")`, whitelisted serializer.

### authn-agent
Focus: JWT forgery, session hijack, password flows, MFA bypass.
Patterns: `jwt.decode(token, key)` (2-arg — no algorithms), `options={"verify_signature": False}`, `algorithms=["HS256","RS256"]` mix; `hashlib.md5/sha1/sha256(pwd)` for passwords; `==` on hash strings; `random.*`/`uuid.uuid4()` for secrets; Django `SECRET_KEY` literal; Flask `app.secret_key="dev"`; Flask `debug=True` in prod; missing `update_session_auth_hash`; client-settable `is_staff`/`role`/`mfa_passed` in body.
Safe: `jwt.decode(token, key, algorithms=["RS256"], audience=..., issuer=...)`, `bcrypt/argon2/passlib`, `hmac.compare_digest`, `secrets.token_urlsafe(32)`.

### injection-agent
Focus: SQL / NoSQL / command / SSTI / XXE / LDAP / path traversal / header injection.
Patterns: Django `.extra(where=[f"..."])`, `.raw(f"...")`, SQLAlchemy `text(f"...")`, `cursor.execute(f"...")` / `% x`; `{"password":{"$ne":None}}` from body; `subprocess.*(shell=True)`, `os.system`, `os.popen`, `subprocess.*(f"...")`; `render_template_string(request.args['x'])`; `lxml.etree.XMLParser(resolve_entities=True)` or `xml.etree` on untrusted XML; `os.path.join(UPLOAD_DIR, request.GET['name'])`; old `tarfile.extractall` without `filter='data'`; `zipfile.extractall` unchecked; Pydantic v1 `@validator`/`Config`/`regex=` ignored by Pydantic v2 (validation silently disabled).
Safe: Django ORM `.filter(name=q)`, SQLAlchemy bound params `text(":x").bindparams(x=v)`, `subprocess.run([cmd, arg1])` argv form, `defusedxml`, `Path(root)/name.resolve()` + startswith check.

### deserialization-and-ssrf-agent
Focus: unsafe parsers + outbound HTTP with caller-controlled URL.
Patterns: `pickle.loads(untrusted)`, `yaml.load(x)` without `SafeLoader`, `marshal.loads`, `jsonpickle.decode`, `joblib.load`; `eval(request.*)`, `exec(request.*)`; `requests.get(body.url)`, `urlopen(body.url)`, `httpx.get(body.url)`, `aiohttp.get(body.url)`, `page.goto(body.url)`; SSRF targets `169.254.169.254`, `127.0.0.1:6379`, `file:///etc/passwd`; bypass variants; `requests` follows redirects by default vs `httpx` which doesn't — watch for `httpx.Client(follow_redirects=True)` silent re-enable.
Safe: `yaml.safe_load`, `defusedxml`, SSRF allowlist + resolve-DNS-then-connect + block private/link-local, `allow_redirects=False`/`follow_redirects=False` explicit.

### crypto-and-secrets-agent
Focus: weak primitives, non-constant-time compare, nonce reuse, secrets in source/logs/responses.
Patterns: `hashlib.md5/sha1(pwd)`; `==` on HMAC/hash; AES ECB; static nonce in GCM; `random.*` for secrets; `requests.*(verify=False)`, `PYTHONHTTPSVERIFY=0`; Django `SECRET_KEY` literal; `.env` committed; regex (`AKIA[0-9A-Z]{16}`, `-----BEGIN * PRIVATE KEY-----`, `sk_live_[0-9a-zA-Z]{24,}`, `ghp_[0-9a-zA-Z]{36}`); webhook verify on parsed JSON instead of raw bytes; JWKS `d` field exposed.
Safe: `bcrypt`/`argon2-cffi`/`passlib`, `hmac.compare_digest`, AES-GCM with random nonce, secrets manager.

### resource-and-business-logic-agent
Focus: rate limits, DoS amplifiers, races, idempotency, bulk abuse.
Patterns: no limiter on auth/reset/signup/SMS endpoints; `int(request.GET["limit"])` unchecked; missing `DATA_UPLOAD_MAX_MEMORY_SIZE` / `MAX_CONTENT_LENGTH`; catastrophic-regex on user input; `bcrypt.hashpw(...)` in `async def`; sync SA in async FastAPI; check-then-act balance without atomic `.filter(id=x, balance__gte=amount).update(balance=F("balance")-amount)`; POST without Idempotency-Key; GraphQL missing depth/complexity limits.
Safe: `slowapi`/`django-ratelimit`/`flask-limiter`/DRF throttling (user+IP key), pagination max, atomic conditional updates, idempotency table.

### config-and-supply-chain-agent
Focus: Django/FastAPI/Flask settings, CORS, headers, deps, Docker, CI.
Patterns: Django `DEBUG=True`, `ALLOWED_HOSTS=['*']`, `SECRET_KEY` literal, `SESSION_COOKIE_SECURE=False`, missing HSTS; FastAPI `CORSMiddleware(allow_origins=["*"], allow_credentials=True)`; Flask `debug=True` (Werkzeug PIN → RCE); `/debug`, `/actuator`, `/.env` reachable; Swagger UI in prod; unpinned `requirements.txt`; `setup.py cmdclass` running at install; Starlette middleware LIFO order; FastAPI middleware vs Depends ordering.
Safe: `manage.py check --deploy`; explicit CORS allowlist; `pydantic-settings` for env; pinned deps + lockfile; multi-stage Docker + non-root.

### llm-and-integration-agent
Focus: prompt injection, LLM-to-tool authz, tool-schema injection, memory poisoning, confused deputy, webhook verify, GraphQL, 3rd-party trust, presigned URLs.
Patterns: user text concat'd into system prompt; agent tool dispatched with service creds; LangChain `Tool(description=user_text)`; LlamaIndex `FunctionTool.from_defaults(description=user_text)`; Chroma/FAISS/Pinecone without tenant filter; LangGraph/CrewAI sub-agent with orchestrator's scope; Celery task with service creds triggered by agent; LLM output → `exec`/SQL/shell/HTML; unbounded `max_tokens`; user-controlled `model`; webhook verify against parsed JSON; long-TTL bucket-scoped presigned URLs; WebSocket `accept()` before auth.
Safe: delimited user-content tags, per-call ACL re-check, hardcoded tool descriptions, per-tenant memory scope with provenance, raw-body HMAC, short-TTL object-scoped presigned URLs.

## Banner

Before doing anything else, print this exactly:

```

██████╗ ██╗   ██╗    █████╗ ██╗   ██╗██████╗ ██╗████████╗ ██████╗ ██████╗
██╔══██╗╚██╗ ██╔╝   ██╔══██╗██║   ██║██╔══██╗██║╚══██╔══╝██╔═══██╗██╔══██╗
██████╔╝ ╚████╔╝    ███████║██║   ██║██║  ██║██║   ██║   ██║   ██║██████╔╝
██╔═══╝   ╚██╔╝     ██╔══██║██║   ██║██║  ██║██║   ██║   ██║   ██║██╔══██╗
██║        ██║      ██║  ██║╚██████╔╝██████╔╝██║   ██║   ╚██████╔╝██║  ██║
╚═╝        ╚═╝      ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
                         Python API Auditor

```
