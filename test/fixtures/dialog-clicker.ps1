param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    [Parameter(Mandatory=$true)]
    [uint32]$RootPid
)

# 1. Resolve strictly descendant processes of RootPid
$procList = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$targetPids = [System.Collections.Generic.HashSet[uint32]]::new()
$targetPids.Add($RootPid) | Out-Null

$changed = $true
while ($changed) {
    $changed = $false
    foreach ($p in $procList) {
        if ($targetPids.Contains([uint32]$p.ParentProcessId) -and -not $targetPids.Contains([uint32]$p.ProcessId)) {
            $targetPids.Add([uint32]$p.ProcessId) | Out-Null
            $changed = $true
        }
    }
}

if ($Action -eq "get-pids") {
    Write-Output ($targetPids -join ",")
    exit 0
}

if ($Action -eq "is-alive") {
    $proc = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
    if ($null -ne $proc) {
        Write-Output "ALIVE"
    } else {
        Write-Output "EXITED"
    }
    exit 0
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class TargetInstanceHelper {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public const uint BM_CLICK = 0x00F5;
    public const uint WM_CLOSE = 0x0010;

    public static string SendWmClose(uint[] allowedPids) {
        bool posted = false;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (Array.IndexOf(allowedPids, pid) >= 0) {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                StringBuilder sbCls = new StringBuilder(256);
                GetClassName(hWnd, sbCls, 256);
                if (sbCls.ToString().Contains("Chrome_WidgetWin_1") && sb.ToString() == "NiZyLa") {
                    PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    posted = true;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return posted ? "POSTED_WM_CLOSE" : "NOT_FOUND";
    }

    public static string ClickDialogButton(uint[] allowedPids, string action) {
        string target = "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01";
        if (action == "discard") {
            target = "\u0e17\u0e34\u0e49\u0e07\u0e01\u0e23\u0e32\u0e1f";
        } else if (action == "save") {
            target = "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01";
        }
        bool clicked = false;
        string info = "";

        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (Array.IndexOf(allowedPids, pid) >= 0) {
                EnumChildWindows(hWnd, (childHwnd, childParam) => {
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(childHwnd, sb, 256);
                    StringBuilder sbCls = new StringBuilder(256);
                    GetClassName(childHwnd, sbCls, 256);
                    string txt = sb.ToString();
                    string cls = sbCls.ToString();
                    if (cls == "Button" && txt.Contains(target)) {
                        SendMessage(childHwnd, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
                        clicked = true;
                        info = "CLICKED:" + action;
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
                if (clicked) return false;
            }
            return true;
        }, IntPtr.Zero);

        return clicked ? info : "NOT_FOUND";
    }
}
"@

$allowedArray = [uint32[]]@($targetPids)

if ($Action -eq "wm-close") {
    $res = [TargetInstanceHelper]::SendWmClose($allowedArray)
    Write-Output $res
} elseif ($Action -eq "cancel" -or $Action -eq "discard" -or $Action -eq "save") {
    $res = [TargetInstanceHelper]::ClickDialogButton($allowedArray, $Action)
    Write-Output $res
} else {
    Write-Error "Unknown action: $Action"
}
