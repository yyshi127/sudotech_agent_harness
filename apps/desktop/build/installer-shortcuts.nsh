!ifndef XIAOJING_INSTALLER_SHORTCUTS
!define XIAOJING_INSTALLER_SHORTCUTS

; Refresh only installer-owned links that survived the upstream shortcut policy.
!macro xiaojingRefreshShortcut LINK ICON
  ${If} ${FileExists} "${LINK}"
    ClearErrors
    CreateShortCut "${LINK}" "$appExe" "" "${ICON}" 0 SW_SHOWNORMAL "" "${APP_DESCRIPTION}"
    IfErrors xiaojingShortcutIconsFailed
    WinShell::SetLnkAUMI "${LINK}" "${APP_ID}"
    ; SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH: publish this saved link.
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "${LINK}", p 0)'
  ${EndIf}
!macroend

; Called after payload and shortcut installation, with $OUTDIR set to $INSTDIR.
; A changed icon gets a new path even when the application version is unchanged.
; Missing user-deleted links stay missing. Errors prevent the success/launch step.
!macro xiaojingRefreshShortcutIcons
  Push $R0
  Push $R1
  InitPluginsDir
  ClearErrors
  File /oname=$PLUGINSDIR\xiaojing-shortcut-icon.ico "${BUILD_RESOURCES_DIR}\installer-runtime-icon.ico"
  IfErrors xiaojingShortcutIconsFailed
  ${StdUtils.HashFile} $R0 "SHA2-256" "$PLUGINSDIR\xiaojing-shortcut-icon.ico"
  StrLen $R1 $R0
  StrCmp $R1 64 0 xiaojingShortcutIconsFailed
  StrCpy $R1 "$INSTDIR\resources\xiaojing-character-$R0.ico"
  CreateDirectory "$INSTDIR\resources"
  IfErrors xiaojingShortcutIconsFailed
  CopyFiles /SILENT "$PLUGINSDIR\xiaojing-shortcut-icon.ico" "$R1"
  IfErrors xiaojingShortcutIconsFailed

  !insertmacro xiaojingRefreshShortcut "$newDesktopLink" "$R1"
  !insertmacro xiaojingRefreshShortcut "$newStartMenuLink" "$R1"
  ClearErrors
  Goto xiaojingShortcutIconsDone

xiaojingShortcutIconsFailed:
  SetErrors
xiaojingShortcutIconsDone:
  Pop $R1
  Pop $R0
!macroend

!endif
