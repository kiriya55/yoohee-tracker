import { execFile } from "node:child_process";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

export type ProxySnapshot = {
  server?: string;
  enable?: number;
  autoConfigUrl?: string;
  autoDetect?: number;
};

export interface SystemProxyController {
  snapshot(): Promise<ProxySnapshot>;
  enable(proxyHost: string, proxyPort: number): Promise<void>;
  restore(snapshot: ProxySnapshot): Promise<void>;
}

const WININET_PATH = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const POWERSHELL = "powershell.exe";

const runPowerShell: CommandRunner = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, maxBuffer: 1_048_576 }, (error, stdout, stderr) => {
    if (error && typeof (error as NodeJS.ErrnoException).code === "string" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      reject(new Error("PowerShell is not available"));
      return;
    }
    const exitCode = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
      ? Number((error as NodeJS.ErrnoException).code)
      : error ? 1 : 0;
    resolve({ exitCode, stdout, stderr });
  });
});

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psNullableString(value: string | undefined): string {
  return value === undefined ? "$null" : psString(value);
}

function psNullableNumber(value: number | undefined): string {
  return value === undefined ? "$null" : String(value);
}

const broadcastProxyChange = `
$signature = '[DllImport("wininet.dll", SetLastError = true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'
Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace Gfl2Capture -ErrorAction SilentlyContinue
[Gfl2Capture.NativeMethods]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[Gfl2Capture.NativeMethods]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`;

function commandArgs(script: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];
}

function assertCommandSucceeded(result: CommandResult, failureMessage: string): void {
  if (result.exitCode !== 0) throw new Error(failureMessage);
}

function parseSnapshot(stdout: string): ProxySnapshot {
  try {
    const value = JSON.parse(stdout) as Record<string, unknown>;
    if (value === null || typeof value !== "object") throw new Error();
    const server = typeof value.ProxyServer === "string" ? value.ProxyServer : undefined;
    const enable = typeof value.ProxyEnable === "number" ? value.ProxyEnable : undefined;
    const autoConfigUrl = typeof value.AutoConfigURL === "string" ? value.AutoConfigURL : undefined;
    const autoDetect = typeof value.AutoDetect === "number" ? value.AutoDetect : undefined;
    return { server, enable, autoConfigUrl, autoDetect };
  } catch {
    throw new Error("could not read Windows proxy settings");
  }
}

export class WindowsSystemProxyController implements SystemProxyController {
  private readonly runner: CommandRunner;
  private readonly platform: NodeJS.Platform;

  public constructor(runner: CommandRunner = runPowerShell, platform: NodeJS.Platform = process.platform) {
    this.runner = runner;
    this.platform = platform;
  }

  private assertWindows(): void {
    if (this.platform !== "win32") throw new Error("the system proxy adapter requires Windows");
  }

  public async snapshot(): Promise<ProxySnapshot> {
    this.assertWindows();
    const script = `$path=${psString(WININET_PATH)}; $p=Get-ItemProperty -Path $path -ErrorAction SilentlyContinue; [PSCustomObject]@{ ProxyServer=$p.ProxyServer; ProxyEnable=$p.ProxyEnable; AutoConfigURL=$p.AutoConfigURL; AutoDetect=$p.AutoDetect } | ConvertTo-Json -Compress`;
    const result = await this.runner(POWERSHELL, commandArgs(script));
    assertCommandSucceeded(result, "could not read Windows proxy settings");
    return parseSnapshot(result.stdout);
  }

  public async enable(proxyHost: string, proxyPort: number): Promise<void> {
    this.assertWindows();
    if (!proxyHost || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65_535) {
      throw new Error("invalid local proxy address");
    }
    const server = `${proxyHost}:${proxyPort}`;
    const script = `$path=${psString(WININET_PATH)}; Set-ItemProperty -Path $path -Name ProxyServer -Value ${psString(server)}; Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value 1;${broadcastProxyChange}`;
    const result = await this.runner(POWERSHELL, commandArgs(script));
    assertCommandSucceeded(result, "could not enable the Windows proxy");
  }

  public async restore(snapshot: ProxySnapshot): Promise<void> {
    this.assertWindows();
    const script = `$path=${psString(WININET_PATH)}; $server=${psNullableString(snapshot.server)}; $enable=${psNullableNumber(snapshot.enable)}; $autoConfig=${psNullableString(snapshot.autoConfigUrl)}; $autoDetect=${psNullableNumber(snapshot.autoDetect)}; if ($null -eq $server) { Remove-ItemProperty -Path $path -Name ProxyServer -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $path -Name ProxyServer -Value $server }; if ($null -eq $enable) { Remove-ItemProperty -Path $path -Name ProxyEnable -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $path -Name ProxyEnable -Type DWord -Value $enable }; if ($null -eq $autoConfig) { Remove-ItemProperty -Path $path -Name AutoConfigURL -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $path -Name AutoConfigURL -Value $autoConfig }; if ($null -eq $autoDetect) { Remove-ItemProperty -Path $path -Name AutoDetect -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $path -Name AutoDetect -Type DWord -Value $autoDetect };${broadcastProxyChange}`;
    const result = await this.runner(POWERSHELL, commandArgs(script));
    assertCommandSucceeded(result, "could not restore the Windows proxy");
  }
}
