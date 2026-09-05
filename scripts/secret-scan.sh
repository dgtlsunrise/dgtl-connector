#!/usr/bin/env bash
# Local / CI secret scan. Prefers gitleaks; falls back to validate-spec heuristics.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"

# sha256 from https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt
checksum_for() {
  case "$1" in
    linux_x64) echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" ;;
    linux_arm64) echo "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080" ;;
    darwin_x64) echo "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709" ;;
    darwin_arm64) echo "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" ;;
    *) return 1 ;;
  esac
}

platform_tag() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *) return 1 ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) return 1 ;;
  esac
  echo "${os}_${arch}"
}

verify_sha256() {
  local sum="$1" file="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "${sum}  ${file}" | sha256sum -c -
  else
    echo "${sum}  ${file}" | shasum -a 256 -c -
  fi
}

run_gitleaks() {
  local bin="$1"
  local extra=(--verbose --redact --exit-code 1 --no-banner)
  if [[ -f "$ROOT/.gitleaks.toml" ]]; then
    extra+=(--config "$ROOT/.gitleaks.toml")
  fi
  if [[ -d "$ROOT/.git" ]]; then
    "$bin" git --source "$ROOT" "${extra[@]}"
  else
    "$bin" dir --source "$ROOT" "${extra[@]}"
  fi
}

if command -v gitleaks >/dev/null 2>&1; then
  run_gitleaks gitleaks
  exit 0
fi

if [[ "${GITLEAKS_INSTALL:-}" == "1" ]]; then
  tag="$(platform_tag)" || {
    echo "secret-scan: unsupported platform for gitleaks install" >&2
    exit 1
  }
  sum="$(checksum_for "$tag")" || {
    echo "secret-scan: no checksum for $tag" >&2
    exit 1
  }
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  archive="$tmp/gitleaks.tgz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${tag}.tar.gz"
  curl -fsSL -o "$archive" "$url"
  verify_sha256 "$sum" "$archive"
  tar -xzf "$archive" -C "$tmp" gitleaks
  run_gitleaks "$tmp/gitleaks"
  exit 0
fi

echo "gitleaks not on PATH; running scripts/validate-spec.py secret heuristics."
echo "Install gitleaks or re-run with GITLEAKS_INSTALL=1 for the full scan."
python3 "$ROOT/scripts/validate-spec.py"
