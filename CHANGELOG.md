# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-07-23

### Fixed

- On some Linux systems (WebKitGTK 2.42+ with certain GPU/driver combinations,
  notably under Wayland), the app window opened as a blank grey screen because
  WebKitGTK's DMA-BUF renderer failed to initialise EGL. The renderer is now
  disabled on Linux at startup, unless `WEBKIT_DISABLE_DMABUF_RENDERER` is
  already set in the environment.

## [0.1.4] - 2026-07-22

### Fixed

- A crash while progress was being saved could leave the user database empty,
  and the next launch would silently start fresh — permanently losing all
  cards, review history and saved lists. Saves are now atomic (written to a
  temporary file and renamed into place), every successful launch keeps a
  last-good backup snapshot (`euouae.sqlite3.bak`), and a missing or corrupt
  database is restored from that backup instead of being replaced with an
  empty one. If no backup exists, the app preserves the unreadable file as
  `euouae.sqlite3.corrupt` and reports the problem rather than wiping data.

## [0.1.3] - 2026-07-04

### Fixed

- Importing a large word list (e.g. tens of megabytes) into the custom lexicon
  builder no longer freezes the app. Imported files are kept out of the on-screen
  text box and are no longer re-scanned on every keystroke; a summary card is
  shown instead. Any words dropped for using letters outside the chosen tile set
  are reported after the build.

## [0.1.2] - 2026-07-03

### Added

- A saved tile-set ("alphabet") library: custom tile sets can now be created,
  edited, renamed, imported and exported independently of any single lexicon,
  via a new "Manage tile sets" dialog in the command palette. The lexicon
  builder saves into and loads from the same library.

### Changed

- Removed the file-size limits on lexicon word-list and progress-backup
  imports.

## [0.1.1] - 2026-07-03

### Added

- Light and dark colour schemes with an appearance picker in the topbar: three
  dark themes (Night Board, Onyx, Nocturne) and two light themes (Parchment,
  Daylight). The choice persists across sessions and is applied before first
  paint, so switching never flashes. First-run users follow their OS light/dark
  preference until they pick one.

### Changed

- Full-screen Word Judge now matches Zyzzyva's input: type one word per line
  (Enter starts a new line) and press Tab to check the whole play. Typed words
  are left-aligned.

## [0.1.0] - 2026-07-03

- Initial release.

[0.1.3]: https://github.com/macaquedev/euouae/releases/tag/v0.1.3
[0.1.2]: https://github.com/macaquedev/euouae/releases/tag/v0.1.2
[0.1.1]: https://github.com/macaquedev/euouae/releases/tag/v0.1.1
[0.1.0]: https://github.com/macaquedev/euouae/releases/tag/v0.1.0
