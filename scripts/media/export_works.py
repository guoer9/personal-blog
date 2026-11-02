#!/usr/bin/env python3
"""Export explicitly selected, user-owned media. Never modifies the sources."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("backend/public-media/works"))
    parser.add_argument("--report", type=Path, default=Path("output/research-profile/derived-media.json"))
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG_BIN", "ffmpeg"))
    parser.add_argument("--ffprobe", default=os.environ.get("FFPROBE_BIN", "ffprobe"))
    parser.add_argument("--jobs", type=int, choices=(1, 2), default=2)
    parser.add_argument("--cover-times", type=Path, default=Path(__file__).with_name("cover-times.json"))
    parser.add_argument("--refresh-covers", action="store_true")
    args = parser.parse_args()
    for executable in (args.ffmpeg, args.ffprobe):
        if not shutil.which(executable):
            parser.error("Executable not found: " + executable)
    items = json.loads(args.manifest.read_text())["items"]
    cover_times = json.loads(args.cover_times.read_text()) if args.cover_times.exists() else {}
    root = args.output_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)

    def probe(path):
        result = subprocess.run([args.ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)

    def export(item):
        slug = item["id"]
        if not slug or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug):
            raise ValueError("Invalid media id")
        source = Path(item["sourcePath"]).resolve(strict=True)
        before = source.stat()
        destination = root / slug
        if source == destination or destination in source.parents:
            raise ValueError("Source cannot be inside export destination")
        destination.mkdir(parents=True, exist_ok=True)
        duration = float(item["format"]["duration"])
        outputs = [
            ("cover.jpg", ["-ss", str(min(float(cover_times.get(slug, 20)), duration / 1.1)), "-i", str(source), "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3", "-update", "1"]),
            ("playback.mp4", ["-i", str(source), "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-maxrate", "1400k", "-bufsize", "2800k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1", "-sn", "-dn"]),
        ]
        if item["category"] == "music":
            outputs.append(("audio.m4a", ["-i", str(source), "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1"]))
        for name, options in outputs:
            output = destination / name
            if output.exists() and not (name == "cover.jpg" and args.refresh_covers):
                existing = probe(output)
                if name != "cover.jpg" and abs(float(existing["format"]["duration"]) - duration) > 0.25:
                    raise ValueError("Existing output does not match source duration: " + str(output))
                continue
            temporary = output.with_name(output.stem + ".partial" + output.suffix)
            print("Exporting " + slug + "/" + name, flush=True)
            try:
                subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-threads", "3", *options, "-threads", "3", str(temporary)], check=True)
                probe(temporary)
                temporary.replace(output)
            finally:
                temporary.unlink(missing_ok=True)
        after = source.stat()
        if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
            raise RuntimeError("Source changed during export: " + slug)
        return {"id": slug, "source_bytes": before.st_size, "source_unchanged": True, "outputs": [{"name": name, "bytes": (destination / name).stat().st_size, "probe": probe(destination / name)} for name, _ in outputs]}

    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        results = list(executor.map(export, items))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({"items": results}, ensure_ascii=False, indent=2))
    print("Export complete: " + str(args.report), flush=True)


if __name__ == "__main__":
    main()
