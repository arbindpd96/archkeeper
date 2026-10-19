# live
# repo
# Tests before done: init --stop-check turns on the full preset's stop check with pytest, which py-app's
# pyproject.toml names. In Claude Code, Claude changes greet() so tests/test_greet.py fails and says it is done; the
# stop check runs pytest and blocks with its failure, and Claude fixes the test before its FIXED: line. A fixture copy
# has no .venv, so the hook runs pytest from the recording machine's PATH; acceptEdits lets Claude edit without a
# prompt. The GIF may run 30 s, so the tape waits on Claude Code's screen instead of sleeping; check each pattern
# when recording, and that Claude does not first ask which feature the session is for.
# fixture: py-app
Type "{{brand.binName}} init --yes --preset full --stop-check"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type "In src/py_app/__init__.py only, make greet() shout the name in capitals, run nothing, and end with DONE:. If the stop check then fails, fix what it reports and end with a line FIXED:"
Enter
Wait+Screen@120s /AssertionError|FAILED/
Wait+Screen@120s /FIXED: \S/
Sleep 3s
