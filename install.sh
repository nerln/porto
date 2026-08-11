#!/usr/bin/env bash
#
# Install the port in one command.
#
# Seven of the nine tools are Python packages with a command, and pipx is what
# puts a command on your PATH without letting its dependencies into anybody
# else's environment. Two are left out on purpose: rada is not published yet,
# and varo has no command at all, so it is installed by wiring it into
# ~/.claude with the install.sh in its own repo.
#
# Each tool is installed on its own. One that fails leaves the other six
# installed and shows up by name in the summary, because the failure this
# suite exists to catch is the one that finishes quietly and looks like it
# worked.
#
# Dry run by default. Only `./install.sh --apply` installs anything.

set -euo pipefail

# In the order the landing page suggests: the two that pay for themselves the
# first day, then the rest.
TOOLS=(faro capitaneria boa plancia dogana paratia vedetta)
ORIGIN="https://github.com/nerln"

APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help)
      cat <<EOF
usage: ./install.sh [--apply]

Installs the seven tools of the port that ship as commands:
${TOOLS[*]}

rada is not published yet. varo is not a command, it is a hook, a skill and an
agent, so it is installed from its own repo with ./install.sh there.

Without --apply it prints what it would do and installs nothing.
EOF
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      echo "usage: ./install.sh [--apply]" >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v pipx >/dev/null 2>&1; then
  cat >&2 <<'EOF'
pipx is not on your PATH, and everything below is installed through it.

  macOS      brew install pipx && pipx ensurepath
  elsewhere  python3 -m pip install --user pipx && python3 -m pipx ensurepath

Open a new shell after that, so the PATH change takes, then run this again.
Nothing was installed.
EOF
  exit 1
fi

# pipx builds each venv with the interpreter it was installed under, and every
# tool here needs 3.10 or newer. Installing pipx with the python that ships with
# macOS gets you 3.9, and then all seven fail one after another with the same
# message about a different Python. Asked once, up front, so that arrives as one
# sentence instead of seven stack traces.
PIPX_PYTHON="$(pipx environment --value PIPX_DEFAULT_PYTHON 2>/dev/null || true)"
if [ -n "$PIPX_PYTHON" ] && [ -x "$PIPX_PYTHON" ]; then
  if ! "$PIPX_PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    cat >&2 <<EOF
pipx builds its environments with $PIPX_PYTHON,
which is $("$PIPX_PYTHON" -V 2>&1). These tools need Python 3.10 or newer, so every
one of them would fail with the same message.

Point pipx at a newer interpreter and try again:

  pipx install --python /path/to/python3.12 ...

or install pipx itself under a newer Python. On macOS, 'brew install pipx' picks
one up on its own. Nothing was installed.
EOF
    exit 1
  fi
fi

# Where pipx will put the commands. It honours these two variables, so a test
# run can point them at a throwaway folder and leave a real PATH alone.
BIN_DIR="${PIPX_BIN_DIR:-$HOME/.local/bin}"

# Asked once. Calling pipx per tool to find this out would be seven subprocesses
# for one answer.
ALREADY="$(pipx list --short 2>/dev/null | cut -d' ' -f1 || true)"

installed=()
present=()
failed=()

if [ "$APPLY" = "1" ]; then
  echo "Installing the port with pipx."
else
  echo "Dry run. Nothing will be installed."
fi
echo "  commands go to $BIN_DIR"
echo

for tool in "${TOOLS[@]}"; do
  url="$ORIGIN/$tool"

  if printf '%s\n' "$ALREADY" | grep -qxF "$tool"; then
    echo "  $tool: already installed, left as it is"
    present+=("$tool")
    continue
  fi

  if [ "$APPLY" != "1" ]; then
    echo "  $tool: pipx install git+$url"
    continue
  fi

  echo "  $tool: installing from git+$url"
  if ! pipx install "git+$url"; then
    echo "  $tool: pipx could not install it"
    failed+=("$tool: pipx install failed")
    continue
  fi

  # pipx reports success for a package that exposes no command, and a package
  # with no command is a tool you cannot run. So the install is not believed
  # until the command is there.
  if [ ! -x "$BIN_DIR/$tool" ]; then
    echo "  $tool: pipx installed the package and no command called $tool appeared"
    failed+=("$tool: installed, but no command called $tool in $BIN_DIR")
    continue
  fi

  installed+=("$tool")
done

echo
echo "Summary"

if [ "$APPLY" != "1" ]; then
  echo "  $(( ${#TOOLS[@]} - ${#present[@]} )) to install, ${#present[@]} already there. Nothing was installed."
  echo "  Run ./install.sh --apply to do it."
  exit 0
fi

if [ ${#installed[@]} -gt 0 ]; then
  echo "  installed      ${installed[*]}"
fi
if [ ${#present[@]} -gt 0 ]; then
  echo "  already there  ${present[*]}"
fi
if [ ${#failed[@]} -gt 0 ]; then
  for line in "${failed[@]}"; do
    echo "  FAILED         $line"
  done
fi

working=$(( ${#installed[@]} + ${#present[@]} ))
echo "  $working of ${#TOOLS[@]} usable, ${#failed[@]} failed"

echo
if [ -x "$BIN_DIR/capitaneria" ]; then
  echo "Run capitaneria first. It is the roll call of the whole port: which tools answer,"
  echo "which have something running, which have uncommitted work."
  echo
  echo "  capitaneria"
else
  echo "capitaneria is the one to run first, and it is not installed."
fi

if ! printf '%s' ":$PATH:" | grep -qF ":$BIN_DIR:"; then
  echo
  echo "$BIN_DIR is not on your PATH yet. Run 'pipx ensurepath' and open a new shell."
fi

# A partial install that exits 0 is the defect this suite was written against,
# so the count above is backed by the exit code.
if [ ${#failed[@]} -gt 0 ]; then
  echo
  echo "Run this again once the failures above are dealt with. It skips whatever is"
  echo "already installed."
  exit 1
fi
