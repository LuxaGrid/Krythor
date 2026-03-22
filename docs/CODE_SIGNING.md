# Code Signing Guide

This document describes how to sign Krythor release binaries to avoid OS security warnings.

---

## Windows — SmartScreen / Authenticode

### Why it matters

Without a valid Authenticode signature, Windows SmartScreen shows a "Windows protected your PC" warning every time users install Krythor. An EV (Extended Validation) certificate eliminates the warning entirely.

### Certificate options

| Type | Cost/yr | SmartScreen | Where to buy |
|------|---------|-------------|--------------|
| OV (Organization Validation) | ~$100–300 | Warning reduces after reputation builds | DigiCert, Sectigo, GlobalSign |
| EV (Extended Validation) | ~$400–700 | No warning immediately | DigiCert, Sectigo |

For open-source tools, **OV is sufficient** — SmartScreen reputation builds after a few thousand downloads.

### Signing the installer

1. Obtain your certificate as a `.pfx` file (with private key).
2. Install [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/) for `signtool.exe`.
3. Sign the installer:
   ```bat
   signtool sign /f certificate.pfx /p YOUR_PASSWORD ^
     /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
     "Krythor-Setup-VERSION.exe"
   ```
4. Verify:
   ```bat
   signtool verify /pa "Krythor-Setup-VERSION.exe"
   ```

### GitHub Actions signing (CI)

Store the `.pfx` as a base64-encoded GitHub secret (`WINDOWS_SIGNING_CERT`) and the password as `WINDOWS_SIGNING_PASSWORD`. Add to `release.yml`:

```yaml
- name: Sign Windows installer
  if: matrix.os == 'windows-latest'
  shell: pwsh
  env:
    CERT_B64: ${{ secrets.WINDOWS_SIGNING_CERT }}
    CERT_PASS: ${{ secrets.WINDOWS_SIGNING_PASSWORD }}
  run: |
    $pfx = [System.Convert]::FromBase64String($env:CERT_B64)
    [System.IO.File]::WriteAllBytes("cert.pfx", $pfx)
    & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" `
      sign /f cert.pfx /p $env:CERT_PASS `
      /tr http://timestamp.digicert.com /td sha256 /fd sha256 `
      "Krythor-Setup-${{ env.VERSION }}.exe"
    Remove-Item cert.pfx
```

---

## macOS — Gatekeeper / Notarization

### Why it matters

macOS Gatekeeper blocks unsigned apps with "cannot be opened because the developer cannot be verified." Notarization (Apple-approved scan) is required for distribution outside the App Store.

### Requirements

- Apple Developer Program membership (~$99/yr)
- A **Developer ID Application** certificate from Xcode / Keychain
- `codesign` and `notarytool` CLI tools (included with Xcode)

### Signing the .pkg

1. In Xcode → Account → Manage Certificates → add **Developer ID Installer** certificate.
2. Sign the package:
   ```bash
   productsign --sign "Developer ID Installer: Your Name (TEAM_ID)" \
     krythor-VERSION-macos-arm64.pkg \
     krythor-VERSION-macos-arm64-signed.pkg
   ```

### Notarization

```bash
# Submit for notarization
xcrun notarytool submit krythor-VERSION-macos-arm64-signed.pkg \
  --apple-id your@email.com \
  --team-id TEAM_ID \
  --password APP_SPECIFIC_PASSWORD \
  --wait

# Staple the ticket
xcrun stapler staple krythor-VERSION-macos-arm64-signed.pkg
```

### GitHub Actions signing (CI)

1. Export your Developer ID certs as a `.p12` (base64-encode it).
2. Store in GitHub secrets: `MACOS_SIGNING_CERT`, `MACOS_SIGNING_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`.

```yaml
- name: Import signing certificate (macOS)
  if: matrix.platform == 'mac'
  shell: bash
  env:
    CERT_B64: ${{ secrets.MACOS_SIGNING_CERT }}
    CERT_PASS: ${{ secrets.MACOS_SIGNING_PASSWORD }}
  run: |
    echo "$CERT_B64" | base64 --decode > cert.p12
    security create-keychain -p "" build.keychain
    security import cert.p12 -k build.keychain -P "$CERT_PASS" -T /usr/bin/codesign
    security list-keychains -s build.keychain
    security set-keychain-settings build.keychain
    security unlock-keychain -p "" build.keychain
    rm cert.p12

- name: Sign and notarize .pkg (macOS)
  if: matrix.platform == 'mac'
  shell: bash
  env:
    APPLE_ID:       ${{ secrets.APPLE_ID }}
    APPLE_TEAM_ID:  ${{ secrets.APPLE_TEAM_ID }}
    APPLE_APP_PASS: ${{ secrets.APPLE_APP_PASSWORD }}
  run: |
    PKG="krythor-${VERSION}-macos-${{ matrix.arch }}.pkg"
    SIGNED="krythor-${VERSION}-macos-${{ matrix.arch }}-signed.pkg"
    productsign --sign "Developer ID Installer: $APPLE_TEAM_ID" "$PKG" "$SIGNED"
    xcrun notarytool submit "$SIGNED" \
      --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_PASS" --wait
    xcrun stapler staple "$SIGNED"
    mv "$SIGNED" "$PKG"
```

---

## Linux

Linux does not have a mandatory signing model equivalent to Windows/macOS. Packages can be verified via:

- **GPG signatures** on `.deb`/`.rpm` files
- **SHA256 checksums** published alongside each release

### Generating a GPG-signed checksum

```bash
# Generate checksums
sha256sum krythor-*.deb krythor-*.pkg krythor-*.zip > SHA256SUMS

# Sign with your GPG key
gpg --armor --detach-sign SHA256SUMS
```

Upload `SHA256SUMS` and `SHA256SUMS.asc` as release assets. Users can verify with:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS
```
