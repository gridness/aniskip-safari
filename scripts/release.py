#!/usr/bin/env python3
"""Plan releases from reachable tags and stamp a disposable build checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")


def parse_version(value):
    if not VERSION_PATTERN.fullmatch(value):
        raise ValueError(f"Invalid release version: {value!r}")
    result = tuple(map(int, value.split(".")))
    if max(result) > 65535:
        raise ValueError("Version components must be at most 65535 for the extension manifest.")
    return result


def bump(version, messages):
    major, minor, patch = parse_version(version)
    if any(re.search(r"(?m)^BREAKING[ -]CHANGE:\s*\S|^[a-zA-Z]+(?:\([^\n)]*\))?!:", m) for m in messages):
        return f"{major + 1}.0.0"
    if any(re.match(r"feat(?:\([^\n)]*\))?:", m) for m in messages):
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def plan(root, ref):
    sha = git(root, "rev-parse", "--verify", ref + "^{commit}")
    tags = []
    for tag in git(root, "tag", "--merged", sha, "--list", "v*").splitlines():
        try:
            version = parse_version(tag[1:])
        except ValueError:
            continue
        tags.append((version, tag, git(root, "rev-parse", tag + "^{commit}")))
    tags.sort(reverse=True)
    on_commit = [t for t in tags if t[2] == sha]
    if len(on_commit) > 1:
        raise ValueError("Several release tags point to this commit; refusing to choose one.")
    previous = [t for t in tags if t[2] != sha]
    previous_tag = previous[0][1] if previous else ""
    if on_commit:
        version = on_commit[0][1][1:]
        if previous and parse_version(version) <= previous[0][0]:
            raise ValueError("A newer release is already reachable; refusing to republish an older version.")
    elif tags:
        previous_tag = tags[0][1]
        messages = git(root, "log", "--format=%B%x00", f"{previous_tag}..{sha}").split("\0")
        version = bump(previous_tag[1:], [m.strip() for m in messages if m.strip()])
    else:
        version = (root / "VERSION").read_text().strip()
    parse_version(version)
    tag = "v" + version
    existing = subprocess.run(["git", "rev-parse", "--verify", "--quiet", "refs/tags/" + tag + "^{commit}"], cwd=root, text=True, capture_output=True)
    if existing.returncode == 0 and existing.stdout.strip() != sha:
        raise ValueError(f"{tag} already belongs to another commit; refusing to move the tag.")
    return {"version": version, "tag": tag, "previous_tag": previous_tag, "sha": sha}


def stamp(root, version, build_number):
    parse_version(version)
    if not re.fullmatch(r"[1-9]\d*", build_number) or int(build_number) > 2_147_483_647:
        raise ValueError("Build number must be a positive 32-bit integer.")
    (root / "VERSION").write_text(version + "\n")
    for filename in ("package.json", "package-lock.json", "Extension/Resources/manifest.json"):
        path = root / filename
        data = json.loads(path.read_text())
        data["version"] = version
        if filename == "package-lock.json":
            data["packages"][""]["version"] = version
        path.write_text(json.dumps(data, indent=2) + "\n")
    subprocess.run(["python3", "scripts/generate-project.py"], cwd=root,
                   env={**os.environ, "ANISKIP_BUILD_NUMBER": build_number}, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("plan")
    prepare.add_argument("--ref", default="HEAD")
    prepare.add_argument("--github-output", type=Path)
    apply = commands.add_parser("stamp")
    apply.add_argument("--version", required=True)
    apply.add_argument("--build-number", required=True)
    args = parser.parse_args()
    if args.command == "plan":
        result = plan(ROOT, args.ref)
        if args.github_output:
            with args.github_output.open("a") as output:
                for key, value in result.items():
                    output.write(f"{key}={value}\n")
        print(json.dumps(result))
    else:
        stamp(ROOT, args.version, args.build_number)


if __name__ == "__main__":
    main()
