; The production shortcut updater runs with links and resources confined to a temporary directory.
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Xiaojing shortcut icon smoke"
OutFile "${OUTPUT_FILE}"
!addincludedir "${BUILDER_INCLUDE}"
!addplugindir /x86-unicode "${PLUGIN_DIR}"
!include "LogicLib.nsh"
!include "StdUtils.nsh"
!define APP_ID "com.sudotech.xiaojing-icon-smoke"
!define APP_DESCRIPTION "Xiaojing icon smoke"
!include "${__FILEDIR__}\..\..\build\installer-shortcuts.nsh"

Var appExe
Var newDesktopLink
Var newStartMenuLink

Section
  StrCpy $INSTDIR "${TARGET_DIR}"
  StrCpy $appExe "$INSTDIR\Xiaojing.exe"
  StrCpy $newDesktopLink "${DESKTOP_LINK}"
  StrCpy $newStartMenuLink "${START_MENU_LINK}"
  SetOutPath "$INSTDIR"
  !insertmacro xiaojingRefreshShortcutIcons
  IfErrors failed
  SetErrorLevel 0
  Quit
failed:
  SetErrorLevel 2
  Quit
SectionEnd
