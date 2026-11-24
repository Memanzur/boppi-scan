#!/usr/bin/env python3
"""Generate model outputs for the dev split, one JSON line per case.

  python research/model/predict.py --base Qwen/Qwen3-4B --adapter runs/qwen3-4b-lora --data out/dev.jsonl --out out/pred-ft.jsonl
  python research/model/predict.py --base Qwen/Qwen3-4B --data out/dev.jsonl --out out/pred-base.jsonl   # prompted base model

The prompt is the same one the model trained on (lib/format.mjs, copied into
each record's chat file). Greedy decoding, thinking off.
"""
import argparse
import json
import time

import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer


# transformers 5 renamed torch_dtype to dtype.
DTYPE_KEY = "dtype" if int(transformers.__version__.split(".")[0]) >= 5 else "torch_dtype"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="Qwen/Qwen3-4B")
    p.add_argument("--adapter", default=None)
    p.add_argument("--data", default="research/model/out/dev.chat.jsonl")
    p.add_argument("--out", default="research/model/out/pred.jsonl")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--every", type=int, default=1, help="keep every Nth case (stratified subset across clean and injected)")
    p.add_argument("--max-new", type=int, default=1600)
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--4bit", dest="four_bit", action="store_true")
    a = p.parse_args()
    use_cuda = torch.cuda.is_available() and not a.cpu
    tok = AutoTokenizer.from_pretrained(a.adapter or a.base)
    kwargs = {DTYPE_KEY: torch.float16 if use_cuda else torch.float32}
    if use_cuda:
        kwargs["device_map"] = {"": 0}
        if a.four_bit:
            from transformers import BitsAndBytesConfig
            kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForCausalLM.from_pretrained(a.base, **kwargs)
    if a.adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, a.adapter)
    model.eval()
    n = 0
    with open(a.data) as fh, open(a.out, "w") as out:
        lines = [l for l in fh if l.strip()]
        for i, line in enumerate(lines):
            if i % a.every:
                continue
            rec = json.loads(line)
            msgs = rec["messages"][:2]
            prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False).to(model.device)
            t0 = time.time()
            with torch.no_grad():
                gen = model.generate(**ids, max_new_tokens=a.max_new, do_sample=False, pad_token_id=tok.pad_token_id or tok.eos_token_id)
            text = tok.decode(gen[0, ids["input_ids"].shape[1]:], skip_special_tokens=True)
            out.write(json.dumps({"id": rec["id"], "output": text, "seconds": round(time.time() - t0, 2),
                                  "new_tokens": int(gen.shape[1] - ids["input_ids"].shape[1])}) + "\n")
            out.flush()
            n += 1
            if a.limit and n >= a.limit:
                break
    print(f"wrote {n} predictions to {a.out}")


if __name__ == "__main__":
    main()
