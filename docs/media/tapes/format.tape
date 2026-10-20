# live
# repo
# Format on edit: init records ruff, which py-app's pyproject.toml names, as the formatter and linter format-on-edit
# runs. In Claude Code, Claude writes an unformatted src/py_app/shout.py with an unused variable: the hook formats it
# with ruff format, ruff check --fix cannot remove the variable safely, and its F841 report goes back to Claude, which
# fixes the file before its DONE: line. A fixture copy has no .venv, so the hook runs ruff from the recording
# machine's PATH; acceptEdits lets Claude write without a prompt. The GIF may run 30 s, so the tape waits on Claude
# Code's screen instead of sleeping; check each pattern when recording, and that Claude does not first ask which
# feature the session is for, which session-start asks while none is active.
# fixture: py-app
Type "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type "Write src/py_app/shout.py as def shout(name): unused = 1; return name.upper(), then a line DONE:"
Enter
Wait+Screen@120s /F841/
Wait+Screen@120s /DONE: \S/
Sleep 3s
