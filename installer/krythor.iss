; ============================================================
;  Krythor — Inno Setup Installer Script
;  Builds: Krythor-Setup-{version}.exe
;
;  Prerequisites:
;    - Inno Setup 6 installed (https://jrsoftware.org/isinfo.php)
;    - krythor-dist-win/ must exist (run: node bundle.js --platform win first)
;    - installer/node.exe must exist (run: node installer/fetch-node.js first)
; ============================================================

#define MyAppName      "Krythor"
#define MyAppVersion   "0.5.0"
#define MyAppPublisher "Luxa Grid LLC"
#define MyAppURL       "https://github.com/LuxaGrid/Krythor"
#define MyAppExe       "Krythor.bat"
#define DistDir        "..\krythor-dist-win"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Krythor
DefaultGroupName=Krythor
AllowNoIcons=yes
; Output
OutputDir=..\installer-out
OutputBaseFilename=Krythor-Setup-{#MyAppVersion}
; Compression
Compression=lzma2/ultra64
SolidCompression=yes
; UI
WizardStyle=modern
; WizardSmallImageFile=krythor-installer-icon.bmp  — add a 55x58 BMP to enable branding
; Privileges — install to Program Files, requires admin
PrivilegesRequired=admin
; Minimum Windows version: Windows 10
MinVersion=10.0
; Uninstall
UninstallDisplayName=Krythor {#MyAppVersion}
UninstallDisplayIcon={app}\node.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; --- All files from krythor-dist-win/ ---
Source: "{#DistDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- Bundled Node.js runtime ---
; node.exe is fetched by installer/fetch-node.js before running Inno Setup.
; It is placed beside the app files so Krythor.bat and start.js can find it.
Source: "node.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start Menu
Name: "{group}\Krythor";          Filename: "{app}\Krythor.bat";       WorkingDir: "{app}"; Comment: "Launch Krythor"
Name: "{group}\Krythor Setup";    Filename: "{app}\Krythor-Setup.bat"; WorkingDir: "{app}"; Comment: "Run Krythor setup wizard"
Name: "{group}\Uninstall Krythor"; Filename: "{uninstallexe}"

; Desktop (optional)
Name: "{autodesktop}\Krythor";    Filename: "{app}\Krythor.bat";       WorkingDir: "{app}"; Comment: "Launch Krythor"; Tasks: desktopicon

[Run]
; Offer to launch Krythor after install
Filename: "{app}\Krythor.bat"; Description: "Launch Krythor now"; Flags: postinstall nowait skipifsilent shellexec; WorkingDir: "{app}"

[UninstallRun]
; Nothing extra needed — standard uninstall removes all installed files

[Code]
// Warn if Node.js is not on PATH (non-fatal — we bundle node.exe anyway)
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
