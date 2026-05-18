# Vriddhi — Personal Finance Tracker

> **"Track the growth. Keep the privacy."**
>
> Local-first Indian mutual fund tracker. No cloud. No subscriptions. No third-party data storage. Everything runs on your machine.

---

## Table of Contents

1. [Installation — Windows](#installation--windows)
2. [Installation — macOS](#installation--macos)
3. [First-Time Setup](#first-time-setup)
4. [Daily Use](#daily-use)
5. [Upgrading to a New Version](#upgrading-to-a-new-version)
6. [Troubleshooting](#troubleshooting)
7. [Your Data](#your-data)

---

## Installation — Windows

### Prerequisites (one time only)

#### 1. Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS version** (left button)
3. Install with all defaults
4. Verify in Command Prompt:

```
node --version
npm --version
```

Both should print version numbers. If not, restart your computer and try again.

#### 2. Poppler (required for CAS PDF upload)

1. Go to [https://github.com/oschwartz10612/poppler-windows/releases](https://github.com/oschwartz10612/poppler-windows/releases)
2. Download the latest **Release-xx.xx.x.zip**
3. Extract to `C:\poppler`
4. Add to Windows PATH:
   - Start → search **"Environment Variables"** → click **"Edit the system environment variables"**
   - Click **Environment Variables** → under **System variables** find **Path** → click **Edit**
   - Click **New** → type `C:\poppler\Library\bin`
   - Click **OK → OK → OK**
5. Open a **new** Command Prompt and verify:

```
pdftotext -v
```

Should print version info. If you see an error, the PATH entry was not saved correctly — repeat step 4.

---

### Install the App (one time only)

#### Step 1 — Enable PowerShell scripts

1. Click Start → search **PowerShell**
2. Right-click → **Run as Administrator**
3. Run:

```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

4. Type `Y` → Enter → close this window

#### Step 2 — Get the app files

1. Go to [https://github.com/SubbaraoKommuri/Vriddhi](https://github.com/SubbaraoKommuri/Vriddhi)
2. Click the green **Code** button → **Download ZIP**
3. Extract to `C:\Vriddhi`

> ⚠️ **Do NOT place the folder inside:**
> - `C:\Program Files\` — protected system folder, causes permission errors
> - Any OneDrive-synced folder — causes database file locking errors
>
> Always use a plain path like `C:\Vriddhi`

#### Step 3 — Install dependencies

Open Command Prompt inside `C:\Vriddhi`:
- Click the folder address bar → type `cmd` → press Enter

```
npm install
```

Wait for it to finish. Warnings about deprecated packages are normal — ignore them.

> ⚠️ If you see a `better-sqlite3` or `node-gyp` error, install Visual Studio Build Tools:
> Go to [https://visualstudio.microsoft.com/downloads/](https://visualstudio.microsoft.com/downloads/)
> → **Tools for Visual Studio** → **Build Tools for Visual Studio**
> → check **"Desktop development with C++"** → install → then re-run `npm install`

#### Step 4 — Create the startup shortcut

1. Right-click inside `C:\Vriddhi` → **New** → **Text Document**
2. Rename it to `start.bat` (make sure file extensions are visible — it must not be `start.bat.txt`)
3. Open with Notepad and paste:

```bat
@echo off
cd /d %~dp0
start http://localhost:3000
npm run dev
```

4. Save and close

#### Starting the app

| Action | How |
|---|---|
| Start | Double-click `start.bat` |
| Open | Browser opens automatically at http://localhost:3000 |
| Stop | Close the black Command Prompt window |

---

## Installation — macOS

### Prerequisites (one time only)

#### 1. Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS version** — the macOS installer is a `.pkg` file
3. Open and install with all defaults
4. Verify in Terminal (Spotlight → `Terminal`):

```bash
node --version
npm --version
```

> **Alternative using Homebrew:**
> ```bash
> brew install node
> ```

#### 2. Poppler (required for CAS PDF upload)

**Using Homebrew (recommended):**

```bash
brew install poppler
```

**Without Homebrew:**

1. Go to [https://poppler.freedesktop.org](https://poppler.freedesktop.org)
2. Download the latest release and build per the included instructions

Verify either way:

```bash
pdftotext -v
```

---

### Install the App (one time only)

#### Step 1 — Get the app files

1. Go to [https://github.com/SubbaraoKommuri/Vriddhi](https://github.com/SubbaraoKommuri/Vriddhi)
2. Click the green **Code** button → **Download ZIP**
3. Extract and move the folder to a permanent location, for example:

```
/Users/yourname/Vriddhi
```

> ⚠️ **Do NOT place the folder inside:**
> - `/Applications/` — can cause permission issues
> - Any iCloud Drive or Dropbox-synced folder — causes database file locking errors

#### Step 2 — Install dependencies

Open Terminal and navigate to the folder:

```bash
cd /Users/yourname/Vriddhi
npm install
```

Wait for it to finish. Warnings about deprecated packages are normal — ignore them.

> ⚠️ If you see a `better-sqlite3` or `node-gyp` error, run:
> ```bash
> xcode-select --install
> ```
> Then re-run `npm install`

#### Step 3 — Create the startup script

1. Inside the `Vriddhi` folder, create a file named `start.sh`
2. Open with any text editor and paste:

```bash
#!/bin/bash
cd "$(dirname "$0")"
open http://localhost:3000
npm run dev
```

3. Save, then make it executable — run once in Terminal:

```bash
chmod +x /Users/yourname/Vriddhi/start.sh
```

#### Step 4 (optional) — Create a desktop shortcut

1. Open **Automator** (Spotlight → `Automator`)
2. Choose **Application** → **New Document**
3. Search for **Run Shell Script** and drag it to the workflow
4. Paste: `/Users/yourname/Vriddhi/start.sh`
5. File → Save → name it `Vriddhi` → save to Desktop

#### Starting the app

| Action | How |
|---|---|
| Start (Terminal) | `cd ~/Vriddhi && ./start.sh` |
| Start (shortcut) | Double-click the `Vriddhi` app on Desktop |
| Open | Browser opens automatically at http://localhost:3000 |
| Stop | Press `Ctrl + C` in the Terminal window |

---

## First-Time Setup

Complete these steps **in order** after starting the app for the first time. Each step takes 1–5 minutes.

---

### Step 1 — Import your CAS (Consolidated Account Statement)

Your CAS is the source of all your fund and transaction data. Everything else depends on this first import.

**How to get your CAS from CAMS:**

1. Go to [https://www.camsonline.com](https://www.camsonline.com)
2. MF Services → Statement of Account → Consolidated Account Statement
3. Choose **Detailed** statement with **All time** period
4. Submit — CAMS will email the password-protected PDF to your registered email address

**How to import it into Vriddhi:**

1. Open Vriddhi → click **CAS Import** in the left sidebar
2. Drag and drop your CAS PDF onto the upload area, or click to browse and select the file
3. Enter the PDF password in the **CAS PASSWORD** field (leave blank if the PDF has no password)
4. Click **Parse & Preview** — Vriddhi will parse and validate the PDF without writing anything to the database
5. Review the summary: total folios, schemes, and transactions detected
6. If the summary looks correct, click **Confirm Import**

> The import is safe to re-run at any time. Duplicate transactions are automatically skipped — existing data is never overwritten.

---

### Step 2 — Refresh AMFI Codes

AMFI codes link your funds to their official NAV data feed. This step is required before NAV history can be fetched.

1. Stay on the **CAS Import** page — scroll to the **Data Maintenance** section at the bottom
2. Click **Refresh AMFI Codes**
3. Wait for the confirmation message

> This calls the AMFI India public API and requires an internet connection. It typically completes in under a minute.

---

### Step 3 — Backfill NAV History

NAV history is what powers current value, gain, and XIRR calculations across the entire app.

1. On the same **CAS Import** page, in the **Data Maintenance** section
2. Click **Backfill NAV History**
3. Vriddhi will fetch the complete historical NAV data for every fund in your portfolio

**What happens behind the scenes:**
- Funds with no history → full historical backfill (from inception) via AMFI India
- Funds with partial history → incremental fill from the last known date
- Funds already up to date → skipped

> This may take 3–8 minutes on first run depending on the number of funds. Progress and errors are written to `logs/nav-YYYY-MM-DD.log`.

---

### Step 4 — Add Benchmarks

Benchmarks let you compare your portfolio XIRR against a market index. The **Performance** tab requires at least one benchmark.

1. Click **Benchmarks** in the left sidebar
2. Click **Add Benchmark**
3. Select the **Nifty TRI** tab
4. Choose an index from the catalogue (e.g. `Nifty 50`, `Nifty Midcap 150`, `Nifty 500`)
5. Click **Add** — Vriddhi fetches the full historical TRI data from niftyindices.com

> Add as many benchmarks as you like. Nifty 50 TRI is a good starting point for a diversified portfolio.

---

### Step 5 — Explore Your Dashboard

Once Steps 1–4 are complete, your Dashboard will show:

- Total invested, current value, and unrealised gain
- Portfolio growth chart vs your chosen benchmark
- Year-on-year investment trend with rolling average

The **Funds & Folios** tab shows per-fund XIRR, gain, and NAV details for all 34 active folios.
The **Performance** tab shows portfolio XIRR vs benchmark XIRR and alpha, broken down by tag group.

---

## Daily Use

### Refreshing NAV (each time you open the app)

Current value and XIRR figures are only as fresh as your NAV data. Refresh whenever you open the app after a gap of a day or more.

1. Click **Funds & Folios** in the sidebar
2. Click **Update NAVs** at the top right of the page
3. Vriddhi fetches only the missing dates — funds already up to date are skipped automatically

This typically completes in under 30 seconds for an established portfolio.

### Importing a new CAS (monthly or quarterly)

When you receive a new CAS PDF from CAMS:

1. Go to **CAS Import**
2. Import the new PDF exactly as in Step 1 of First-Time Setup
3. Only transactions added since your last import will be written — existing records are untouched
4. After confirming the import, click **Refresh AMFI Codes** and then **Backfill NAV History** in the Data Maintenance section to pick up any new funds

---

## Upgrading to a New Version

When a new version of Vriddhi is released on GitHub:

### Windows

1. Download the new ZIP from [https://github.com/SubbaraoKommuri/Vriddhi](https://github.com/SubbaraoKommuri/Vriddhi)
2. Extract to a **new folder** — for example `C:\Vriddhi-new`
3. Copy these two files from your **old folder** to the **new folder**:
   - `tracker.db` — all your data lives here
   - `.env.local` — your configuration
4. Open Command Prompt in the new folder and run:

```
npm install
```

5. Create `start.bat` in the new folder (same content as the original — see Step 4 of installation)
6. Double-click `start.bat` — done

You can delete the old folder once you have confirmed the new version is working correctly.

### macOS

1. Download the new ZIP from [https://github.com/SubbaraoKommuri/Vriddhi](https://github.com/SubbaraoKommuri/Vriddhi)
2. Extract to a **new folder** — for example `/Users/yourname/Vriddhi-new`
3. Copy these two files from your **old folder** to the **new folder**:
   - `tracker.db` — all your data lives here
   - `.env.local` — your configuration
4. Open Terminal and run:

```bash
cd /Users/yourname/Vriddhi-new
npm install
chmod +x start.sh
./start.sh
```

### What about my database?

The database schema upgrades automatically when the new version starts for the first time. You do not need to do anything. Vriddhi uses additive-only migrations — your existing portfolios, transactions, and history are never deleted or altered during an upgrade.

> ⚠️ Always copy `tracker.db` **before** running `npm install` in the new folder. Never work inside the old folder after starting the upgrade.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `scripts is disabled` error (Windows) | Run PowerShell as Administrator → `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` → type `Y` |
| `pdftotext not installed` error | Install Poppler and add to PATH (Windows) or run `brew install poppler` (macOS) — see Prerequisites |
| `better-sqlite3` or `node-gyp` error during `npm install` (Windows) | Install Visual Studio Build Tools → check **"Desktop development with C++"** → re-run `npm install` |
| `better-sqlite3` or `node-gyp` error during `npm install` (macOS) | Run `xcode-select --install` in Terminal → re-run `npm install` |
| App not opening in browser automatically | Manually go to [http://localhost:3000](http://localhost:3000) |
| App behaves oddly or database errors (Windows) | Confirm the folder is not inside OneDrive or Program Files |
| App behaves oddly or database errors (macOS) | Confirm the folder is not inside iCloud Drive or Dropbox |
| NAV update fails for some funds | Check `logs/nav-YYYY-MM-DD.log` for the specific fund and error message |
| CAS import fails with a parse error | Confirm the file is a CAMS Consolidated Account Statement (not a fund house statement or KFintech PDF) and that the password is correct |
| Benchmark data fetch fails | niftyindices.com occasionally times out — wait a few minutes and try again |
| XIRR shows a warning flag (⚠) | The XIRR value may be unreliable — this typically happens for funds with very short holding periods or very few transactions. The figure is still shown; use it with caution. |

---

## Your Data

`tracker.db` is your database. All portfolios, transactions, NAV history, and benchmarks live in this single file on your machine.

**Back it up regularly** by copying `tracker.db` to an external drive, Google Drive, or any backup location of your choice.

If you ever reinstall the app, move to a new machine, or upgrade to a new version, `tracker.db` and `.env.local` are the only two files you need to carry over. Everything else is re-generated automatically.

> Vriddhi never uploads your data anywhere. Your `tracker.db` never leaves your machine unless you copy it yourself.

---

*Vriddhi is a personal project. Always verify important financial figures against your official CAS statements from CAMS or KFintech.*
