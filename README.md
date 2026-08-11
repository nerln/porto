# porto

The landing page for the suite: https://nerln.github.io/porto

One self-contained HTML file, no build step, no dependencies, no external requests.
Every number on it was measured on the machine, not estimated.

`install.sh` installs the seven tools of the suite that ship as commands, each one
on its own, and names the ones that did not install instead of finishing quietly.
It prints what it would do and installs nothing until you pass `--apply`.

```bash
./install.sh
./install.sh --apply
```

rada is not published yet. varo is not a command, so it is installed from its own
repo by wiring it into `~/.claude`.
