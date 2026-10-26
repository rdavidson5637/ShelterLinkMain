# Questions for Ryan

Agents add questions here instead of stopping. Newest at the bottom.

## C1 (Claude Code) - input border colour

The brief's `--rule-strong` (#B9B2A1) is 2.0:1 against `--surface`. WCAG 1.4.11 asks for 3:1 on form
control edges. I added one token, `--field-border: #8F8877` (3.4:1 on surface, 3.2:1 on paper), and use
it only for input, select and textarea borders. `--rule-strong` still draws the table header rule as the
brief says. OK to keep, or do you want the brief value back?

## C1 (Claude Code) - logged-in pages not checked

The login page shows no demo accounts, so C1 was checked on public pages and a scratch fixture of the
new components only. If there are demo logins agents may use, please add them here.
