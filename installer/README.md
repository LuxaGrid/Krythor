# Installer Assets

## krythor-installer-icon.bmp

Inno Setup requires a small wizard image (55x58 pixels, BMP format).

Place your branded BMP at:

    installer/krythor-installer-icon.bmp

If this file is missing, remove or comment out the `WizardSmallImageFile` line
in `krythor.iss` and Inno Setup will use its default image.

## Build steps

1. `pnpm build && node bundle.js`   — build and bundle the app
2. `node build-installer.js`         — fetch node.exe + compile installer
3. Ship `installer-out/Krythor-Setup-{version}.exe`
