# hero
# Quick start: init previews its plan as a diff, then asks for a preset, shows the plan, warns about the
# missing git repository, asks for a yes, and writes CLAUDE.md, AGENTS.md and the ignore rules.
# fixture: ts-app
Type "{{brand.binName}} init --dry-run"
Enter
Wait+Screen /Choose a preset/
Sleep 1s
Enter
Wait+Screen /Dry run: nothing was written/
Sleep 2s
Type "clear && {{brand.binName}} init"
Enter
Wait+Screen /Choose a preset/
Sleep 1s
Enter
Wait+Screen /Continue anyway/
Sleep 2s
Type "y"
Wait+Screen /Apply this plan/
Sleep 1s
Enter
Wait+Screen /Next steps/
Sleep 2s
Type "clear && cat CLAUDE.md"
Enter
Wait+Screen /Claude Code reads/
Sleep 3s
