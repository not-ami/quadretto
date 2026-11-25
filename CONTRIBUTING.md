# Contributing to Quadretto

Thanks for your interest! Quadretto is maintained by one person in their spare time, so replies may take a while.

## Issues

Bug reports and ideas are welcome. For a bug, please include: device and browser (for example iPad Air, Safari 26),
what you did, what you expected, what happened, and a screenshot if it helps.

## Pull requests

- **Contributor License Agreement.** Every pull request needs the [CLA](CLA.md), signed once through the CLA
  Assistant check that appears on your first pull request. You keep the copyright on your work. The CLA lets the
  maintainer license your contribution under any terms, including commercial ones, and commits the maintainer to
  also keep it available under the project's licence at the time you send it (today the AGPL-3.0). Without a signed
  CLA a pull request cannot be merged.
- Contributing as part of your job, or on behalf of a company? Get your employer's approval first, and open an issue
  before the pull request so we can arrange an agreement for the company.
- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Keep the style of the code around you: plain JavaScript, no build step, no new dependencies without a good reason.
- **Never do work on the main thread while the pen is writing** (see `penQuiet()` in `public/js/app.js`): it is what
  keeps the ink fast.
- Run the tests (`cd server && npm test`, see the README) and try your change on an iPad if it touches handwriting.
- Interface text is in English and Italian: wrap new text in `t()` (see `public/js/i18n.js`; the key is the Italian
  text) and add the English line to `public/js/lang/en.js`.

## Contributions you do not fully own

If part of a pull request is not your own work (code copied or adapted from another project, a snippet, an image, a
font), say so in the pull request description: where it comes from, who holds the copyright and under which licence.
Do not mix it in silently. Material whose licence is not compatible with the AGPL-3.0 cannot be accepted.

The maintainer reviews every pull request by hand and may decline changes that do not fit the project.
