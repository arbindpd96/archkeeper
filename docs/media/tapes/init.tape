# hero
# repo
# Quick start: init detects the stack and its tools, shows the plan and writes the setup; then the Commands
# table it wrote into AGENTS.md from the project's own scripts. Paced to be read: the plan stays up 10 s and
# the table 7 s, inside the 30 s hero cap, and each screen fits the frame without scrolling. The fixture copy
# is a git repository, as a real project is, so init has nothing to warn about.
# The tape answers no prompt: on the CI renderer, output after a keypress answering a prompt stalled twice.
# fixture: ts-app
Set TypingSpeed 75ms
Type "{{brand.binName}} init --yes"
Sleep 800ms
Enter
Wait+Screen /Next steps/
Sleep 10s
Type "clear && grep -A 7 '## Commands' AGENTS.md"
Sleep 600ms
Enter
Wait+Screen /npm run format/
Sleep 7s
