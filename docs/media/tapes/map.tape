# live
# repo
# Architecture map: init seeds docs/architecture.md, its folder table from git ls-files, and installs /update-map.
# The shell then adds a billing module, so Claude's part is the skill alone: /update-map adds the module's row to the
# map's Layout table. The fixture copy is a git repository with one commit, so the seeded table lists its folders;
# acceptEdits lets Claude edit the map without a prompt, the skill's allowed-tools let it run git ls-files, and
# format-on-edit leaves the map's Markdown alone, so it shows no hint about the copy's missing prettier and eslint.
# Every line types at 10 ms a key, and a short pause after init lets its process exit and the prompt return, so no
# key echoes into its output. Before Claude Code starts, the screen holds the typed init line, init's 19 lines, the
# one-row shell step and the next prompt: 22 of the frame's 23 rows, or 23 where init's first line, the copy's path
# under macOS's /private, wraps. The GIF may run 30 s, so the tape waits on Claude Code's screen instead of sleeping;
# check each pattern when recording, and that Claude does not first ask which feature the session is for, which
# session-start asks while none is active.
# fixture: ts-app
Type@10ms "{{brand.binName}} init --yes"
Enter
Wait+Screen /Next steps/
Sleep 300ms
Type@10ms "mkdir src/billing && echo 'export const total = 0;' > src/billing/total.ts"
Enter
Type@10ms "clear && claude --permission-mode acceptEdits"
Enter
Wait+Screen /for shortcuts/
Type@10ms "/update-map"
Enter
Wait+Screen@120s /`src\/billing\/` \|/
Sleep 3s
