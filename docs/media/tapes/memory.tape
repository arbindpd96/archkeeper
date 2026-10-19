# live
# Feature memory: init installs the memory hooks and /new-feature. In Claude Code, /new-feature starts a feature's
# MEMORY.md and makes it the active feature; /compact runs pre-compact, which saves a snapshot, and then
# session-start injects the memory again, so the first answer after compaction resumes at the recorded Next step.
# acceptEdits lets /new-feature write its two files without a prompt, and the fixture is no git repository, so it
# offers no branch: keep it so, or the tape stops at that question. The GIF may run 30 s, so the tape waits on
# Claude Code's screen instead of sleeping; check each pattern when recording.
# fixture: ts-app
Type "{{brand.binName}} init --yes --preset small"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type "/new-feature greet-shout: done means greet() can shout the name in capitals"
Enter
Wait+Screen@120s /Next step/
Type "/compact"
Enter
Wait+Screen@180s /Compacted/
Type "In one line that starts with RESUME:, where do we resume?"
Enter
Wait+Screen@90s /RESUME: \S/
Sleep 3s
