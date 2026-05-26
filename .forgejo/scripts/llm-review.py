#!/usr/bin/env python3
"""Per-file LLM code review that posts an aggregated comment to a Codeberg PR."""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

LLM_HOST = os.environ.get("LLM_HOST", "http://aws-ec2:8002")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemma4:26b")
LLM_FALLBACK = os.environ.get("LLM_FALLBACK", "http://localhost:11434")
CODEBERG_TOKEN = os.environ.get("CODEBERG_TOKEN", "")
REPO = os.environ.get("GITHUB_REPOSITORY", "")  # Forgejo Actions uses GITHUB_REPOSITORY
PR_NUMBER = os.environ.get("PR_NUMBER", "")
BASE_SHA = os.environ.get("BASE_SHA", "")
HEAD_SHA = os.environ.get("HEAD_SHA", "")

SKIP_EXTENSIONS = {
    ".lock", ".sum", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".zip",
    ".tar", ".gz", ".bin", ".exe", ".dll",
}

REVIEW_PROMPT = """\
You are a senior software engineer reviewing a code diff. Focus on:
- Correctness bugs and logic errors
- Security issues (injection, auth bypasses, secrets in code)
- Resource leaks or error handling gaps
- Naming/readability problems that will cause future bugs

Be concise. Use bullet points. If there is nothing notable, say "LGTM" and stop.
Skip style nitpicks unless they are likely to cause confusion.

File: {filename}

```diff
{diff}
```
"""

MAX_DIFF_BYTES = 12_000


def call_llm(prompt: str, host: str) -> str:
    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.2,
    }).encode()
    req = urllib.request.Request(
        f"{host}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"].strip()


def review_file(filename: str, diff: str) -> str:
    if len(diff.encode()) > MAX_DIFF_BYTES:
        diff = diff.encode()[:MAX_DIFF_BYTES].decode(errors="replace") + "\n... (truncated)"
    prompt = REVIEW_PROMPT.format(filename=filename, diff=diff)
    for host in [LLM_HOST, LLM_FALLBACK]:
        try:
            return call_llm(prompt, host)
        except Exception as e:
            print(f"[warn] LLM call to {host} failed: {e}", file=sys.stderr)
    return "_Review unavailable (LLM unreachable)_"


def get_changed_files() -> list[tuple[str, str]]:
    """Returns list of (filename, diff) for reviewable files."""
    base = BASE_SHA or "HEAD~1"
    result = subprocess.run(
        ["git", "diff", "--name-only", base, HEAD_SHA or "HEAD"],
        capture_output=True, text=True, check=True,
    )
    files = []
    for fname in result.stdout.strip().splitlines():
        ext = os.path.splitext(fname)[1].lower()
        if ext in SKIP_EXTENSIONS:
            continue
        diff_result = subprocess.run(
            ["git", "diff", base, HEAD_SHA or "HEAD", "--", fname],
            capture_output=True, text=True,
        )
        if diff_result.stdout.strip():
            files.append((fname, diff_result.stdout))
    return files


def post_comment(body: str):
    if not CODEBERG_TOKEN or not REPO or not PR_NUMBER:
        print("Skipping comment post (missing CODEBERG_TOKEN, REPO, or PR_NUMBER)")
        print("--- Review output ---")
        print(body)
        return
    payload = json.dumps({"body": body}).encode()
    url = f"https://codeberg.org/api/v1/repos/{REPO}/issues/{PR_NUMBER}/comments"
    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"token {CODEBERG_TOKEN}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"Posted review comment (HTTP {resp.status})")
    except urllib.error.HTTPError as e:
        print(f"Failed to post comment: {e.code} {e.read().decode()}", file=sys.stderr)


def main():
    files = get_changed_files()
    if not files:
        print("No reviewable files changed.")
        return

    print(f"Reviewing {len(files)} file(s) with {LLM_MODEL} @ {LLM_HOST} ...")
    sections = []
    for fname, diff in files:
        print(f"  reviewing {fname} ...")
        review = review_file(fname, diff)
        sections.append(f"### `{fname}`\n\n{review}")

    model_label = LLM_MODEL
    body = f"## LLM Code Review ({model_label})\n\n" + "\n\n---\n\n".join(sections)
    post_comment(body)


if __name__ == "__main__":
    main()
