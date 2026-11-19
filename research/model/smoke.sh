#!/usr/bin/env bash
# CPU smoke test: proves generate -> train -> predict -> eval runs end to end.
# Tiny LoRA on Qwen3-0.6B, 8 steps, 32 examples. Says nothing about quality.
# Downloads about 1.2 GB of public weights from Hugging Face. Costs nothing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="${ENGINE:-$here/../..}"
work="${WORK:-$here/runs/smoke}"
mkdir -p "$work"
[ -f "$here/out/dev.jsonl" ] || node "$here/gen.mjs" --engine "$engine" --out "$here/out"
node "$here/test-pipeline.mjs" --engine "$engine" --dev "$here/out/dev.jsonl"
python3 "$here/train_lora.py" --model Qwen/Qwen3-0.6B --no-4bit --cpu --data "$here/out/train.chat.jsonl" \
  --out "$work/adapter" --max-steps 8 --limit 32 --grad-accum 4 --max-len 1024 --rank 8 --alpha 16 --lr 3e-4
python3 "$here/predict.py" --cpu --base Qwen/Qwen3-0.6B --adapter "$work/adapter" --data "$here/out/dev.chat.jsonl" \
  --out "$work/pred-ft.jsonl" --every 55 --max-new 400
node "$here/eval.mjs" --dev "$here/out/dev.jsonl" --pred "$work/pred-ft.jsonl" --engine "$engine" --only-predicted --out "$work/eval-ft.json"
