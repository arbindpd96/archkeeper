# Proves the demo pipeline end to end: the packed CLI, installed for a copy of the fixture, answers.
# A Wait that times out fails the render, so a broken CLI fails the demo-gifs workflow.
# fixture: ts-app
Type "{{brand.binName}} --version"
Enter
Wait+Screen /\d+\.\d+\.\d+/
Sleep 1s
Type "{{brand.binName}} --help"
Enter
Wait+Screen /Usage:/
Sleep 2s
