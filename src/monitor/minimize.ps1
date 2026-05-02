# Committen - 最小化指定 HWND 的窗口
# 接受一个 -Hwnd 参数(64 位整数,来自 active-win 的 win.id)

param(
  [Parameter(Mandatory=$true)]
  [long]$Hwnd
)

Add-Type -Namespace FCWin -Name Native -MemberDefinition @"
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

[DllImport("user32.dll")]
public static extern bool IsWindow(IntPtr hWnd);
"@

$ptr = [IntPtr]$Hwnd

if (-not [FCWin.Native]::IsWindow($ptr)) {
  Write-Error "HWND $Hwnd is not a valid window handle"
  exit 2
}

# SW_MINIMIZE = 6:最小化但不激活下一个窗口
$result = [FCWin.Native]::ShowWindow($ptr, 6)
if ($result) {
  Write-Output "minimized $Hwnd"
  exit 0
} else {
  # ShowWindow 返回 false 通常表示窗口在调用前就已经是 hidden 状态
  # 这不是错误,我们认为成功
  Write-Output "showwindow_returned_false_${Hwnd}"
  exit 0
}
