<p align="center">
  <img src="src-tauri/icons/128x128.png" width="88" alt="euouae logo">
</p>

# euouae

**euouae** is a study and word-checking app for competitive Scrabble and word-game
players. It's a fast, offline alternative to Collins Zyzzyva — the tool many
tournament players use to look words up and drill them into memory. (The name is
*EUOUAE*, a real word made entirely of vowels.)

## What you can do

- **Judge words instantly.** Type in one or more words and euouae tells you which
  are valid in the dictionary you've chosen — the same job a tournament word
  judge does at the board.
- **Search for words** by almost any criterion: a letter pattern, an anagram
  (which words a jumble of letters can spell), word length, the *hooks* a word
  takes (letters you can add to the front or back to make another valid word),
  how likely you are to draw it, and more.
- **Look up any word** to see its definition, its anagrams, the hooks it takes,
  and other study stats.
- **Practise with spaced repetition.** Quiz yourself and the app brings each word
  back just as you're about to forget it, so your time goes to the words you
  don't yet know cold. Two study systems are built in:
  - **Cardbox** — the classic flashcard-box method (words you keep getting right
    come up less often; ones you miss come back sooner). It's the same system
    Zyzzyva uses, so if you're coming from Zyzzyva your routine and progress
    carry straight over.
  - **FSRS** — a modern scheduling algorithm that learns how well *you*
    personally remember each word and picks the best moment to review it.
- **Build and manage word lists**, import them from a file, and export them in
  several formats (plain word lists, anagram question-and-answer sheets, and more).

## What makes it different

- **Bring your own word lists.** You're not limited to the built-in dictionaries.
  Paste a list of words (or import a file) and euouae builds a complete, studyable
  lexicon from it in seconds — automatically working out every word's anagrams,
  hooks, point values, and draw odds. Great for a club list, a themed set, or a
  list of tricky words you keep missing.
- **Any language, or your own tiles.** Pick a built-in letter set — English,
  Spanish, French, German, or Russian — or define your own tiles from scratch
  (each letter's point value, how many are in the bag, and how many blanks). So
  you can study in another language or under house rules, not just standard
  English Scrabble.
- **Several dictionaries, switch anytime.** Comes with Collins **CSW24**, the
  North American **NWL23**, and French **FRA24** built in.
- **Fully offline and fast.** Everything lives on your device — no account and no
  internet needed once it's installed — and it's built to be quick and
  keyboard-driven.
- **Free and cross-platform.** Runs on Windows, macOS, and Linux.

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
