# live
# repo
# Tests before done: init --stop-check turns on the full preset's stop check with pytest, which py-app's
# pyproject.toml names. In Claude Code, Claude changes greet() so tests/test_greet.py fails and says it is done; the
# stop check runs pytest and blocks with its failure, and Claude updates the test before its FIXED: line. A fixture
# copy has no .venv, so the hook runs pytest from the recording machine's PATH; acceptEdits lets Claude edit without a
# prompt. Every line types at 10 ms a key and the last frame holds 2 s, since Claude takes two turns of a read and an
# edit each. The GIF may run 30 s, so the tape waits on Claude Code's screen instead of sleeping; check each pattern
# when recording, and that Claude does not first ask which feature the session is for.
# fixture: py-app
Type@10ms "{{brand.binName}} init --yes --preset full --stop-check"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type@10ms "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type@10ms "In src/py_app/__init__.py only, make greet() shout in capitals, run nothing and say DONE. If the stop check then fails, update the test and end with one line that starts with FIXED:, saying what you changed"
Enter
Wait+Screen@120s /AssertionError|FAILED/
Wait+Screen@120s /FIXED: \S/
Sleep 2s
