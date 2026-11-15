# repo
# Works with Superpowers and Spec Kit: --with answers init's offer in a scripted run, so the tape answers no
# prompt (on the CI renderer, output after a keypress answering a prompt stalled; see docs/mistakes.md). init
# records the choice in its config and prints each tool's exact install commands under Next steps, then Spec Kit's
# warning to commit first, since specify init --here may replace files; it installs and downloads nothing. The
# fixture copy is a git repository, so init warns about nothing. Its 22 lines and the shell's prompt fill the frame's
# 23 rows, so clear takes the typed line off first; the warning, the last line, is 98 of the frame's 100 columns.
# fixture: ts-app
Type "clear && {{brand.binName}} init --yes --with superpowers,speckit"
Sleep 800ms
Enter
Wait+Screen /help before --force/
Sleep 8s
