# hero
# Quick start: init detects the stack, shows the plan, warns about the missing git repository and writes
# CLAUDE.md, AGENTS.md and the ignore rules; then the new CLAUDE.md.
# The tape answers no prompt: on the CI renderer, output after a keypress answering a prompt stalled twice.
# fixture: ts-app
Type "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 3s
Type "clear && cat CLAUDE.md"
Enter
Wait+Screen /Claude Code reads/
Sleep 3s
