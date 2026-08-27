!undef APP_FILENAME
!define APP_FILENAME "xiaojing-agent-desktop"

!include FileFunc.nsh
!include nsDialogs.nsh

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

!macro customInstall
  Call xiaojingFinalizeInstallSection
!macroend

!macro customPageAfterChangeDir
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
    Var /GLOBAL xiaojingInstallInProgress
    Var /GLOBAL xiaojingFreshCancelAvailable
    Var /GLOBAL xiaojingCancelLaunchSucceeded
    Var /GLOBAL xiaojingCancelChoice
    Var /GLOBAL xiaojingCancelDialogActive
    Var /GLOBAL xiaojingCancelCardBorder
    Var /GLOBAL xiaojingCancelCard
    Var /GLOBAL xiaojingCancelProductControl
    Var /GLOBAL xiaojingCancelProductBitmap
    Var /GLOBAL xiaojingCancelTitleControl
    Var /GLOBAL xiaojingCancelBodyControl
    Var /GLOBAL xiaojingCancelStopBorder
    Var /GLOBAL xiaojingCancelStopButton
    Var /GLOBAL xiaojingCancelContinueButton

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
      StrCpy $xiaojingCancelDialogActive "0"
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
      IntOp $R0 $xiaojingInstallerPageWidth - 140
      IntOp $R0 $R0 / 2
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeProductControl, p 0, i R0, i 52, i 140, i 140, i 0x0004)'
      ${NSD_SetImage} $xiaojingWelcomeProductControl "$PLUGINSDIR\xiaojing-product-logo.bmp" $xiaojingWelcomeProductBitmap

      ${NSD_CreateLabel} 0u 0u 1u 1u "小兢会计"
      Pop $xiaojingWelcomeTitleControl
      ${NSD_AddStyle} $xiaojingWelcomeTitleControl ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $xiaojingWelcomeTitleControl "102A36" "FFFFFF"
      CreateFont $1 "Microsoft YaHei UI" "20" "700"
      SendMessage $xiaojingWelcomeTitleControl ${WM_SETFONT} $1 0
      IntOp $R0 $xiaojingInstallerPageWidth - 360
      IntOp $R0 $R0 / 2
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeTitleControl, p 0, i R0, i 204, i 360, i 42, i 0x0004)'

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
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeInstallButton, p 0, i R0, i 270, i 220, i 50, i 0x0004)'
      ${NSD_OnClick} $xiaojingWelcomeInstallButton xiaojingBeginInstall

      ${NSD_CreateLabel} 0u 0u 1u 1u "⌄  自定义安装地址"
      Pop $xiaojingWelcomePathLink
      ${NSD_AddStyle} $xiaojingWelcomePathLink ${SS_CENTER}|${SS_CENTERIMAGE}
      SetCtlColors $xiaojingWelcomePathLink "12A489" "FFFFFF"
      IntOp $R0 $xiaojingInstallerPageWidth - 240
      IntOp $R0 $R0 / 2
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomePathLink, p 0, i R0, i 350, i 240, i 30, i 0x0004)'
      ${NSD_OnClick} $xiaojingWelcomePathLink xiaojingRevealInstallDirectory

      ${NSD_CreateText} 0u 0u 1u 1u "$INSTDIR"
      Pop $xiaojingWelcomePathInput
      IntOp $R0 $xiaojingInstallerPageWidth - 190
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomePathInput, p 0, i 70, i 346, i R0, i 30, i 0x0004)'
      ShowWindow $xiaojingWelcomePathInput ${SW_HIDE}

      ${NSD_CreateButton} 0u 0u 1u 1u "浏览..."
      Pop $xiaojingWelcomeBrowseButton
      IntOp $R0 $xiaojingInstallerPageWidth - 105
      System::Call 'USER32::SetWindowPos(p $xiaojingWelcomeBrowseButton, p 0, i R0, i 346, i 75, i 30, i 0x0004)'
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
      ${NSD_SetText} $xiaojingWelcomePathInput $INSTDIR
    FunctionEnd

    Function xiaojingWelcomePageDestroyed
      ${NSD_FreeImage} $xiaojingWelcomeProductBitmap
    FunctionEnd

    Function xiaojingSetInstallCloseEnabled
      GetDlgItem $0 $HWNDPARENT 2
      EnableWindow $0 1
      System::Call 'USER32::GetSystemMenu(p $HWNDPARENT, i 0) p .r0'
      System::Call 'USER32::EnableMenuItem(p r0, i 0xF060, i 0x0000)'
      System::Call 'USER32::DrawMenuBar(p $HWNDPARENT)'
    FunctionEnd

    Function xiaojingSetInstallCloseDisabled
      GetDlgItem $0 $HWNDPARENT 2
      EnableWindow $0 0
      System::Call 'USER32::GetSystemMenu(p $HWNDPARENT, i 0) p .r0'
      System::Call 'USER32::EnableMenuItem(p r0, i 0xF060, i 0x0001)'
      System::Call 'USER32::DrawMenuBar(p $HWNDPARENT)'
    FunctionEnd

    Function xiaojingHideInstallProgress
      ShowWindow $xiaojingProgressProductControl ${SW_HIDE}
      ShowWindow $xiaojingProgressTitleControl ${SW_HIDE}
      ShowWindow $mui.InstFilesPage.ProgressBar ${SW_HIDE}
      ShowWindow $mui.InstFilesPage.Text ${SW_HIDE}
      ShowWindow $xiaojingProgressCompanyControl ${SW_HIDE}
    FunctionEnd

    Function xiaojingShowInstallProgress
      SetCtlColors $mui.InstFilesPage "" "FFFFFF"
      ShowWindow $xiaojingProgressProductControl ${SW_SHOW}
      ShowWindow $xiaojingProgressTitleControl ${SW_SHOW}
      ShowWindow $mui.InstFilesPage.ProgressBar ${SW_SHOW}
      ShowWindow $mui.InstFilesPage.Text ${SW_SHOW}
      ShowWindow $xiaojingProgressCompanyControl ${SW_SHOW}
      Call xiaojingSetInstallCloseEnabled
      System::Call 'USER32::RedrawWindow(p $mui.InstFilesPage, p 0, p 0, i 0x0185)'
    FunctionEnd

    Function xiaojingDestroyCancelDialog
      ${NSD_FreeImage} $xiaojingCancelProductBitmap
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelContinueButton)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelStopButton)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelStopBorder)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelBodyControl)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelTitleControl)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelProductControl)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelCard)'
      System::Call 'USER32::DestroyWindow(p $xiaojingCancelCardBorder)'
      Call xiaojingShowInstallProgress
    FunctionEnd

    Function xiaojingShowCancelDialog
      StrCpy $xiaojingCancelChoice "continue"
      StrCpy $xiaojingCancelDialogActive "1"
      Call xiaojingSetInstallCloseDisabled
      Call xiaojingHideInstallProgress
      SetCtlColors $mui.InstFilesPage "" "F5F8F7"

      IntOp $R0 $xiaojingInstallerPageWidth - 460
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerPageHeight - 360
      IntOp $R1 $R1 / 2

      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000000, i R0, i R1, i 460, i 360, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelCardBorder $0
      SetCtlColors $xiaojingCancelCardBorder "DCE7E4" "DCE7E4"

      IntOp $R0 $R0 + 1
      IntOp $R1 $R1 + 1
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000000, i R0, i R1, i 458, i 358, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelCard $0
      SetCtlColors $xiaojingCancelCard "FFFFFF" "FFFFFF"

      IntOp $R2 $xiaojingInstallerPageWidth - 72
      IntOp $R2 $R2 / 2
      IntOp $R3 $R1 + 36
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000020E, i R2, i R3, i 72, i 72, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelProductControl $0
      SetCtlColors $xiaojingCancelProductControl "FFFFFF" "FFFFFF"
      ${NSD_SetImage} $xiaojingCancelProductControl "$PLUGINSDIR\xiaojing-product-logo-small.bmp" $xiaojingCancelProductBitmap

      IntOp $R2 $xiaojingInstallerPageWidth - 360
      IntOp $R2 $R2 / 2
      IntOp $R3 $R1 + 126
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "确定取消安装？", i 0x50000201, i R2, i R3, i 360, i 38, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelTitleControl $0
      SetCtlColors $xiaojingCancelTitleControl "102A36" "FFFFFF"
      CreateFont $9 "Microsoft YaHei UI" "16" "700"
      SendMessage $xiaojingCancelTitleControl ${WM_SETFONT} $9 0

      IntOp $R3 $R1 + 174
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "取消后将立即停止本次安装。", i 0x50000201, i R2, i R3, i 360, i 34, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelBodyControl $0
      SetCtlColors $xiaojingCancelBodyControl "657A82" "FFFFFF"
      CreateFont $9 "Microsoft YaHei UI" "11" "400"
      SendMessage $xiaojingCancelBodyControl ${WM_SETFONT} $9 0

      ${if} ${isUpdated}
        SendMessage $xiaojingCancelTitleControl ${WM_SETTEXT} 0 "STR:更新开始后无法取消"
        SendMessage $xiaojingCancelBodyControl ${WM_SETTEXT} 0 "STR:为保护原版本，请等待本次更新完成。"
        IntOp $R2 $xiaojingInstallerPageWidth - 160
        IntOp $R2 $R2 / 2
      ${elseif} $xiaojingFreshCancelAvailable != "1"
        SendMessage $xiaojingCancelTitleControl ${WM_SETTEXT} 0 "STR:暂时无法安全取消"
        SendMessage $xiaojingCancelBodyControl ${WM_SETTEXT} 0 "STR:清理程序不可用，请继续完成本次安装。"
        IntOp $R2 $xiaojingInstallerPageWidth - 160
        IntOp $R2 $R2 / 2
      ${else}
        IntOp $R2 $xiaojingInstallerPageWidth - 316
        IntOp $R2 $R2 / 2
        IntOp $R3 $R1 + 258
        System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000000, i R2, i R3, i 150, i 46, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
        StrCpy $xiaojingCancelStopBorder $0
        SetCtlColors $xiaojingCancelStopBorder "D5E1DE" "D5E1DE"

        IntOp $R2 $R2 + 1
        IntOp $R3 $R3 + 1
        System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "取消安装", i 0x50000301, i R2, i R3, i 148, i 44, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
        StrCpy $xiaojingCancelStopButton $0
        SetCtlColors $xiaojingCancelStopButton "102A36" "FFFFFF"
        CreateFont $9 "Microsoft YaHei UI" "11" "600"
        SendMessage $xiaojingCancelStopButton ${WM_SETFONT} $9 0

        IntOp $R2 $R2 + 165
      ${endif}

      IntOp $R3 $R1 + 258
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "继续安装", i 0x50000301, i R2, i R3, i 150, i 46, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingCancelContinueButton $0
      SetCtlColors $xiaojingCancelContinueButton "FFFFFF" "12A489"
      CreateFont $9 "Microsoft YaHei UI" "11" "600"
      SendMessage $xiaojingCancelContinueButton ${WM_SETFONT} $9 0

      System::Call 'USER32::RedrawWindow(p $mui.InstFilesPage, p 0, p 0, i 0x0185)'

      System::Alloc 32
      Pop $0
    xiaojingCancelMessageLoop:
      System::Call 'USER32::GetMessageW(p r0, p 0, i 0, i 0) i .r1'
      StrCmp $1 "0" xiaojingCancelContinue
      System::Call '*$0(p .r2, i .r3, p .r4, p .r5)'
      IntCmp $3 ${WM_LBUTTONUP} xiaojingCancelMouseUp xiaojingCancelCheckKey xiaojingCancelCheckKey

    xiaojingCancelMouseUp:
      StrCmp $2 $xiaojingCancelStopButton xiaojingCancelStop
      StrCmp $2 $xiaojingCancelContinueButton xiaojingCancelContinue

    xiaojingCancelCheckKey:
      IntCmp $3 ${WM_KEYUP} xiaojingCancelKeyUp xiaojingCancelDispatchMessage xiaojingCancelDispatchMessage

    xiaojingCancelKeyUp:
      StrCmp $4 "13" xiaojingCancelContinue
      StrCmp $4 "27" xiaojingCancelContinue

    xiaojingCancelDispatchMessage:
      System::Call 'USER32::TranslateMessage(p r0)'
      System::Call 'USER32::DispatchMessageW(p r0)'
      Goto xiaojingCancelMessageLoop

    xiaojingCancelStop:
      StrCpy $xiaojingCancelChoice "cancel"
      Call xiaojingStartFreshCancel
      StrCmp $xiaojingCancelLaunchSucceeded "1" 0 xiaojingCancelLaunchFailed
      StrCpy $xiaojingCancelDialogActive "0"
      System::Free $0
      SetErrorLevel 1602
      Quit

    xiaojingCancelLaunchFailed:
      SendMessage $xiaojingCancelTitleControl ${WM_SETTEXT} 0 "STR:无法安全取消"
      SendMessage $xiaojingCancelBodyControl ${WM_SETTEXT} 0 "STR:清理程序未能启动，请继续完成本次安装。"
      ShowWindow $xiaojingCancelStopButton ${SW_HIDE}
      ShowWindow $xiaojingCancelStopBorder ${SW_HIDE}
      Goto xiaojingCancelMessageLoop

    xiaojingCancelContinue:
      StrCpy $xiaojingCancelChoice "continue"

      StrCpy $xiaojingCancelDialogActive "0"
      System::Free $0
      Call xiaojingDestroyCancelDialog
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
    xiaojingWaitForCancelDecision:
      StrCmp $xiaojingCancelDialogActive "1" 0 xiaojingCancelDecisionReady
      Sleep 100
      Goto xiaojingWaitForCancelDecision

    xiaojingCancelDecisionReady:
      StrCpy $xiaojingInstallInProgress "0"
      Call xiaojingAutoFinish
    FunctionEnd

    Function xiaojingInstallerAbortRequested
      StrCmp $xiaojingInstallInProgress "1" 0 xiaojingAbortAllowed
      Call xiaojingShowCancelDialog
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
      Call xiaojingSetInstallCloseEnabled

      IntOp $R0 $xiaojingInstallerPageWidth - 140
      IntOp $R0 $R0 / 2
      IntOp $R1 $xiaojingInstallerPageHeight - 155
      IntOp $R2 $R1 - 140
      IntOp $R2 $R2 / 2
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000020E, i R0, i R2, i 140, i 140, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingProgressProductControl $0
      SetCtlColors $xiaojingProgressProductControl "FFFFFF" "FFFFFF"
      ${NSD_SetImage} $xiaojingProgressProductControl "$PLUGINSDIR\xiaojing-product-logo.bmp" $xiaojingProgressProductBitmap

      IntOp $R2 $R2 + 144
      IntOp $R0 $xiaojingInstallerPageWidth - 360
      IntOp $R0 $R0 / 2
      System::Call 'USER32::CreateWindowExW(i 0, w "STATIC", w "小兢会计", i 0x50000201, i R0, i R2, i 360, i 42, p $mui.InstFilesPage, p 0, p 0, p 0) p .r0'
      StrCpy $xiaojingProgressTitleControl $0
      SetCtlColors $xiaojingProgressTitleControl "102A36" "FFFFFF"
      CreateFont $9 "Microsoft YaHei UI" "18" "700"
      SendMessage $xiaojingProgressTitleControl ${WM_SETFONT} $9 0

      IntOp $R0 $xiaojingInstallerPageWidth - 120
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
      SetCtlColors $xiaojingProgressCompanyControl "FFFFFF" "FFFFFF"
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
      StrCpy $xiaojingCancelDialogActive "0"

      System::Call 'USER32::GetSystemMetrics(i 0) i .R0'
      System::Call 'USER32::GetSystemMetrics(i 1) i .R1'
      StrCpy $R4 820
      StrCpy $R5 520
      ${if} $R0 < 860
        IntOp $R4 $R0 - 40
      ${endif}
      ${if} $R1 < 560
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
      File /oname=$PLUGINSDIR\xiaojing-product-logo-small.bmp "${BUILD_RESOURCES_DIR}\installer-product-logo-small.bmp"
      File /oname=$PLUGINSDIR\xiaojing-company-logo.bmp "${BUILD_RESOURCES_DIR}\installer-company-logo.bmp"
      File /oname=$PLUGINSDIR\xiaojing-installer-cancel.ps1 "${BUILD_RESOURCES_DIR}\installer-cancel-helper.ps1"
      System::Call 'USER32::LoadImageW(p 0, w "$PLUGINSDIR\installer-runtime-icon.ico", i 1, i 0, i 0, i 0x10) p .R9'
      StrCmp $R9 0 xiaojingInstallerIconDone
      SendMessage $HWNDPARENT 0x0080 1 $R9
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
