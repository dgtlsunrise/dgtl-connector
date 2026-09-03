#!/bin/bash
set -euo pipefail
cd /workspace/dgtl-google-plugin
PROMPT=$(cat IMPLEMENT-PROMPT.md)
exec /home/box/.local/bin/grok --single "$PROMPT" --cwd /workspace/dgtl-google-plugin --model grok-4.6 --reasoning-effort xhigh --always-approve --output-format plain
