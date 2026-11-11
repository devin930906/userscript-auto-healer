; Userscript Auto Healer - Windows Production Inno Setup Script
; TASK-019 / REQ-027 / TEST-027 / GATE-008
; Inno Setup 6+ compatible installer script

#ifndef MyAppVersion
#define MyAppVersion "0.0.1"
#endif

#ifndef MyAppPublisher
#define MyAppPublisher "DevinOoi"
#endif

#ifndef MyAppURL
#define MyAppURL "https://github.com/devin930906/userscript-auto-healer"
#endif

#ifndef MyAppExeName
#define MyAppExeName "UserscriptAutoHealer.exe"
#endif

#ifndef SourceDir
#define SourceDir "..\..\dist\packaged\portable-app"
#endif

#ifndef OutputDir
#define OutputDir "..\..\dist\packaged\deliverables"
#endif

#ifndef OutputBaseFilename
#define OutputBaseFilename "Userscript-Auto-Healer-v" + MyAppVersion + "-Setup"
#endif

[Setup]
; Unique GUID for production application to isolate from development candidate builds
AppId={{9F7B3E2A-1D4C-4E5F-8A9B-0C1D2E3F4A5B}}
AppName=Userscript Auto Healer
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\UserscriptAutoHealer
DefaultGroupName=Userscript Auto Healer
AllowNoIcons=yes
; Per-user installation, lowest privilege required (no admin UAC prompt needed)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Preserve previous directory for clean upgrade without altering paths
UsePreviousAppDir=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Userscript Auto Healer"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,Userscript Auto Healer}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Userscript Auto Healer"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,Userscript Auto Healer}"; Flags: nowait postinstall skipifsilent
