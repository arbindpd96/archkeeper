# live
# Decisions: init writes the decision log, the ADR template and the /why and /adr skills; then, in Claude Code,
# /why answers from the project's own records and cites the fixture's ADR by path and line.
# fixture: ts-app
Type "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 2s
Type "clear && claude"
Enter
Sleep 6s
Type "/why do we test with Vitest"
Enter
Wait+Screen@90s /0001-run-tests-with-vitest\.md:\d+/
Sleep 5s
