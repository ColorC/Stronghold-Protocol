; scripts/windows/installer.nsi — exe setup of the Windows Lite bundle (docs/WINDOWS.md).
;
; Built by scripts/make-windows-installers.mjs with NSIS 3:
;   makensis /INPUTCHARSET UTF8 /DVERSION=… /DVERSION_NUMERIC=… /DPAYLOAD=… /DPAYLOAD_NSH=… /DICON=… /DLICENSE=…
;            /DOUTFILE=… installer.nsi
; PAYLOAD is the bundle directory of scripts/make-windows-bundle.mjs (lite mode); PAYLOAD_NSH, generated next to it,
; lists that directory's top-level entries so the uninstaller removes exactly what the setup put there.
;
; Same payload and folder as the MSI (installer.wxs): per-user %LOCALAPPDATA%\Programs\Stronghold-Protocol-Workshop,
; no elevation, Start Menu + desktop shortcuts, an entry in Apps & features. Uninstall deletes app\ and node\ (the
; resources the game downloaded included), the launcher, the notices, the shortcuts and the entry; saves live in
; %LOCALAPPDATA%\Stronghold-Protocol-Workshop and stay. Installing a newer version over an older one keeps what the
; game downloaded into app\ and replaces everything else.

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "${PAYLOAD_NSH}"

!define PRODUCT "卫戍协议：工坊"
!define LAUNCHER "启动游戏.exe"
!define STATE_KEY "Software\Stronghold-Protocol-Workshop"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Stronghold-Protocol-Workshop"
!define KEEP_DIR "$INSTDIR\.upgrade-keep"

Name "${PRODUCT}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Stronghold-Protocol-Workshop"
BrandingText "${PRODUCT} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION_NUMERIC}"
VIFileVersion "${VERSION_NUMERIC}"
VIAddVersionKey /LANG=2052 "ProductName" "${PRODUCT}"
VIAddVersionKey /LANG=2052 "FileDescription" "${PRODUCT} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "Stronghold-Protocol"
VIAddVersionKey /LANG=2052 "LegalCopyright" "代码 GPL-3.0-or-later；游戏素材版权归原权利人"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${LAUNCHER}"
!define MUI_FINISHPAGE_RUN_TEXT "启动${PRODUCT}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; A running game keeps node.exe / the launcher open; files in use cannot be replaced or deleted.
!macro EnsureNotRunning UN
Function ${UN}EnsureNotRunning
  retry:
  StrCpy $1 ""
  ${If} ${FileExists} "$INSTDIR\node\node.exe"
    ClearErrors
    FileOpen $0 "$INSTDIR\node\node.exe" a
    ${If} ${Errors}
      StrCpy $1 "busy"
    ${Else}
      FileClose $0
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\${LAUNCHER}"
    ClearErrors
    FileOpen $0 "$INSTDIR\${LAUNCHER}" a
    ${If} ${Errors}
      StrCpy $1 "busy"
    ${Else}
      FileClose $0
    ${EndIf}
  ${EndIf}
  ${If} $1 == "busy"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT}正在运行。请先关闭游戏窗口，再点「重试」。" /SD IDCANCEL IDRETRY retry
    SetErrorLevel 4
    Quit
  ${EndIf}
FunctionEnd
!macroend
!insertmacro EnsureNotRunning ""
!insertmacro EnsureNotRunning "un."

; Downloaded resources, caches and local extraction inside app\ survive an upgrade (moved aside, then back).
!macro KeepResource REL NAME
  ${If} ${FileExists} "$INSTDIR\app\${REL}"
    Rename "$INSTDIR\app\${REL}" "${KEEP_DIR}\${NAME}"
  ${EndIf}
!macroend
!macro RestoreResource REL NAME
  ${If} ${FileExists} "${KEEP_DIR}\${NAME}"
    RMDir /r "$INSTDIR\app\${REL}"
    Delete "$INSTDIR\app\${REL}"
    Rename "${KEEP_DIR}\${NAME}" "$INSTDIR\app\${REL}"
  ${EndIf}
!macroend
!macro EachResource MACRO
  !insertmacro ${MACRO} "public\assets" "public-assets"
  !insertmacro ${MACRO} "public\fonts" "public-fonts"
  !insertmacro ${MACRO} "public\vendor" "public-vendor"
  !insertmacro ${MACRO} ".cache" "cache"
  !insertmacro ${MACRO} ".venv-extract" "venv-extract"
  !insertmacro ${MACRO} "data\local-assets.json" "local-assets.json"
  !insertmacro ${MACRO} "runtime" "runtime"
!macroend

Function .onInit
  ReadRegStr $0 HKCU "${STATE_KEY}" "InstalledBy"
  ${If} $0 == "msi"
    MessageBox MB_OK|MB_ICONSTOP "这台电脑已经用 MSI 安装包安装了${PRODUCT}。请先在「设置 → 应用」里卸载它，再运行这个安装程序。" /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
FunctionEnd

Section "Install"
  Call EnsureNotRunning
  SetOutPath "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\app\*.*"
    RMDir /r "${KEEP_DIR}"
    CreateDirectory "${KEEP_DIR}"
    !insertmacro EachResource KeepResource
    !insertmacro RemovePayloadRoot
  ${EndIf}

  File /r "${PAYLOAD}\*.*"

  ${If} ${FileExists} "${KEEP_DIR}\*.*"
    CreateDirectory "$INSTDIR\app\public"
    CreateDirectory "$INSTDIR\app\data"
    !insertmacro EachResource RestoreResource
    RMDir /r "${KEEP_DIR}"
  ${EndIf}

  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\${LAUNCHER}" 0 SW_SHOWNORMAL "" "启动${PRODUCT}（本机开服并打开浏览器）"
  CreateShortCut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\${LAUNCHER}" 0 SW_SHOWNORMAL "" "启动${PRODUCT}（本机开服并打开浏览器）"

  WriteRegStr HKCU "${STATE_KEY}" "InstalledBy" "exe"
  WriteRegStr HKCU "${STATE_KEY}" "InstallFolder" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Stronghold-Protocol"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${LAUNCHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/ColorC/Stronghold-Protocol/tree/workshop"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  Call un.EnsureNotRunning
  Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  Delete "$DESKTOP\${PRODUCT}.lnk"
  !insertmacro RemovePayloadRoot
  RMDir /r "${KEEP_DIR}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${STATE_KEY}"
SectionEnd
