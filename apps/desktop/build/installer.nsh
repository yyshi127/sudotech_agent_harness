!undef APP_FILENAME
!define APP_FILENAME "xiaojing-agent-desktop"

!include FileFunc.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT xiaojingInstallerSetIcon
!endif

!macro customPageAfterChangeDir
  Page custom xiaojingDirectoryPageCreate xiaojingDirectoryPageLeave
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL xiaojingDirectoryDialog
    Var /GLOBAL xiaojingDirectoryInput
    Var /GLOBAL xiaojingDirectoryBrowseButton

    Function xiaojingNormalizeInstallDirectory
      Exch $0
      Push $1
      Push $2

    xiaojingTrimTrailingSlash:
      StrLen $2 $0
      IntCmp $2 3 xiaojingDirectoryTrimmed xiaojingDirectoryTrimmed 0
      StrCpy $1 $0 1 -1
      StrCmp $1 "\" 0 xiaojingDirectoryTrimmed
      StrCpy $0 $0 -1
      Goto xiaojingTrimTrailingSlash

    xiaojingDirectoryTrimmed:
      StrCmp $0 "" xiaojingDirectoryNormalized
      ${GetFileName} "$0" $1
      StrCmp $1 "${APP_FILENAME}" xiaojingDirectoryNormalized

      StrCpy $1 $0 1 -1
      StrCmp $1 "\" 0 +3
      StrCpy $0 "$0${APP_FILENAME}"
      Goto xiaojingDirectoryNormalized
      StrCpy $0 "$0\${APP_FILENAME}"

    xiaojingDirectoryNormalized:
      Pop $2
      Pop $1
      Exch $0
    FunctionEnd

    Function xiaojingChooseInstallDirectory
      Push $0
      Push $1

      ${NSD_GetText} $xiaojingDirectoryInput $0
      Push $0
      Call xiaojingNormalizeInstallDirectory
      Pop $0
      ${GetParent} "$0" $1

      nsDialogs::SelectFolderDialog "选择安装位置" "$1"
      Pop $0
      StrCmp $0 "error" xiaojingChooseDirectoryDone
      StrCmp $0 "" xiaojingChooseDirectoryDone

      Push $0
      Call xiaojingNormalizeInstallDirectory
      Pop $INSTDIR
      ${NSD_SetText} $xiaojingDirectoryInput $INSTDIR

    xiaojingChooseDirectoryDone:
      Pop $1
      Pop $0
    FunctionEnd

    Function xiaojingDirectoryPageCreate
      ${if} ${isUpdated}
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "选择安装位置" "请选择 小兢会计-您的AI办公搭子 的安装文件夹。"
      nsDialogs::Create 1018
      Pop $xiaojingDirectoryDialog
      StrCmp $xiaojingDirectoryDialog "error" 0 +2
      Abort

      ${NSD_CreateLabel} 0 0 100% 28u "选择一个父文件夹，程序会自动安装到其中的 xiaojing-agent-desktop 子目录。"
      Pop $0

      ${NSD_CreateGroupBox} 0 34u 100% 74u "目标文件夹"
      Pop $0

      ${NSD_CreateText} 10u 55u 72% 14u "$INSTDIR"
      Pop $xiaojingDirectoryInput

      ${NSD_CreateButton} 78% 54u 20% 16u "浏览(B)..."
      Pop $xiaojingDirectoryBrowseButton
      ${NSD_OnClick} $xiaojingDirectoryBrowseButton xiaojingChooseInstallDirectory

      ${NSD_CreateLabel} 10u 80u 88% 18u "应用目录名固定为 xiaojing-agent-desktop，选择位置后会立即补齐。"
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function xiaojingDirectoryPageLeave
      ${NSD_GetText} $xiaojingDirectoryInput $0
      StrCmp $0 "" 0 +3
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择安装位置。"
      Abort

      Push $0
      Call xiaojingNormalizeInstallDirectory
      Pop $INSTDIR
      ${NSD_SetText} $xiaojingDirectoryInput $INSTDIR
    FunctionEnd

    Function xiaojingInstallerSetIcon
      Push $R9
      InitPluginsDir
      File /oname=$PLUGINSDIR\installer-runtime-icon.ico "${BUILD_RESOURCES_DIR}\installer-runtime-icon.ico"
      System::Call 'USER32::LoadImageW(p 0, w "$PLUGINSDIR\installer-runtime-icon.ico", i 1, i 0, i 0, i 0x10) p .R9'
      StrCmp $R9 0 xiaojingInstallerIconDone
      SendMessage $HWNDPARENT 0x0080 1 $R9
      SendMessage $HWNDPARENT 0x0080 0 $R9
    xiaojingInstallerIconDone:
      Pop $R9
    FunctionEnd
  !endif
!macroend
