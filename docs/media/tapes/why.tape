# live
# Decisions: init writes the decision log, the ADR template and the /why and /adr skills; then, in Claude Code,
# /why answers from the project's own records and cites the fixture's ADR by path and line. The GIF may run 20 s,
# so the tape waits on Claude Code's prompt instead of sleeping; check the prompt's text when recording.
# fixture: ts-app
Type "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type "clear && claude"
Enter
Wait+Screen /for shortcuts/
Type "/why do we test with Vitest"
Enter
Wait+Screen@90s /0001-run-tests-with-vitest\.md:\d+/
Sleep 3s
