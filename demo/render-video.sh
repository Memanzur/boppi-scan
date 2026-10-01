#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rm -f "$ROOT/boppi-how-it-works.mp4"
rm -rf "$ROOT/video-frames"
python3 "$ROOT/render_video.py"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$ROOT/video-frames/concat.txt" -vsync cfr -r 30 -c:v libx264 -pix_fmt yuv420p "$ROOT/boppi-how-it-works.mp4"
rm -rf "$ROOT/video-frames"
printf 'Created %s\n' "$ROOT/boppi-how-it-works.mp4"
