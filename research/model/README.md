# Boppi own model (free experiment)

A small open model (Qwen3-4B, Apache 2.0) fine tuned with QLoRA to read one MCP config and return strict JSON: the rule ids that apply, a chain explanation per finding, and a drafted fix. **The rules engine always decides severity**; the model's output has no severity field, and anything it names that the rules did not becomes an unverified suggestion. Plan and evidence: [`docs/rd/own-model-plan.md`](../../docs/rd/own-model-plan.md).

Budget is $0: no paid APIs, no paid GPUs. Training runs on a free Kaggle or Colab T4.

## Files

| File | What it does |
|---|---|
| `gen.mjs` | Deterministic data generator. Synthetic configs from `src/cli/mcpCatalog.json`, labeled by the rules engine, explanations from rule and catalog text, fixes from `boppi fix` kept only if a re-scan passes. Writes `out/{train,dev}.jsonl`, `out/*.chat.jsonl`, `out/manifest.json` |
| `lib/engine.mjs` | Runs `bin/boppi.js scan` and `fix` in throwaway homes (local only, no network) and reduces the export to labels; the re-scan gate (`judge`) |
| `lib/templates.mjs` | Config templates, scenarios (planted combos and benign shapes), injection phrasings; train and dev use different families |
| `lib/format.mjs` | System prompt, user prompt, target builder, strict output parser |
| `lib/hybrid.mjs` | Shipping merge: rules severity, model text and draft fix |
| `eval.mjs` | Scores predictions against the rules on the dev split, applies model fixes and re-scans |
| `test-pipeline.mjs` | Self checks: hybrid cannot be lowered by an obedient model, strict parser, oracle predictions score 1.0 |
| `train_lora.py` | LoRA or QLoRA training on the chat JSONL (assistant tokens only) |
| `predict.py` | Generates dev predictions (base model or base plus adapter) |
| `own_model_qwen3_4b.ipynb` | Kaggle or Colab notebook: generate, baseline, train, predict, eval, zip results. Built by `make_notebook.py` |
| `smoke.sh` | CPU smoke test (tiny LoRA on Qwen3-0.6B) |

## Run

```bash
# Labels from PR 22's engine (the R&D shell severity decision plus AE-011 to AE-013):
git worktree add --detach ../boppi-engine 89f4c804435d4bc8f715f76aa3ecf2e099f10cea
node research/model/gen.mjs --engine ../boppi-engine --out research/model/out
node research/model/test-pipeline.mjs --engine ../boppi-engine
```

Without `--engine` the generator labels with the checkout it sits in (main). Outputs are gitignored; never commit them.

## Data (engine `89f4c80`, generated 2026-11-19, identical on a second run)

| Split | Planned | Kept | Clean | Injected | Dropped (fix failed re-scan) | Critical | High | Medium | None | Benign (below high) |
|---|---|---|---|---|---|---|---|---|---|---|
| train | 2,335 | 2,077 | 1,769 | 308 | 258 | 1,271 | 197 | 538 | 71 | 609 |
| dev | 365 | 330 | 272 | 58 | 35 | 187 | 39 | 93 | 11 | 104 |

Planted injection never changed a rule label (0 of 366). Train examples are about 770 tokens at the median and 1,590 at p95 (Qwen3 tokenizer); 6 are over 2,048 and are dropped at training time.

## Sealed evaluation

The sealed held-out corpus on `cursor/heldout-detection-eval-5eec` is never read, used for training, or used to build templates. Only the QA agent runs it. `gen.mjs` and `eval.mjs` refuse paths containing `heldout`. The CI corpus in `test/corpus` is not used either. Dev scores measure agreement with the rules and fix survival on re-scan, not ground truth accuracy.

## CPU smoke test (box, 8 vCPU Xeon, no GPU, 2026-11-19)

Proves the pipeline runs end to end. **It says nothing about quality**: 8 steps on 32 examples of a 0.6B model.

- Data and checks: `gen.mjs` plus `test-pipeline.mjs` pass (oracle 227 of 227 fixes pass re-scan; an obedient model cannot lower hybrid severity; vandalized fixes never count).
- Training: Qwen3-0.6B, plain LoRA r=8 in fp32 on CPU, 5.0M trainable parameters, 8 steps of 4 examples (examples up to 1,024 tokens), 150 seconds. Loss went from 2.50 to 1.85 (lowest 1.51).
- Prediction: 12 dev cases (6 short benign, then 3 critical, 1 medium and 2 injected critical), 12 to 35 seconds each on CPU with at most 500 new tokens.
- Tuned 0.6B: learned the bare JSON shape (no code fence, `rule_ids` first) but invented rule ids such as `Boppi-001` and often looped until the token limit. 1 of 12 outputs passed the strict parser; 0 correct rule ids; its one proposed fix was rejected as malformed.
- Base 0.6B with the same prompt: wrapped JSON in a code fence and invented ids such as `mcpServers`; 4 of 12 passed the parser; on one injected critical case it reported nothing.
- Hybrid on the same cases: critical precision and recall 1.0, 0 benign flagged, because severity came from the rules and model text could not change it.

Takeaway: the plumbing works on free hardware; whether the model learns anything useful needs the full Kaggle run.

## Free Kaggle run

1. Free Kaggle account with a verified phone number (needed for GPU and internet in notebooks).
2. New notebook, File, Import notebook, upload `own_model_qwen3_4b.ipynb` (or open it from GitHub once the branch is pushed).
3. Settings: Accelerator GPU T4 x2, Internet On, Persistence off is fine.
4. Run all. Download `boppi-own-model-results.zip` (adapter plus eval reports) at the end.

Colab works the same way with Runtime, Change runtime type, T4 GPU. Free Colab sessions can disconnect; the trainer saves checkpoints every 40 steps.
