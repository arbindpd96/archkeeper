# hero
# repo
# Quick start: init detects the stack and its tools, shows the plan and writes the setup; then the AGENTS.md it
# wrote, with the project's own commands. Paced to be read: the plan stays up 10 s and AGENTS.md 9 s, inside the
# 30 s hero cap. The fixture copy is a git repository, as a real project is, so init has nothing to warn about.
# The tape answers no prompt: on the CI renderer, output after a keypress answering a prompt stalled twice.
# fixture: ts-app
Set TypingSpeed 75ms
Type "{{brand.binName}} init --yes"
Sleep 800ms
Enter
Wait+Screen /Next steps/
Sleep 10s
Type "clear && head -n 23 AGENTS.md"
Sleep 600ms
Enter
Wait+Screen /npm run format/
Sleep 9s
