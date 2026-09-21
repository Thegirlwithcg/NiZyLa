Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInfo {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@
$pids = Get-Process NiZyLa -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
[WinInfo]::EnumWindows({
    param($hWnd, $lParam)
    [uint32]$wPid = 0
    [WinInfo]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
    if ($pids -contains $wPid) {
        $sb = New-Object System.Text.StringBuilder 256
        [WinInfo]::GetWindowText($hWnd, $sb, 256) | Out-Null
        $title = $sb.ToString()
        $sbCls = New-Object System.Text.StringBuilder 256
        [WinInfo]::GetClassName($hWnd, $sbCls, 256) | Out-Null
        $cls = $sbCls.ToString()
        if ($title -ne "" -or $cls -eq "#32770") {
            Write-Output "Window: PID=$wPid, Title='$title', Class='$cls'"
            [WinInfo]::EnumChildWindows($hWnd, {
                param($childHwnd, $childParam)
                $cSb = New-Object System.Text.StringBuilder 256
                [WinInfo]::GetWindowText($childHwnd, $cSb, 256) | Out-Null
                $cCls = New-Object System.Text.StringBuilder 256
                [WinInfo]::GetClassName($childHwnd, $cCls, 256) | Out-Null
                Write-Output "   Child: Text='$($cSb.ToString())', Class='$($cCls.ToString())'"
                return $true
            }, [IntPtr]::Zero) | Out-Null
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
