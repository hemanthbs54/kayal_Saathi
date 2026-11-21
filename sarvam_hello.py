"""One Sarvam chat completion. Run: python sarvam_hello.py"""
import os
from pathlib import Path

from sarvamai import SarvamAI

# Load .env (KEY=value lines) without extra dependencies; real env vars take precedence.
env = Path(__file__).with_name(".env")
if env.exists():
    for line in env.read_text(encoding="utf-8").splitlines():
        k, sep, v = line.partition("=")
        if sep and not line.lstrip().startswith("#"):
            os.environ.setdefault(k.strip(), v.strip())

key = os.environ.get("SARVAM_API_KEY")
if not key:
    raise SystemExit("SARVAM_API_KEY is empty: paste your key into .env first.")

client = SarvamAI(api_subscription_key=key)
resp = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Say hello in Malayalam in one short sentence."}],
)
print(resp.choices[0].message.content)
