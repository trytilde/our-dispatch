# OpenBot runs agent Bash tools as login shells with HOME=/workspace/<agent-id>, so this
# file is loaded before every command. Put agent-specific environment and shell
# setup here. Keep secrets out of authored workspace files.

# Also honor an optional interactive-shell configuration maintained by the
# agent or owner.
if [ -f "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi
