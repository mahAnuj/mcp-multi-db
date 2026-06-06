# VHS tape — regenerate the README demo GIF:
#   npm run build && vhs examples/demo.tape
# Produces docs/demo.gif. Requires vhs (https://github.com/charmbracelet/vhs).
Output docs/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1080
Set Height 820
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Sleep 600ms
Type "node examples/demo.mjs"
Sleep 700ms
Enter
Sleep 13s
