#!/usr/bin/env python3
"""Writes own_model_qwen3_4b.ipynb (run once after editing the cells below)."""
import json, os

ENGINE_SHA = "89f4c804435d4bc8f715f76aa3ecf2e099f10cea"  # PR 22 head used for the labels
BRANCH = "cursor/own-model-free-7c1d"

cells = [
("md", """# Boppi own model: free QLoRA run (Qwen3-4B on a T4)

Runs on a free Kaggle or Colab GPU. Costs nothing. Nothing is pushed anywhere; the adapter and reports land in the working directory for download.

1. Kaggle: Settings, Accelerator **GPU T4 x2** (one is used), Internet **On** (needs a phone verified account). Colab: Runtime, Change runtime type, **T4 GPU**.
2. Run all cells. Expect roughly: data 5 to 10 min, baseline 30 to 60 min, training 1 to 2 h per epoch, predictions 45 to 90 min.
3. Download `boppi-own-model-results.zip` from the output panel.

The rules engine labels everything. The model never outputs a severity, and the sealed held-out corpus is not used anywhere in this notebook."""),
("code", """import os, subprocess, shutil, sys
WORK = '/kaggle/working' if os.path.isdir('/kaggle/working') else '/content'
os.chdir(WORK)
print('work dir', WORK)
print(subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv'], capture_output=True, text=True).stdout)
print('node', shutil.which('node'))"""),
("md", "## 1. Tools\nInstalls the Python packages, and Node 20 only if the image has no Node 18 or newer."),
("code", """!pip -q install "transformers>=4.51" "peft>=0.13" "accelerate>=1.0" "bitsandbytes>=0.45"
import shutil, subprocess
def node_ok():
    n = shutil.which('node')
    if not n: return False
    v = subprocess.run([n, '--version'], capture_output=True, text=True).stdout.strip().lstrip('v')
    return int(v.split('.')[0]) >= 18
if not node_ok():
    !curl -fsSL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz -o /tmp/node.tar.xz && tar -xJf /tmp/node.tar.xz -C /tmp
    os.environ['PATH'] = '/tmp/node-v20.18.1-linux-x64/bin:' + os.environ['PATH']
!node --version"""),
("md", "## 2. Code and labeling engine\nThe repo is public. `engine` is the rules engine commit the labels come from (PR 22 head), pinned so the data is byte for byte reproducible."),
("code", f"""ENGINE_SHA = '{ENGINE_SHA}'
BRANCH = '{BRANCH}'
!rm -rf boppi-scan engine
!git clone -q --branch $BRANCH https://github.com/Memanzur/boppi-scan.git boppi-scan
!git clone -q https://github.com/Memanzur/boppi-scan.git engine && git -C engine checkout -q $ENGINE_SHA
!git -C engine log --oneline -1"""),
("md", "## 3. Generate data (deterministic)\nAbout 2,000 clean plus about 300 planted injection configs for training, and a separate dev split from other seeds, templates and catalog rows. `manifest.json` has the counts."),
("code", """!node boppi-scan/research/model/gen.mjs --engine engine --out data
!node boppi-scan/research/model/test-pipeline.mjs --engine engine --dev data/dev.jsonl
import json; m = json.load(open('data/manifest.json'))
print(json.dumps({k: {x: v[x] for x in ['kept', 'clean', 'injected', 'benign', 'by_max_severity', 'dropped']} for k, v in m['splits'].items()}, indent=1))"""),
("md", "## 4. Baseline: the base model with the same prompt, no training\nUses every 3rd dev case (about 110, clean and injected) to keep it under an hour."),
("code", """!python boppi-scan/research/model/predict.py --base Qwen/Qwen3-4B --data data/dev.chat.jsonl --out data/pred-base.jsonl --every 3 --max-new 1600
!node boppi-scan/research/model/eval.mjs --dev data/dev.jsonl --pred data/pred-base.jsonl --engine engine --only-predicted --out data/eval-base.json"""),
("md", "## 5. QLoRA training\n4 bit NF4, LoRA r=16 on all attention and MLP projections, seq 2048, batch 1 x grad accum 16, fp16 (T4 has no bf16). One epoch first; checkpoints every 200 steps so a timeout does not lose everything."),
("code", """!python boppi-scan/research/model/train_lora.py --model Qwen/Qwen3-4B --data data/train.chat.jsonl --out runs/qwen3-4b-lora --epochs 1 --save-steps 40"""),
("md", "## 6. Score the fine tuned model on the same dev cases"),
("code", """!python boppi-scan/research/model/predict.py --base Qwen/Qwen3-4B --adapter runs/qwen3-4b-lora --data data/dev.chat.jsonl --out data/pred-ft.jsonl --every 3 --max-new 1600
!node boppi-scan/research/model/eval.mjs --dev data/dev.jsonl --pred data/pred-ft.jsonl --engine engine --only-predicted --out data/eval-ft.json
import json
for name in ['base', 'ft']:
    r = json.load(open(f'data/eval-{name}.json'))
    arm = next(a for a in r['arms'] if a['arm'] == 'model-only')
    print(name, 'schema', r['schema'], '| crit P', arm['critical_precision'], 'R', arm['critical_recall'], '| benign flagged', arm['benign_flagged'], '| fixes', r['fixes'], '| injection', r['injection'])"""),
("md", "## 7. Package results\nAdapter (about 130 MB), train summary, eval reports and manifest. No dataset or base weights are included; both regenerate for free."),
("code", """!rm -rf results && mkdir -p results && cp -r runs/qwen3-4b-lora results/adapter && rm -rf results/adapter/checkpoint-*
!cp data/manifest.json data/eval-*.json results/
!cd results && zip -qr ../boppi-own-model-results.zip . && cd .. && ls -la boppi-own-model-results.zip"""),
]

nb = {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"}, "language_info": {"name": "python"}, "accelerator": "GPU"}, "cells": []}
for i, (kind, src) in enumerate(cells):
    cell = {"cell_type": "markdown" if kind == "md" else "code", "id": f"c{i:02d}", "metadata": {}, "source": src.splitlines(keepends=True)}
    if kind == "code":
        cell.update({"execution_count": None, "outputs": []})
    nb["cells"].append(cell)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "own_model_qwen3_4b.ipynb")
with open(out, "w") as fh:
    json.dump(nb, fh, indent=1)
    fh.write("\n")
print("wrote", out)
