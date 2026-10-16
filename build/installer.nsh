; Vlastní stránka instalátoru: výběr sdílené složky s informacemi o zakázkách.
; Volba se uloží do %APPDATA%\EvidenceZakazek\config.json (přežije aktualizaci programu).
; Tichá instalace: Setup.exe /S /DATADIR=\server\firma\Zakazky

!ifndef BUILD_UNINSTALLER

!include nsDialogs.nsh
!include LogicLib.nsh
!include StrFunc.nsh
${StrRep}

Var DataDirEdit
Var DataDirValue
Var DataDirFinal

!macro customPageAfterChangeDir
  Page custom DataDirPageCreate DataDirPageLeave
!macroend

Function DataDirPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Umístění dat"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Kde budou uloženy informace o zakázkách"

  ${NSD_CreateLabel} 0 0 100% 44u "Vyberte SDÍLENOU složku, ve které budou uloženy informace o zakázkách (databáze a zálohy). Musí být dostupná všem počítačům v práci a musíte do ní mít právo zápisu.$\r$\n$\r$\nPříklad: \\server\firma\Zakazky"
  Pop $0
  ${NSD_CreateDirRequest} 0 56u 76% 12u "$DataDirValue"
  Pop $DataDirEdit
  ${NSD_CreateBrowseButton} 78% 55u 22% 14u "Procházet..."
  Pop $0
  ${NSD_OnClick} $0 DataDirBrowse
  ${If} ${FileExists} "$APPDATA\EvidenceZakazek\config.json"
    ${NSD_CreateLabel} 0 76u 100% 24u "Stávající nastavení zůstane zachováno, pokud pole necháte prázdné."
    Pop $0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function DataDirBrowse
  ${NSD_GetText} $DataDirEdit $0
  nsDialogs::SelectFolderDialog "Vyberte sdílenou složku s informacemi o zakázkách" "$0"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $DataDirEdit "$0"
  ${EndIf}
FunctionEnd

; zadanou složku zkontroluje a nastaví $DataDirFinal (= <složka>\data)
Function DataDirResolve
  StrCpy $1 $DataDirValue 1 -1
  ${If} $1 == "\"
    StrCpy $DataDirValue $DataDirValue -1
  ${EndIf}
  StrCpy $1 $DataDirValue 5 -5
  ${If} $1 == "\data"
    StrCpy $DataDirFinal $DataDirValue
  ${Else}
    StrCpy $DataDirFinal "$DataDirValue\data"
  ${EndIf}
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirEdit $DataDirValue
  ${If} $DataDirValue == ""
    ${IfNot} ${FileExists} "$APPDATA\EvidenceZakazek\config.json"
      MessageBox MB_ICONEXCLAMATION|MB_OK "Vyberte sdílenou složku s informacemi o zakázkách."
      Abort
    ${EndIf}
    StrCpy $DataDirFinal ""
    Return
  ${EndIf}
  Call DataDirResolve
  ClearErrors
  CreateDirectory "$DataDirFinal"
  ClearErrors
  FileOpen $0 "$DataDirFinal\.zapis-test" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "Do složky nelze zapisovat nebo není dostupná:$\r$\n$DataDirFinal$\r$\n$\r$\nZkontrolujte cestu, připojení k síti a oprávnění."
    Abort
  ${EndIf}
  FileClose $0
  Delete "$DataDirFinal\.zapis-test"
FunctionEnd

!macro customInstall
  ${GetParameters} $R0
  ${GetOptions} $R0 "/DATADIR=" $R1
  ${If} $R1 != ""
    StrCpy $DataDirValue $R1
    Call DataDirResolve
    CreateDirectory "$DataDirFinal"
  ${EndIf}
  ${If} $DataDirFinal != ""
    CreateDirectory "$APPDATA\EvidenceZakazek"
    ${StrRep} $0 "$DataDirFinal" "\" "/"
    FileOpen $1 "$APPDATA\EvidenceZakazek\config.json" w
    FileWriteWord $1 "65279"
    FileWriteUTF16LE $1 "{$\r$\n  $\"dataDir$\": $\"$0$\",$\r$\n  $\"backupKeepDays$\": 30$\r$\n}$\r$\n"
    FileClose $1
  ${EndIf}
!macroend

!endif
