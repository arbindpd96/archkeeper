# live
# repo
# Architecture map: init seeds docs/architecture.md, its folder table from git ls-files, and installs /update-map;
# then, in Claude Code, Claude adds a module folder and /update-map adds its row to the map's Layout table. The
# fixture copy is a git repository with one commit, so the seeded table lists its folders; acceptEdits lets Claude
# write the module and the map without a prompt, and the skill's allowed-tools let it run git ls-files. The GIF may
# run 30 s, so the tape waits on Claude Code's screen instead of sleeping; check each pattern when recording, and
# that Claude does not first ask which feature the session is for, which session-start asks while none is active.
# fixture: ts-app
Type "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 1s
Type "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type "Add src/billing/total.ts exporting total(prices: number[]), then run /update-map"
Enter
Wait+Screen@120s /`src\/billing\/` \|/
Sleep 3s
