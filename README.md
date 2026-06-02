# CodeHound

A browser extension that sniffs out verification codes from your Gmail and copies them to your clipboard instantly.

![CodeHound Icon](icons/icon128.png)

## Features

- Searches your recent Gmail for OTP / verification code emails
- Extracts the code automatically using pattern matching
- Copies it straight to your clipboard with one click
- Optional AI mode (Claude or OpenAI) to identify the right email when pattern matching falls short
- Works on both Chrome and Firefox

## Installation

### Chrome
1. Download the latest release zip from the [Releases](../../releases) page
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extracted folder

### Firefox
1. Download the Firefox release zip from the [Releases](../../releases) page
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select the `manifest-firefox.json` file

## Usage

1. Click the CodeHound icon in your toolbar
2. Click **Retrieve Code**
3. Approve Gmail access when prompted (first time only)
4. The code is found and copied to your clipboard automatically

### AI Mode (optional)

If the standard pattern matching doesn't find your code, you can enable AI mode:

1. Click the settings icon in the extension popup
2. Toggle **Enable AI**
3. Select your provider (Claude or OpenAI)
4. Paste in your API key
5. Click **Save Settings**

AI mode sends email subjects (not full email content) to the selected AI provider to identify the most likely verification email.

## Permissions

| Permission | Reason |
|---|---|
| `identity` | Authenticate with Google to access Gmail |
| `clipboardWrite` | Copy the found code to your clipboard |
| `storage` | Save your AI settings locally |
| `gmail.readonly` | Read emails to search for verification codes |

## Privacy

CodeHound does not collect, store, or transmit any of your data. All processing happens locally in your browser. If AI mode is enabled, only email subjects are sent to the AI provider you configure — no full email content is ever shared.

See the full [Privacy Policy](https://gardner-programs.github.io/codehound-privacy.html).

## License

MIT

## Attributions

Dog icon by [deemakdaksina](https://www.flaticon.com/free-icons/dog) — Flaticon
