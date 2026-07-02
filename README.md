<p align="center">
  <img src="src-tauri/icons/128x128.png" width="88" alt="euouae logo">
</p>

# euouae

A fast, keyboard-first study and word-adjudication tool for tournament Scrabble
players — an offline replacement for Collins Zyzzyva. (Named after *EUOUAE*, a
legal all-vowel word.)

- **Judge** — instantly check whether words are valid.
- **Search** — query the lexicon by pattern, anagram, hooks, length, probability, and more.
- **Word Info** — definitions, hooks, anagrams, and stats for any word.
- **Quiz + Cardbox** — spaced-repetition study (Leitner and FSRS) that mirrors Zyzzyva's schedule.
- **Lists** — build and manage your own study lists.

Ships with the **CSW24**, **NWL23**, and **FRA24** lexicons and works fully offline.

## Download

Get the latest installers from the **[Releases page](https://github.com/macaquedev/euouae/releases/latest)**,
then pick the file for your platform:

| Platform | File | Notes |
|---|---|---|
| **Windows** 10/11 (64-bit) | `euouae_<version>_x64-setup.exe` | Installs for your user only, no admin needed (goes to `AppData\Local`) |
| **Windows** 10/11 (64-bit) | `euouae_<version>_x64_en-US.msi` | System-wide install to `Program Files` (needs admin) |
| **macOS** (Intel & Apple Silicon) | `euouae_<version>_universal.dmg` | Universal build |
| **Linux** (any distro) | `euouae_<version>_amd64.AppImage` | Portable — nothing to install |
| **Linux** — Debian/Ubuntu | `euouae_<version>_amd64.deb` | |
| **Linux** — Fedora/RHEL/openSUSE | `euouae-<version>-1.x86_64.rpm` | |

> **Heads-up:** the app isn't code-signed yet, so Windows and macOS will show a
> security warning the first time you open it. This is expected — the steps
> below tell you how to get past it.

## Install

### Windows

1. Download the `-setup.exe` (simplest) or the `.msi`.
2. Run it. If you see **"Windows protected your PC"**, click **More info → Run anyway**
   — this only appears because the app isn't signed.
3. Launch **euouae** from the Start menu.

### macOS

1. Open the `.dmg` and drag **euouae** into your **Applications** folder.
2. The first launch is blocked because the app isn't notarized. To allow it,
   open **Terminal** and run:
   ```sh
   xattr -dr com.apple.quarantine /Applications/euouae.app
   ```
3. Open **euouae** from Applications or Launchpad.

### Linux

**AppImage** (works on any distribution):

```sh
chmod +x euouae_<version>_amd64.AppImage
./euouae_<version>_amd64.AppImage
```

If it won't start, install FUSE (e.g. `sudo apt install libfuse2` on Debian/Ubuntu).

**Debian / Ubuntu** (`.deb`):

```sh
sudo apt install ./euouae_<version>_amd64.deb
```

**Fedora / RHEL / openSUSE** (`.rpm`):

```sh
sudo dnf install ./euouae-<version>-1.x86_64.rpm
```

## Building from source

Requires [Bun](https://bun.sh) and the [Rust toolchain](https://rustup.rs), plus
Tauri's [system dependencies](https://tauri.app/start/prerequisites/).

```sh
bun install
bun run tauri dev     # run in development
bun run tauri build   # build installers for your current OS
```
