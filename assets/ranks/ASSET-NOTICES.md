# Slippi rank artwork: source and attribution

The rank badge SVGs imported by `scripts/import-rank-assets.mjs` come from:

- Project: [Project Slippi / slippi-launcher](https://github.com/project-slippi/slippi-launcher)
- Source directory: `src/renderer/styles/images/ranks/`
- Upstream revision: `ce24cae3ed508c279c1848b8853b688946990c17`
- Upstream change: [slippi-launcher PR #570 — Displays your current Rank and MMR](https://github.com/project-slippi/slippi-launcher/pull/570)
- Initial rank-artwork commit in that PR: [`c3f26d3` — add ranked images](https://github.com/project-slippi/slippi-launcher/commit/c3f26d3)
- Repository license: GPL-3.0 (see the upstream `LICENSE` file copied into this directory by the import script)

The Launcher repository identifies itself as GPL v3. The rank artwork was added to
that repository as part of PR #570. This project preserves the upstream SVGs
under `source-svg/` and generates 128 × 128 transparent PNG derivatives under
`png/` for Discord application emojis. The SVGs are retained unchanged; the PNGs
are mechanically resized/rasterized for the Discord emoji upload requirements.

**Attribution:** Rank badge artwork reproduced from Project Slippi's
`slippi-launcher` repository, `src/renderer/styles/images/ranks/`, at the pinned
revision above. The rank-image addition is recorded in PR #570 and commit
`c3f26d3` by `vinceau`. This project does not claim authorship or ownership of
the original artwork. See `UPSTREAM-LICENSE-GPL-3.0.txt` for the upstream
license text and preserve any additional notices in the original SVG files.

The import script includes all 19 ranked tiers, the Slippi `Unranked1` art for
our `Unranked` state, and the Slippi `Unranked3` art for our `Pending` state.
The separate `Unranked2` art is not imported because this bot does not model
Slippi's banned-account state.

This notice records provenance and the repository-level license. It is not a
substitute for retaining any more specific copyright or license notice present
in an individual upstream asset. Review the downloaded SVG headers and
upstream `LICENSE` before committing the imported artwork.
