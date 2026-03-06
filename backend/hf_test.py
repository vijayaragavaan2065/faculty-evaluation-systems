# local_hf_test.py
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import torch

MODEL = "google/flan-t5-small"  # small enough for CPU testing
print("Loading model:", MODEL)
tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL)

prompt = "Summarize: Conducted project-based learning for 40 students, improved outcomes, 3 papers published."
inputs = tokenizer(prompt, return_tensors="pt", truncation=True)
with torch.no_grad():
    outputs = model.generate(**inputs, max_new_tokens=60, num_beams=2)
generated = tokenizer.decode(outputs[0], skip_special_tokens=True)
print("Generated:", generated)
