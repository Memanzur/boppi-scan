from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "video-frames"
FRAMES.mkdir(exist_ok=True)

BG = (7, 17, 31)
PANEL = (15, 32, 53)
WHITE = (245, 248, 255)
MUTED = (159, 176, 201)
CYAN = (98, 230, 255)
GREEN = (101, 243, 178)
RED = (255, 107, 117)
AMBER = (255, 200, 87)

font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
regular = lambda size: ImageFont.truetype(font_path, size)
bold = lambda size: ImageFont.truetype(font_path, size)

scenes = [
    ("See what AI agents can reach", "Before attackers do.", ["Boppi maps agent access and verifies", "the smallest effective fix."]),
    ("1  /  Discover", "Claude Desktop  ·  Cursor  ·  Claude Code", ["Boppi finds local MCP configurations and records metadata only.", "Secret values and file contents stay untouched."]),
    ("2  /  Map access", "Agent  ->  MCP server  ->  capability  ->  data", ["Example: Claude Desktop -> Filesystem MCP -> read files", "-> customer exports -> Fetch MCP"]),
    ("3  /  Find attack paths", "Individually normal. Together dangerous.", ["CRITICAL  ·  Potential data-exfiltration path", "Sensitive data can reach an external destination."]),
    ("4  /  Recommend the smallest fix", "Simulate the options before changing production.", ["Recommended: remove external network access from Fetch MCP", "Breaks 2 of 3 exposure paths."]),
    ("5  /  Verify remediation", "Rescan and prove the change worked.", ["RESOLVED  ·  Data exfiltration path", "RESOLVED  ·  Credential exposure path", "REVIEW  ·  One separate privilege path remains"]),
    ("Visibility and attack-path management", "for AI agents.", ["Discover what agents can access.", "Understand the blast radius. Fix the smallest thing that matters."]),
]

def draw_scene(index, title, subtitle, lines):
    image = Image.new("RGB", (1280, 720), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1280, 10), fill=CYAN)
    draw.text((86, 68), "BOPPI  /  AI AGENT SECURITY", font=bold(22), fill=CYAN)
    draw.text((86, 140), title, font=bold(48), fill=WHITE)
    draw.text((86, 230), subtitle, font=regular(25), fill=MUTED)
    draw.rounded_rectangle((86, 330, 1194, 510), radius=16, fill=PANEL)
    draw.rectangle((86, 330, 94, 510), fill=GREEN)
    y = 380
    for line in lines:
        color = RED if line.startswith("CRITICAL") else GREEN if line.startswith("RESOLVED") else AMBER if line.startswith("REVIEW") or line.startswith("Recommended") else WHITE
        draw.text((125, y), line, font=bold(28) if line.startswith(("CRITICAL", "RESOLVED", "REVIEW", "Recommended")) else regular(28), fill=color)
        y += 48
    draw.text((86, 650), "Fictional example data  ·  runs locally", font=regular(17), fill=(114, 134, 163))
    image.save(FRAMES / f"scene-{index}.png")

for i, scene in enumerate(scenes):
    draw_scene(i, *scene)

with (FRAMES / "concat.txt").open("w", encoding="utf-8") as handle:
    for i in range(len(scenes)):
        handle.write(f"file '{FRAMES / f'scene-{i}.png'}'\n")
        handle.write("duration 2\n")
    handle.write(f"file '{FRAMES / f'scene-{len(scenes)-1}.png'}'\n")
