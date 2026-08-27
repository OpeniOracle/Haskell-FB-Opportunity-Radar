<#
.SYNOPSIS
    Capture the requests Send-BootstrapInvitation.ps1 really builds, on
    Windows PowerShell 5.1, and prove their headers.

.DESCRIPTION
    WHY A LOOPBACK LISTENER RATHER THAN READING THE SOURCE.

    The 401 that stopped the operator was a header problem, and a source-text
    assertion cannot see a header. `Invoke-WebRequest` adds its own -- Windows
    PowerShell 5.1's default User-Agent is
    "Mozilla/5.0 (Windows NT ...) WindowsPowerShell/5.1.x", which is browser-
    shaped, and Supabase refuses a secret key from a browser. Nothing in the
    script's text says that. Only a real request does.

    So this starts an HttpListener on 127.0.0.1, runs the ACTUAL script against
    it, and inspects what arrives.

    WHY A CUSTOM HOST RATHER THAN PIPED INPUT.

    The script takes the key through `Read-Host -AsSecureString`, which reads
    keystrokes through the console and THROWS when stdin is redirected. That is
    a property worth keeping -- it is what stops the key reaching a pipe, a file
    or a command line. So instead of weakening it, this test supplies a PSHost
    that answers the prompts exactly as a human typing would: `Read-Host
    -Prompt` routes through PSHostUserInterface.Prompt(), and this host returns
    the fake address for the string field and a SecureString for the key field.
    The script is unmodified and its secret handling is untouched.

    The key used here is FAKE. It never leaves 127.0.0.1.
#>

[CmdletBinding()]
param(
    <#
        Left empty and resolved in the body. $PSScriptRoot is NOT populated
        inside a param() default under Windows PowerShell 5.1 -- the default
        evaluates to an empty string and Split-Path refuses it -- while in the
        body it is correct. PowerShell 7 populates both, so this failed only on
        the one interpreter the test exists to cover.
    #>
    [string] $ScriptPath,

    <#
        Forwarded to the script under test. Its repository guard runs before any
        request and must PASS here, and a CI checkout is not always on the
        script's default branch, so the caller passes the branch it is actually
        on rather than this test asserting one.
    #>
    [string] $Branch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $ScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Send-BootstrapInvitation.ps1'
}
if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Cannot find the script under test at '$ScriptPath'."
}

$FAKE_SECRET = 'sb_secret_LOOPBACK_FAKE_0000000000000000'
$FAKE_EMAIL = 'loopback.tester@openi-analytics.com'
$EXPECTED_USER_AGENT = 'Openi-Haskell-FB-Radar-Operator/1.0'

$script:Pass = 0
$script:Fail = 0
function Ok([string] $What) { $script:Pass++; Write-Host "  PASS  $What" }
function No([string] $What, [string] $Why) { $script:Fail++; Write-Host "  FAIL  $What -- $Why" }
function Check([string] $What, [bool] $Condition, [string] $Why = '') {
    if ($Condition) { Ok $What } else { No $What $Why }
}

# ---------------------------------------------------------------------------
# A PSHost that answers the two prompts, so the real script runs unmodified.

if (-not ('Openi.LoopbackHost' -as [type])) {
    <#
        The reference list differs by edition, and specifying it replaces the
        defaults rather than adding to them.

        Windows PowerShell 5.1 does not reference System.Management.Automation
        by default, so PSHost cannot be subclassed without naming it. .NET Core
        splits the base library across facades, so naming a partial list there
        breaks types that 5.1 gets free from mscorlib. Each edition therefore
        gets what it actually needs: 5.1 the automation assembly, 7 the
        defaults.

        The job that matters is 5.1. Running on 7 is only a way to shake out
        logic errors before pushing.
    #>
    $addType = @{ Language = 'CSharp'; TypeDefinition = @'
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Management.Automation;
using System.Management.Automation.Host;
using System.Security;
using System.Text;

namespace Openi
{
    public class LoopbackUI : PSHostUserInterface
    {
        public string LineAnswer = "";
        public string SecureAnswer = "";
        public readonly StringBuilder Written = new StringBuilder();

        public override string ReadLine() { return LineAnswer; }

        public override SecureString ReadLineAsSecureString()
        {
            SecureString s = new SecureString();
            foreach (char c in SecureAnswer) { s.AppendChar(c); }
            s.MakeReadOnly();
            return s;
        }

        public override void Write(string value) { Written.Append(value); }
        public override void Write(ConsoleColor f, ConsoleColor b, string value) { Written.Append(value); }
        public override void WriteLine(string value) { Written.AppendLine(value); }
        public override void WriteErrorLine(string value) { Written.AppendLine(value); }
        public override void WriteDebugLine(string value) { Written.AppendLine(value); }
        public override void WriteVerboseLine(string value) { Written.AppendLine(value); }
        public override void WriteWarningLine(string value) { Written.AppendLine(value); }
        public override void WriteProgress(long sourceId, ProgressRecord record) { }

        /*
            READ-HOST DOES NOT CALL ReadLine() WHEN IT IS GIVEN A PROMPT.

            `Read-Host -Prompt '...'` builds a FieldDescription and calls
            Prompt(); only the bare `Read-Host` form reaches ReadLine(). That is
            true of `-AsSecureString` too, so BOTH of the script's prompts --
            the visible email and the hidden key -- arrive here, and an empty
            dictionary makes Read-Host return null. The script then fails on
            `.Trim()` before it ever builds a request.

            Which answer to give is decided by the field's declared type rather
            than by its position or label, so this keeps working if the script
            reorders or renames its prompts.
        */
        public override Dictionary<string, PSObject> Prompt(
            string caption, string message, Collection<FieldDescription> descriptions)
        {
            Dictionary<string, PSObject> answers = new Dictionary<string, PSObject>();
            foreach (FieldDescription d in descriptions)
            {
                string declared = (d.ParameterAssemblyFullName ?? "") + "|" + (d.ParameterTypeName ?? "");
                if (!string.IsNullOrEmpty(d.Label)) { Written.AppendLine(d.Label); }
                else if (!string.IsNullOrEmpty(d.Name)) { Written.AppendLine(d.Name); }

                if (declared.IndexOf("SecureString", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    answers[d.Name] = PSObject.AsPSObject(ReadLineAsSecureString());
                }
                else
                {
                    answers[d.Name] = PSObject.AsPSObject(LineAnswer);
                }
            }
            return answers;
        }

        public override int PromptForChoice(
            string caption, string message, Collection<ChoiceDescription> choices, int defaultChoice)
        {
            return defaultChoice;
        }

        public override PSCredential PromptForCredential(
            string caption, string message, string userName, string targetName)
        {
            return null;
        }

        public override PSCredential PromptForCredential(
            string caption, string message, string userName, string targetName,
            PSCredentialTypes allowedCredentialTypes, PSCredentialUIOptions options)
        {
            return null;
        }

        /*
            A REAL RawUI, NOT NULL.

            Write-Host with no explicit colour asks RawUI for the current
            foreground and background before writing. A null RawUI is a
            NullReferenceException on the first banner -- on Windows PowerShell
            5.1 only, which is the one interpreter this test exists to cover.
        */
        private readonly LoopbackRawUI _raw = new LoopbackRawUI();
        public override PSHostRawUserInterface RawUI { get { return _raw; } }
    }

    /*
        Enough of a raw interface to satisfy the cmdlets this test drives.
        Nothing here is drawn; the buffer is a fiction of a fixed size and the
        colours are whatever was last set.
    */
    public class LoopbackRawUI : PSHostRawUserInterface
    {
        private ConsoleColor _fg = ConsoleColor.Gray;
        private ConsoleColor _bg = ConsoleColor.Black;
        private Coordinates _cursor = new Coordinates(0, 0);
        private Coordinates _window = new Coordinates(0, 0);
        private Size _buffer = new Size(120, 400);
        private Size _windowSize = new Size(120, 50);
        private string _title = "OpeniLoopbackHost";
        private int _cursorSize = 25;

        public override ConsoleColor ForegroundColor { get { return _fg; } set { _fg = value; } }
        public override ConsoleColor BackgroundColor { get { return _bg; } set { _bg = value; } }
        public override Coordinates CursorPosition { get { return _cursor; } set { _cursor = value; } }
        public override Coordinates WindowPosition { get { return _window; } set { _window = value; } }
        public override int CursorSize { get { return _cursorSize; } set { _cursorSize = value; } }
        public override Size BufferSize { get { return _buffer; } set { _buffer = value; } }
        public override Size WindowSize { get { return _windowSize; } set { _windowSize = value; } }
        public override Size MaxWindowSize { get { return new Size(120, 50); } }
        public override Size MaxPhysicalWindowSize { get { return new Size(120, 50); } }
        public override string WindowTitle { get { return _title; } set { _title = value; } }
        public override bool KeyAvailable { get { return false; } }

        public override void FlushInputBuffer() { }

        public override KeyInfo ReadKey(ReadKeyOptions options)
        {
            throw new NotSupportedException("The loopback host does not read keys.");
        }

        public override BufferCell[,] GetBufferContents(Rectangle rectangle)
        {
            return new BufferCell[0, 0];
        }

        public override void ScrollBufferContents(
            Rectangle source, Coordinates destination, Rectangle clip, BufferCell fill) { }

        public override void SetBufferContents(Coordinates origin, BufferCell[,] contents) { }

        public override void SetBufferContents(Rectangle rectangle, BufferCell fill) { }
    }

    public class LoopbackHost : PSHost
    {
        private readonly Guid _id = Guid.NewGuid();
        public readonly LoopbackUI TheUI = new LoopbackUI();

        public override string Name { get { return "OpeniLoopbackHost"; } }
        public override Version Version { get { return new Version(1, 0); } }
        public override Guid InstanceId { get { return _id; } }
        public override PSHostUserInterface UI { get { return TheUI; } }
        public override CultureInfo CurrentCulture { get { return CultureInfo.InvariantCulture; } }
        public override CultureInfo CurrentUICulture { get { return CultureInfo.InvariantCulture; } }
        public override void EnterNestedPrompt() { }
        public override void ExitNestedPrompt() { }
        public override void NotifyBeginApplication() { }
        public override void NotifyEndApplication() { }
        public override void SetShouldExit(int exitCode) { }
    }
}
'@ }
    if ($PSVersionTable.PSEdition -ne 'Core') {
        # Derived from the types the source actually uses rather than typed out,
        # so this cannot name an assembly that is missing or miss one that is
        # needed: mscorlib, System, and the automation assembly.
        $addType['ReferencedAssemblies'] = @(
            [object].Assembly.Location
            [System.Uri].Assembly.Location
            [System.Management.Automation.PSObject].Assembly.Location
        ) | Where-Object { $_ } | Sort-Object -Unique
    }
    Add-Type @addType
}

# ---------------------------------------------------------------------------
# The listener. Canned answers, and every request recorded.

<#
    BOTH SPELLINGS OF LOOPBACK, IN THAT ORDER.

    On Windows, HttpListener will bind `http://localhost:port/` for an
    unprivileged user, but a literal `http://127.0.0.1:port/` prefix normally
    needs a netsh URL reservation and otherwise throws "Access is denied".
    Elsewhere the literal address is the one that binds cleanly. Trying both
    means this test does not depend on how the runner is privileged.

    Either way the traffic stays on the loopback interface, and the script under
    test accepts nothing else: it refuses any origin whose host is not
    127.0.0.1, localhost or ::1.
#>
$listener = New-Object System.Net.HttpListener
$origin = $null
foreach ($candidate in 8081..8140) {
    foreach ($hostName in 'localhost', '127.0.0.1') {
        try {
            $listener.Prefixes.Clear()
            $listener.Prefixes.Add("http://${hostName}:$candidate/")
            $listener.Start()
            $origin = "http://${hostName}:$candidate"
            break
        } catch { $listener = New-Object System.Net.HttpListener }
    }
    if ($origin) { break }
}
if (-not $origin) { throw 'Could not bind a loopback port.' }
Write-Host "Loopback listener on $origin/"

$script:Captured = New-Object System.Collections.ArrayList

$serve = {
    param($listenerRef, $capturedRef, $email)
    while ($listenerRef.IsListening) {
        $context = $null
        try { $context = $listenerRef.GetContext() } catch { break }
        $request = $context.Request

        $bodyText = ''
        if ($request.HasEntityBody) {
            $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
            $bodyText = $reader.ReadToEnd()
            $reader.Close()
        }

        $headers = @{}
        foreach ($name in $request.Headers.AllKeys) { $headers[$name] = $request.Headers[$name] }

        [void] $capturedRef.Add([pscustomobject]@{
            Method    = $request.HttpMethod
            RawUrl    = $request.RawUrl
            Headers   = $headers
            Body      = $bodyText
            UserAgent = $request.UserAgent
        })

        # Canned answers, shaped so the script walks all the way through.
        $payload =
            if ($request.RawUrl -like '*auth_invite_allowlist*') {
                '[{"email_normalized":"' + $email + '"}]'
            } elseif ($request.RawUrl -like '*admin/users*') {
                '{"users":[]}'
            } else {
                '{"id":"00000000-0000-4000-8000-000000000001","email":"' + $email + '"}'
            }

        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'application/json'
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
}

$runspace = [runspacefactory]::CreateRunspace()
$runspace.Open()
$server = [powershell]::Create()
$server.Runspace = $runspace
[void] $server.AddScript($serve).AddArgument($listener).AddArgument($script:Captured).AddArgument($FAKE_EMAIL)
$serverHandle = $server.BeginInvoke()

<#
    A snapshot of the temp directories BEFORE the run.

    Sweeping every recent temp file was both slow and hazardous: a Unix temp
    directory can hold a FIFO, and reading one blocks until somebody writes to
    it, which nobody will -- that is what hung this test. The set that actually
    matters is the files this run created or changed, so that is what gets read.
#>
$tempDirs = @($env:TEMP, $env:TMP, [System.IO.Path]::GetTempPath()) |
    Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

function Get-TempSnapshot {
    param([string[]] $Dirs)
    $map = @{}
    foreach ($d in $Dirs) {
        foreach ($f in (Get-ChildItem -Path $d -File -ErrorAction SilentlyContinue)) {
            $map[$f.FullName] = '{0}|{1}' -f $f.LastWriteTimeUtc.Ticks, $f.Length
        }
    }
    return $map
}
$tempBefore = Get-TempSnapshot -Dirs $tempDirs

$hostShim = New-Object Openi.LoopbackHost
$hostShim.TheUI.LineAnswer = $FAKE_EMAIL
$hostShim.TheUI.SecureAnswer = $FAKE_SECRET

$plantedHeaders = $null

try {
    # -----------------------------------------------------------------------
    # 1. The REAL script, driven through a host that answers its prompts.
    $scriptRunspace = [runspacefactory]::CreateRunspace($hostShim)
    $scriptRunspace.Open()
    $shell = [powershell]::Create()
    $shell.Runspace = $scriptRunspace
    $command = $shell.AddCommand($ScriptPath, $false).
        AddParameter('SupabaseOriginForLoopbackTest', $origin)
    if ($Branch) { $command = $command.AddParameter('Branch', $Branch) }
    [void] $command
    try { $shell.Invoke() } catch { }
    $shellErrors = ($shell.Streams.Error | ForEach-Object { $_.ToString() }) -join "`n"
    $shell.Dispose()
    $scriptRunspace.Close()

    $output = $hostShim.TheUI.Written.ToString()

    # -----------------------------------------------------------------------
    # 2. The PLANTED regression: the exact construction that produced the 401.
    #    Sent to the same listener so the two can be compared byte for byte.
    $planted = @{
        Method          = 'GET'
        Uri             = "$origin/rest/v1/planted_regression"
        Headers         = @{ apikey = $FAKE_SECRET; Authorization = "Bearer $FAKE_SECRET" }
        UseBasicParsing = $true
        ErrorAction     = 'SilentlyContinue'
    }
    try { $null = Invoke-WebRequest @planted } catch { }

    Start-Sleep -Milliseconds 250
    $requests = @($script:Captured)
    $plantedHeaders = $requests | Where-Object { $_.RawUrl -like '*planted_regression*' } | Select-Object -First 1
    $real = @($requests | Where-Object { $_.RawUrl -notlike '*planted_regression*' })

    # -----------------------------------------------------------------------
    <#
        The script's own console output, echoed so a CI failure is diagnosable
        without a Windows machine to reproduce it on. Redacted anyway: the key
        here is fake, but a test that prints secrets teaches the wrong habit.
    #>
    Write-Host "`n== What the script printed"
    Write-Host ($output -replace [regex]::Escape($FAKE_SECRET), '<SECRET>')
    if ($shellErrors) {
        Write-Host "-- error stream --"
        Write-Host ($shellErrors -replace [regex]::Escape($FAKE_SECRET), '<SECRET>')
    }

    Write-Host "`n== The three Supabase operations"
    Check 'all three operations reached the listener' ($real.Count -eq 3) "saw $($real.Count)"
    foreach ($expected in 'auth_invite_allowlist', 'admin/users', 'auth/v1/invite') {
        Check "operation present: $expected" (
            [bool] (@($real) | Where-Object { $_.RawUrl -like "*$expected*" })
        ) 'not seen'
    }

    Write-Host "`n== Header construction, on every request"
    foreach ($r in $real) {
        $label = ($r.RawUrl -split '\?')[0]

        Check "$label sends apikey" ($r.Headers.ContainsKey('apikey')) 'no apikey header'
        Check "$label apikey carries the prompted secret" ($r.Headers['apikey'] -ceq $FAKE_SECRET) 'apikey is not the secret'

        # THE BUG. An opaque key in Authorization is parsed as a JWT and refused.
        $auth = if ($r.Headers.ContainsKey('Authorization')) { $r.Headers['Authorization'] } else { '' }
        Check "$label sends no Authorization header at all" ([string]::IsNullOrEmpty($auth)) "Authorization: $($auth -replace [regex]::Escape($FAKE_SECRET), '<SECRET>')"
        Check "$label Authorization does not carry the secret" ($auth -notlike "*$FAKE_SECRET*") 'the secret is in Authorization'

        Check "$label User-Agent is the operator constant" ($r.UserAgent -ceq $EXPECTED_USER_AGENT) "got '$($r.UserAgent)'"
        Check "$label User-Agent is not browser-shaped" ($r.UserAgent -notmatch 'Mozilla|WindowsPowerShell|Chrome|Safari') "got '$($r.UserAgent)'"

        Check "$label keeps the secret out of the URL" ($r.RawUrl -notlike "*$FAKE_SECRET*") 'secret in the URL'
        Check "$label keeps the secret out of the body" ($r.Body -notlike "*$FAKE_SECRET*") 'secret in the body'
    }

    Write-Host "`n== One builder, one shape"
    $shapes = @($real | ForEach-Object {
        (@($_.Headers.Keys | Where-Object { $_ -in 'apikey', 'Authorization' } | Sort-Object) -join ',') +
        '|' + $_.UserAgent
    } | Sort-Object -Unique)
    Check 'every operation produced an identical credential shape' ($shapes.Count -eq 1) ($shapes -join ' AND ')
    Check 'that shape is apikey-only with the operator agent' (
        $shapes.Count -eq 1 -and $shapes[0] -ceq "apikey|$EXPECTED_USER_AGENT"
    ) ($shapes -join ' ')

    Write-Host "`n== The planted regression, for contrast"
    Check 'the planted request DID carry the secret in Authorization' (
        $plantedHeaders -and $plantedHeaders.Headers['Authorization'] -clike "*$FAKE_SECRET*"
    ) 'the planted construction did not reproduce'
    Check 'the corrected script emits nothing like it' (
        -not (@($real) | Where-Object { $_.Headers.ContainsKey('Authorization') })
    ) 'a real request carried an Authorization header'

    Write-Host "`n== The secret does not escape"
    Check 'not in the script output' ($output -notlike "*$FAKE_SECRET*") 'secret printed'
    Check 'not in the error stream' ($shellErrors -notlike "*$FAKE_SECRET*") 'secret in errors'
    Check 'not in this process command line' (
        [Environment]::CommandLine -notlike "*$FAKE_SECRET*"
    ) 'secret on the command line'
    Check 'no header block was printed' (
        $output -notmatch 'apikey' -and $output -notmatch 'Authorization'
    ) 'headers reached the console'
    Check 'no invitation response body was printed' ($output -notmatch '"id"\s*:') 'a response body was printed'

    # Only what this run created or changed -- a handful of files, and the only
    # ones that could contain a secret this run handled.
    $tempAfter = Get-TempSnapshot -Dirs $tempDirs
    $touched = @($tempAfter.Keys | Where-Object {
        -not $tempBefore.ContainsKey($_) -or $tempBefore[$_] -ne $tempAfter[$_]
    })
    $leaky = @()
    foreach ($path in $touched) {
        try {
            $info = Get-Item -LiteralPath $path -ErrorAction Stop
            if ($info.Length -le 0 -or $info.Length -gt 1MB) { continue }
            if ((Get-Content -LiteralPath $path -Raw -ErrorAction Stop) -like "*$FAKE_SECRET*") {
                $leaky += $path
            }
        } catch { }
    }
    Check "not in any of the $($touched.Count) temporary files this run touched" (
        $leaky.Count -eq 0
    ) ($leaky -join ', ')

    Write-Host "`n== The script still did its job"
    Check 'it reported the invitation as sent' ($output -match 'invitation sent to') 'the run did not complete'
}
finally {
    # Torn down without waiting on the serve loop. `GetContext()` does not
    # reliably return after `Stop()`, so waiting on EndInvoke can block for
    # ever; stopping the pipeline is what actually ends it.
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
    try { $server.Stop() } catch { }
    try { $server.Dispose() } catch { }
    try { $runspace.Dispose() } catch { }
    $serverHandle = $null
}

Write-Host ''
Write-Host "$script:Pass passed, $script:Fail failed"
if ($script:Fail -gt 0) { exit 1 }
exit 0
