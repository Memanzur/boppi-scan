#!/usr/bin/env python3
"""LoRA or QLoRA fine tune of a small open model on Boppi's chat JSONL.

Loss is on the assistant JSON only (prompt tokens are masked). Defaults fit a
free 16 GB T4: Qwen3-4B in 4 bit NF4, LoRA r=16, seq 2048, batch 1, grad accum 16,
fp16, gradient checkpointing.

  python research/model/train_lora.py --data out/train.chat.jsonl --out runs/qwen3-4b-lora
  python research/model/train_lora.py --model Qwen/Qwen3-0.6B --no-4bit --cpu --max-steps 5 --limit 32  # smoke
"""
import argparse
import json
import math
import os
import random

import torch
import transformers
from torch.utils.data import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training


# transformers 5 renamed torch_dtype to dtype.
DTYPE_KEY = "dtype" if int(transformers.__version__.split(".")[0]) >= 5 else "torch_dtype"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="Qwen/Qwen3-4B")
    p.add_argument("--data", default="research/model/out/train.chat.jsonl")
    p.add_argument("--out", default="research/model/runs/qwen3-4b-lora")
    p.add_argument("--max-len", type=int, default=2048)
    p.add_argument("--epochs", type=float, default=2.0)
    p.add_argument("--max-steps", type=int, default=-1)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--alpha", type=int, default=32)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=16)
    p.add_argument("--limit", type=int, default=0, help="use only the first N examples (smoke tests)")
    p.add_argument("--no-4bit", action="store_true", help="plain LoRA in full precision (CPU smoke test)")
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--seed", type=int, default=1119)
    p.add_argument("--save-steps", type=int, default=200)
    return p.parse_args()


class ChatJsonl(Dataset):
    def __init__(self, path, tok, max_len, limit):
        self.items = []
        skipped = 0
        with open(path) as fh:
            for line in fh:
                if not line.strip():
                    continue
                msgs = json.loads(line)["messages"]
                prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True, enable_thinking=False)
                target = msgs[2]["content"] + tok.eos_token
                p_ids = tok(prompt, add_special_tokens=False).input_ids
                t_ids = tok(target, add_special_tokens=False).input_ids
                if len(p_ids) + len(t_ids) > max_len:
                    skipped += 1  # never truncate a JSON target: drop the example instead
                    continue
                self.items.append((p_ids + t_ids, [-100] * len(p_ids) + t_ids))
                if limit and len(self.items) >= limit:
                    break
        print(f"loaded {len(self.items)} examples, skipped {skipped} longer than {max_len} tokens")

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        ids, labels = self.items[i]
        return {"input_ids": ids, "labels": labels}


def collate(pad_id):
    def fn(batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), pad_id, dtype=torch.long)
        lab = torch.full((len(batch), n), -100, dtype=torch.long)
        att = torch.zeros((len(batch), n), dtype=torch.long)
        for i, b in enumerate(batch):
            k = len(b["input_ids"])
            ids[i, :k] = torch.tensor(b["input_ids"])
            lab[i, :k] = torch.tensor(b["labels"])
            att[i, :k] = 1
        return {"input_ids": ids, "labels": lab, "attention_mask": att}
    return fn


def main():
    a = parse_args()
    random.seed(a.seed)
    torch.manual_seed(a.seed)
    tok = AutoTokenizer.from_pretrained(a.model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    use_cuda = torch.cuda.is_available() and not a.cpu
    # T4 has no bf16: use fp16 compute there.
    compute_dtype = torch.float16 if use_cuda else torch.float32
    kwargs = {DTYPE_KEY: compute_dtype}
    if use_cuda and not a.no_4bit:
        from transformers import BitsAndBytesConfig
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=compute_dtype)
        kwargs["device_map"] = {"": 0}
    model = AutoModelForCausalLM.from_pretrained(a.model, **kwargs)
    if "quantization_config" in kwargs:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    elif use_cuda:
        model.gradient_checkpointing_enable()
    model.config.use_cache = False
    lora = LoraConfig(r=a.rank, lora_alpha=a.alpha, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
                      target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    ds = ChatJsonl(a.data, tok, a.max_len, a.limit)
    steps_per_epoch = math.ceil(len(ds) / (a.batch * a.grad_accum))
    print(f"steps per epoch: {steps_per_epoch}")
    args = TrainingArguments(
        output_dir=a.out, per_device_train_batch_size=a.batch, gradient_accumulation_steps=a.grad_accum,
        num_train_epochs=a.epochs, max_steps=a.max_steps, learning_rate=a.lr, lr_scheduler_type="cosine",
        warmup_steps=max(1, int(0.03 * (a.max_steps if a.max_steps > 0 else steps_per_epoch * a.epochs))), logging_steps=1 if a.max_steps > 0 and a.max_steps <= 20 else 10,
        save_steps=a.save_steps, save_total_limit=2, report_to=[], seed=a.seed,
        fp16=use_cuda, bf16=False, use_cpu=not use_cuda, optim="paged_adamw_8bit" if "quantization_config" in kwargs else "adamw_torch",
        gradient_checkpointing="quantization_config" in kwargs or use_cuda, gradient_checkpointing_kwargs={"use_reentrant": False},
        dataloader_num_workers=0, remove_unused_columns=False,
    )
    trainer = Trainer(model=model, args=args, train_dataset=ds, data_collator=collate(tok.pad_token_id))
    result = trainer.train()
    model.save_pretrained(a.out)
    tok.save_pretrained(a.out)
    with open(os.path.join(a.out, "train_summary.json"), "w") as fh:
        json.dump({"model": a.model, "examples": len(ds), "metrics": result.metrics,
                   "log": [x for x in trainer.state.log_history if "loss" in x]}, fh, indent=2)
    print(json.dumps(result.metrics))


if __name__ == "__main__":
    main()
