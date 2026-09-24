!undef APP_FILENAME
!define APP_FILENAME "xiaojing-agent-desktop"

!include FileFunc.nsh
!include nsDialogs.nsh
!include "${BUILD_RESOURCES_DIR}\installer-shortcuts.nsh"

!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT xiaojingInstallerSetIcon
  !define MUI_CUSTOMFUNCTION_ABORT xiaojingInstallerAbortRequested
!endif

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE ""
  !define MUI_WELCOMEPAGE_TEXT ""
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW xiaojingWelcomePageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE xiaojingWelcomePageLeave
  !define MUI_PAGE_CUSTOMFUNCTION_DESTROYED xiaojingWelcomePageDestroyed
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !else
    StrCpy $R8 "$INSTDIR"
  !endif

  StrCmp $R8 "" xiaojingAppCheckDone
  IfFileExists "$R8\${APP_EXECUTABLE_FILENAME}" 0 xiaojingAppCheckDone
  InitPluginsDir
  File /oname=$PLUGINSDIR\xiaojing-installer-shutdown.ps1 "${BUILD_RESOURCES_DIR}\installer-shutdown-helper.ps1"
  System::Call 'KERNEL32::GetCurrentProcessId() i .R9'

xiaojingAppCheckRetry:
  nsExec::ExecToStack `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\xiaojing-installer-shutdown.ps1" -InstallDirectory "$R8" -InstallerProcessId $R9`
  Pop $R0
  Pop $R1
  StrCmp $R0 "0" xiaojingAppCheckDone
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法安全关闭旧版小兢会计。请结束旧版进程后重试。" /SD IDCANCEL IDRETRY xiaojingAppCheckRetry
  Quit

xiaojingAppCheckDone:
!macroend

!macro customInstall
xiaojingRefreshShortcutsRetry:
  !insertmacro xiaojingRefreshShortcutIcons
  ${If} ${Errors}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "程序文件已安装，但快捷方式图标更新失败。请关闭快捷方式属性窗口后重试。" /SD IDCANCEL IDRETRY xiaojingRefreshShortcutsRetry
    SetErrorLevel 2
    Quit
  ${EndIf}
  Call xiaojingFinalizeInstallSection
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE xiaojingRestoreSelectedInstallDirectory
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW xiaojingInstallFilesShow
!macroend

!macro customFinishPage
  Page custom xiaojingAutoFinish
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL xiaojingWelcomeInstallButton
    Var /GLOBAL xiaojingWelcomePathLink
    Var /GLOBAL xiaojingWelcomePathInput
    Var /GLOBAL xiaojingWelcomeBrowseButton
    Var /GLOBAL xiaojingSelectedInstallDirectory
    Var /GLOBAL xiaojingWelcomeProductControl
    Var /GLOBAL xiaojingWelcomeProductBitmap
    Var /GLOBAL xiaojingWelcomeTitleControl
    Var /GLOBAL xiaojingWelcomeConsentControl
    Var /GLOBAL xiaojingProgressProductControl
    Var /GLOBAL xiaojingProgressProductBitmap
    Var /GLOBAL xiaojingProgressCompanyControl
    Var /GLOBAL xiaojingProgressCompanyBitmap
    Var /GLOBAL xiaojingProgressTitleControl
    Var /GLOBAL xiaojingInstallerPageWidth
    Var /GLOBAL xiaojingInstallerPageHeight
    Var /GLOBAL xiaojingInstallerArtworkWidth
    Var /GLOBAL xiaojingInstallerArtworkHeight
    Var /GLOBAL xiaojingInstallInProgress
    Var /GLOBAL xiaojingFreshCancelAvailable
    Var /GLOBAL xiaojingCancelLaunchSucceeded

    Function xiaojingFillInstallerPage
      Exch $0
      Push $1
      Push $2
      Push $3
      Push $4
      Push $5

      System::Alloc 16
      Pop $1
      System::Call 'USER32::GetClientRect(p $HWNDPARENT, p r1)'
      System::Call '*$1(i .r2, i .r3, i .r4, i .r5)'
      System::Free $1
      IntOp $4 $4 - $2
      IntOp $5 $5 - $3
      StrCpy $xiaojingInstallerPageWidth $4
      StrCpy $xiaojingInstallerPageHeight $5
      System::Call 'USER32::SetWindowPos(p r0, p 0, i 0, i 0, i r4, i r5, i 0x0004)'

      ; Reserve space for the title, actions, and bottom consent on short screens.
      IntOp $xiaojingInstallerArtworkHeight $5 - 230
      ${if} $xiaojingInstallerArtworkHeight > 400
        StrCpy $xiaojingInstallerArtworkHeight 400
      ${endif}
      IntOp $1 $4 - 40
      IntOp $1 $1 * 5
      IntOp $1 $1 / 6
      ${if} $xiaojingInstallerArtworkHeight > $1
        StrCpy $xiaojingInstallerArtworkHeight $1
      ${endif}
      IntOp $xiaojingInstallerArtworkWidth $xiaojingInstallerArtworkHeight * 6
      IntOp $xiaojingInstallerArtworkWidth $xiaojingInstallerArtworkWidth / 5

      Pop $5
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

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

    Function xiaojingRestoreSelectedInstallDirectory
      StrCmp $xiaojingSelectedInstallDirectory "" xiaojingRestoreSelectedInstallDirectoryDone
      StrCpy $INSTDIR "$xiaojingSelectedInstallDirectory"

    xiaojingRestoreSelectedInstallDirectoryDone:
    FunctionEnd

    Function xiaojingChooseInstallDirectory
      Pop $0
      Push $1
      Push $2

      ${NSD_GetText} $xiaojingWelcomePathInput $1
      Push $1
      Call xiaojingNormalizeInstallDirectory
      Pop $1
      ${GetParent} "$1" $2

      nsDialogs::SelectFolderDialog "选择安装位置" "$2"
      Pop $1
      StrCmp $1 "error" xiaojingChooseDirectoryDone
      StrCmp $1 "" xiaojingChooseDirectoryDone

      Push $1
      Call xiaojingNormalizeInstallDirectory
      Pop $INSTDIR
      ${NSD_SetText} $xiaojingWelcomePathInput $INSTDIR

    xiaojingChooseDirectoryDone:
      Pop $2
      Pop $1
    FunctionEnd

    Function xiaojingRevealInstallDirectory
      Pop $0
      ShowWindow $xiaojingWelcomePathLink ${SW_HIDE}
      ShowWindow $xiaojingWelcomePathInput ${SW_SHOW}
      ShowWindow $xiaojingWelcomeBrowseButton ${SW_SHOW}
      System::Call 'USER32::SetFocus(p $xiaojingWelcomePathInput)'
    FunctionEnd

    Function xiaojingPrepareCancellation
      StrCpy $xiaojingFreshCancelAvailable "0"
      ${ifNot} ${isUpdated}
        IfFileExists "$INSTDIR" xiaojingPrepareCancellationDone
      ${andIf} ${FileExists} "$PLUGINSDIR\xiaojing-installer-cancel.ps1"
      ${andIf} ${FileExists} "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $xiaojingFreshCancelAvailable "1"
      ${endif}

    xiaojingPrepareCancellationDone:
    FunctionEnd

    Function xiaojingBeginInstall
      Pop $0
      EnableWindow $xiaojingWelcomeInstallButton 0
      ${NSD_SetText} $xiaojingWelcomeInstallButton "正在准备..."
      Call xiaojingPrepareCancellation
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${BM_CLICK} 0 0
    FunctionEnd

    Function xiaojingWelcomePageShow
      SetCtlColors $HWNDPARENT "" "FFFFFF"
      SetCtlColors $mui.WelcomePage "" "FFFFFF"
      ShowWindow $mui.Line.FullWindow ${SW_HIDE}
      ShowWindow $mui.WelcomePage.Image ${SW_HIDE}
      ShowWindow $mui.WelcomePage.Title ${SW_HIDE}
      ShowWindow $mui.WelcomePage.Text ${SW_HIDE}

      Push $mui.WelcomePage
      Call xiaojingFillInstallerPage

      GetDlgItem $0 $HWNDPARENT 1
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $HWNDPARENT 3
      ShowWindow $0 ${SW_HIDE}

      Push $INSTDIR
      Call xiaojingNormalizeInstallDirectory
      Pop $INSTDIR

      ${NSD_CreateBitmap} 0u 0u 1u 1u ""
      Pop $xiaojingWelcomeProductControl
      IntOp $R0 $xiaojingInstallerPageWidth - $xiaojingInstallerArtworkWidth
      IntOp $R0 $R0 / 2
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeProductControl, p 0, i R0, i 8, i $xiaojingInstallerArtworkWidth, i $xiaojingInstallerArtworkHeight, i 0x0004)'
      ${NSD_SetStretchedImage} $xiaojingWelcomeProductControl "$PLUGINSDIR\xiaojing-product-logo.bmp" $xiaojingWelcomeProductBitmap

      ${NSD_CreateLabel} 0u 0u 1u 1u "小兢会计"
      Pop $xiaojingWelcomeTitleControl
      ${NSD_AddStyle} $xiaojingWelcomeTitleControl ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $xiaojingWelcomeTitleControl "102A36" "FFFFFF"
      CreateFont $1 "Microsoft YaHei UI" "20" "700"
      SendMessage $xiaojingWelcomeTitleControl ${WM_SETFONT} $1 0
      IntOp $R0 $xiaojingInstallerPageWidth - 360
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerArtworkHeight + 20
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeTitleControl, p 0, i R0, i R1, i 360, i 42, i 0x0004)'

      ${if} ${isUpdated}
        StrCpy $1 "立即更新"
      ${else}
        StrCpy $1 "立即安装"
      ${endif}
      ${NSD_CreateLabel} 0u 0u 1u 1u "$1"
      Pop $xiaojingWelcomeInstallButton
      ${NSD_AddStyle} $xiaojingWelcomeInstallButton ${SS_CENTER}|${SS_CENTERIMAGE}|${WS_TABSTOP}
      SetCtlColors $xiaojingWelcomeInstallButton "FFFFFF" "12A489"
      CreateFont $1 "Microsoft YaHei UI" "12" "500"
      SendMessage $xiaojingWelcomeInstallButton ${WM_SETFONT} $1 0
      IntOp $R0 $xiaojingInstallerPageWidth - 220
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerArtworkHeight + 72
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeInstallButton, p 0, i R0, i R1, i 220, i 50, i 0x0004)'
      ${NSD_OnClick} $xiaojingWelcomeInstallButton xiaojingBeginInstall

      ${NSD_CreateLabel} 0u 0u 1u 1u "⌄  自定义安装地址"
      Pop $xiaojingWelcomePathLink
      ${NSD_AddStyle} $xiaojingWelcomePathLink ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $xiaojingWelcomePathLink "12A489" "FFFFFF"
      IntOp $R0 $xiaojingInstallerPageWidth - 240
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerArtworkHeight + 142
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomePathLink, p 0, i R0, i R1, i 240, i 30, i 0x0004)'
      ${NSD_OnClick} $xiaojingWelcomePathLink xiaojingRevealInstallDirectory

      ${NSD_CreateText} 0u 0u 1u 1u "$INSTDIR"
      Pop $xiaojingWelcomePathInput
      IntOp $R0 $xiaojingInstallerPageWidth - 190
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomePathInput, p 0, i 70, i R1, i R0, i 30, i 0x0004)'
      ShowWindow $xiaojingWelcomePathInput ${SW_HIDE}

      ${NSD_CreateButton} 0u 0u 1u 1u "浏览..."
      Pop $xiaojingWelcomeBrowseButton
      IntOp $R0 $xiaojingInstallerPageWidth - 105
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeBrowseButton, p 0, i R0, i R1, i 75, i 30, i 0x0004)'
      ShowWindow $xiaojingWelcomeBrowseButton ${SW_HIDE}
      ${NSD_OnClick} $xiaojingWelcomeBrowseButton xiaojingChooseInstallDirectory

      ${NSD_CreateLabel} 0u 0u 1u 1u "安装即表示同意随软件提供的许可协议"
      Pop $xiaojingWelcomeConsentControl
      ${NSD_AddStyle} $xiaojingWelcomeConsentControl ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $xiaojingWelcomeConsentControl "8A999F" "FFFFFF"
      IntOp $R0 $xiaojingInstallerPageHeight - 34
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeConsentControl, p 0, i 0, i R0, i $xiaojingInstallerPageWidth, i 18, i 0x0004)'

      ${if} ${isUpdated}
        ShowWindow $xiaojingWelcomePathLink ${SW_HIDE}
      ${endif}
    FunctionEnd

    Function xiaojingWelcomePageLeave
      ${NSD_GetText} $xiaojingWelcomePathInput $0
      StrCmp $0 "" 0 +3
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择安装位置。"
      Abort

      Push $0
      Call xiaojingNormalizeInstallDirectory
      Pop $INSTDIR
      StrCpy $xiaojingSelectedInstallDirectory "$INSTDIR"
      ${NSD_SetText} $xiaojingWelcomePathInput $INSTDIR
    FunctionEnd

    Function xiaojingWelcomePageDestroyed
      ${NSD_FreeImage} $xiaojingWelcomeProductBitmap
    FunctionEnd

    Function xiaojingStartFreshCancel
      Push $0
      Push $1
      Push $2
      StrCpy $xiaojingCancelLaunchSucceeded "0"
      System::Call 'KERNEL32::GetCurrentProcessId() i .r0'
      StrCpy $1 "$TEMP\xiaojing-installer-cancel-$0.ps1"
      Delete "$1"
      ClearErrors
      CopyFiles /SILENT "$PLUGINSDIR\xiaojing-installer-cancel.ps1" "$1"
      IfErrors xiaojingStartFreshCancelDone

      !ifdef UNINSTALL_REGISTRY_KEY_2
        StrCpy $2 "${UNINSTALL_REGISTRY_KEY_2}"
      !else
        StrCpy $2 ""
      !endif

      ClearErrors
      Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$1" -InstallerProcessId $0 -InstallDirectory "$INSTDIR" -InstallRegistryKey "${INSTALL_REGISTRY_KEY}" -UninstallRegistryKey "${UNINSTALL_REGISTRY_KEY}" -UninstallRegistryKey2 "$2" -DesktopShortcut "$newDesktopLink" -StartMenuShortcut "$newStartMenuLink"'
      IfErrors xiaojingStartFreshCancelDone
      StrCpy $xiaojingCancelLaunchSucceeded "1"

    xiaojingStartFreshCancelDone:
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    Function xiaojingFinalizeInstallSection
      StrCpy $xiaojingInstallInProgress "0"
      Call xiaojingAutoFinish
    FunctionEnd

    Function xiaojingInstallerAbortRequested
      StrCmp $xiaojingInstallInProgress "1" 0 xiaojingAbortAllowed

      ${if} ${isUpdated}
        MessageBox MB_OK|MB_ICONINFORMATION "更新开始后无法取消。为保护原版本，请等待本次更新完成。"
        Abort
      ${elseif} $xiaojingFreshCancelAvailable != "1"
        MessageBox MB_OK|MB_ICONINFORMATION "安装开始后暂时无法安全取消，请等待本次安装完成。"
        Abort
      ${endif}

      MessageBox MB_YESNO|MB_ICONQUESTION "确定取消安装？取消后将清理本次已写入的程序文件。" /SD IDNO IDNO xiaojingAbortContinue
      Call xiaojingStartFreshCancel
      StrCmp $xiaojingCancelLaunchSucceeded "1" 0 xiaojingAbortCleanupFailed
      SetErrorLevel 1602
      Quit

    xiaojingAbortCleanupFailed:
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法安全清理本次安装，请继续完成安装。"

    xiaojingAbortContinue:
      Abort

    xiaojingAbortAllowed:
    FunctionEnd

    Function xiaojingInstallFilesShow
      StrCpy $xiaojingInstallInProgress "1"
      Call muiPageLoadFullWindow
      SetCtlColors $HWNDPARENT "" "FFFFFF"
      SetCtlColors $mui.InstFilesPage "" "FFFFFF"
      ShowWindow $mui.Line.FullWindow ${SW_HIDE}

      GetDlgItem $0 $HWNDPARENT 1
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_HIDE}
      EnableWindow $0 1
      GetDlgItem $0 $HWNDPARENT 3
      ShowWindow $0 ${SW_HIDE}
      ShowWindow $mui.InstFilesPage.ShowLogButton ${SW_HIDE}
      ShowWindow $mui.InstFilesPage.Log ${SW_HIDE}

      Push $mui.InstFilesPage
      Call xiaojingFillInstallerPage

      IntOp $R0 $xiaojingInstallerPageWidth - $xiaojingInstallerArtworkWidth
      IntOp $R0 $R0 / 2
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000020E, i R0, i 8, i $xiaojingInstallerArtworkWidth, i $xiaojingInstallerArtworkHeight, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingProgressProductControl $0
      ${NSD_SetStretchedImage} $xiaojingProgressProductControl "$PLUGINSDIR\xiaojing-product-logo.bmp" $xiaojingProgressProductBitmap

      IntOp $R0 $xiaojingInstallerPageWidth - 480
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerArtworkHeight + 22
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "正在安装小兢会计，请稍候…", i 0x50000201, i R0, i R1, i 480, i 36, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingProgressTitleControl $0
      SetCtlColors $xiaojingProgressTitleControl "102A36" "FFFFFF"
      CreateFont $1 "Microsoft YaHei UI" "15" "600"
      SendMessage $xiaojingProgressTitleControl ${WM_SETFONT} $1 0

      IntOp $R0 $xiaojingInstallerPageWidth - 120
      IntOp $R1 $xiaojingInstallerArtworkHeight + 76
      System::Call 'USER32::SetWindowPos(p $mui.InstFilesPage.ProgressBar, p 0, i 60, i R1, i R0, i 10, i 0x0004)'
      SendMessage $mui.InstFilesPage.ProgressBar ${PBM_SETBARCOLOR} 0 0x0089A412
      SendMessage $mui.InstFilesPage.ProgressBar ${PBM_SETBKCOLOR} 0 0x00F2F5EA

      IntOp $R1 $R1 + 17
      System::Call 'USER32::SetWindowPos(p $mui.InstFilesPage.Text, p 0, i 60, i R1, i R0, i 24, i 0x0004)'
      ${NSD_AddStyle} $mui.InstFilesPage.Text ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $mui.InstFilesPage.Text "657A82" "FFFFFF"

      IntOp $R0 $xiaojingInstallerPageWidth - 110
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerPageHeight - 46
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000020E, i R0, i R1, i 110, i 28, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingProgressCompanyControl $0
      ${NSD_SetImage} $xiaojingProgressCompanyControl "$PLUGINSDIR\xiaojing-company-logo.bmp" $xiaojingProgressCompanyBitmap
    FunctionEnd

    Function xiaojingAutoFinish
      StrCpy $xiaojingInstallInProgress "0"
      ${ifNot} ${Silent}
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        HideWindow
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      ${endif}
      SetErrorLevel 0
      Quit
    FunctionEnd

    Function xiaojingInstallerSetIcon
      Push $R0
      Push $R1
      Push $R2
      Push $R3
      Push $R4
      Push $R5
      Push $R9

      StrCpy $xiaojingInstallInProgress "0"
      StrCpy $xiaojingFreshCancelAvailable "0"
      StrCpy $xiaojingCancelLaunchSucceeded "0"

      System::Call 'USER32::GetSystemMetrics(i 0) i .R0'
      System::Call 'USER32::GetSystemMetrics(i 1) i .R1'
      StrCpy $R4 820
      StrCpy $R5 680
      ${if} $R0 < 860
        IntOp $R4 $R0 - 40
      ${endif}
      ${if} $R1 < 720
        IntOp $R5 $R1 - 40
      ${endif}
      IntOp $R2 $R0 - $R4
      IntOp $R2 $R2 / 2
      IntOp $R3 $R1 - $R5
      IntOp $R3 $R3 / 2
      System::Call 'USER32::SetWindowPos(p $HWNDPARENT, p 0, i R2, i R3, i R4, i R5, i 0x0004)'

      InitPluginsDir
      File /oname=$PLUGINSDIR\installer-runtime-icon.ico "${BUILD_RESOURCES_DIR}\installer-runtime-icon.ico"
      File /oname=$PLUGINSDIR\xiaojing-product-logo.bmp "${BUILD_RESOURCES_DIR}\installer-product-logo.bmp"
      File /oname=$PLUGINSDIR\xiaojing-company-logo.bmp "${BUILD_RESOURCES_DIR}\installer-company-logo.bmp"
      File /oname=$PLUGINSDIR\xiaojing-installer-cancel.ps1 "${BUILD_RESOURCES_DIR}\installer-cancel-helper.ps1"
      System::Call 'USER32::GetSystemMetrics(i 11) i .R4'
      System::Call 'USER32::GetSystemMetrics(i 12) i .R5'
      System::Call 'USER32::LoadImageW(p 0, w "$PLUGINSDIR\installer-runtime-icon.ico", i 1, i R4, i R5, i 0x10) p .R9'
      StrCmp $R9 0 xiaojingInstallerIconDone
      SendMessage $HWNDPARENT 0x0080 1 $R9
      System::Call 'USER32::GetSystemMetrics(i 49) i .R4'
      System::Call 'USER32::GetSystemMetrics(i 50) i .R5'
      System::Call 'USER32::LoadImageW(p 0, w "$PLUGINSDIR\installer-runtime-icon.ico", i 1, i R4, i R5, i 0x10) p .R9'
      StrCmp $R9 0 xiaojingInstallerIconDone
      SendMessage $HWNDPARENT 0x0080 0 $R9
    xiaojingInstallerIconDone:
      Pop $R9
      Pop $R5
      Pop $R4
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
    FunctionEnd
  !endif
!macroend
