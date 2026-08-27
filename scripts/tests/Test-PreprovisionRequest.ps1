<#
.SYNOPSIS
    Capture what New-PreprovisionedAccounts.ps1 really sends, on Windows
    PowerShell 5.1, and prove that none of it is an email.

.DESCRIPTION
    THE CLAIM BEING TESTED IS A NEGATIVE, WHICH IS WHY IT IS TESTED ON THE WIRE.

    "This script sends no invitation, confirmation, magic-link or recovery
    email" cannot be established by reading the source: the absence of a call is
    invisible in a diff, and any future edit could add one. What CAN be
    established is that across a complete run, the only endpoints touched are
    the allowlist lookup, the existing-user lookup and the admin create-user
    endpoint -- and that no request anywhere carries a password field.

    So this runs the ACTUAL script against an HttpListener on loopback, through
    a PSHost that answers its prompts, and inspects every request that arrives.

    Three runs, because the interesting behaviour is conditional:
      1. the happy path -- two allowlisted addresses, neither existing;
      2. an address that is not allowlisted -- nothing may be created;
      3. an address that already has an account -- it must be left alone.

    Every address here is fictitious and ends in .invalid. The real ones are
    never committed.
#>

[CmdletBinding()]
param(
    [string] $ScriptPath,
    [string] $Branch,

    <#
        ONE SCENARIO PER PROCESS.

        Running all four in one process is what this originally did, and on
        Windows PowerShell 5.1 it failed in a new way each time it was fixed:
        state shared with the listener runspace was silently not shared, or was
        unrolled, or was read across threads; and tearing a listener down
        between runs killed the process outright, so the test stopped mid-way
        and reported nothing at all.

        None of that is what is being tested. `Test-InvitationRequest.ps1` runs
        one listener and one invocation in one process and has been reliable on
        5.1 from the start, so this uses the same shape: without -Scenario the
        script re-invokes ITSELF once per scenario as a child process and adds
        up the results. Each child is simple enough to be boring, which is the
        property a test harness most needs.
    #>
    [ValidateSet('happy', 'unlisted', 'existing', 'unconfirmed')]
    [string] $Scenario
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    # $PSScriptRoot is empty inside a param() default under Windows PowerShell 5.1.
    $ScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'New-PreprovisionedAccounts.ps1'
}
if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Cannot find the script under test at '$ScriptPath'."
}

if (-not $Scenario) {
    <#
        The parent. Runs each scenario in its own process and aggregates.

        `powershell.exe` explicitly on Windows so a child is the same
        interpreter as the parent; `pwsh` elsewhere. The exit code is the only
        thing that matters, and each child prints its own results.
    #>
    $interpreter = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
    $failed = 0
    foreach ($name in 'happy', 'unlisted', 'existing', 'unconfirmed') {
        Write-Host ""
        Write-Host "=============== scenario: $name ===============" -ForegroundColor Cyan
        $arguments = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', $PSCommandPath,
            '-Scenario', $name,
            '-ScriptPath', $ScriptPath
        )
        if ($Branch) { $arguments += @('-Branch', $Branch) }
        & $interpreter @arguments
        if ($LASTEXITCODE -ne 0) {
            $failed++
            Write-Host "  scenario '$name' FAILED" -ForegroundColor Red
        }
    }
    Write-Host ""
    if ($failed -gt 0) {
        Write-Host "$failed of 4 scenarios failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "all 4 scenarios passed" -ForegroundColor Green
    exit 0
}

$FAKE_SECRET = 'sb_secret_PROVISION_FAKE_000000000000000'
# Every address below is fictitious and on an approved domain so the domain
# guard passes. They are declared next to the listener, because each one selects
# the behaviour the listener gives it.
$EXPECTED_USER_AGENT = 'Openi-Haskell-FB-Radar-Operator/1.0'

<# Endpoints that would send mail. NONE of these may ever be requested. #>
$EMAIL_SENDING_PATHS = @(
    '/auth/v1/invite',
    '/auth/v1/recover',
    '/auth/v1/magiclink',
    '/auth/v1/otp',
    '/auth/v1/signup',
    '/auth/v1/resend'
)

$script:Pass = 0
$script:Fail = 0
# Collected so the END of the log always names them. Each run echoes the whole
# script output, which is long enough that a truncated CI log can cut the
# failures off entirely -- and a failure you cannot read is a failure you cannot
# fix. This cost a diagnosis cycle.
$script:Failures = New-Object System.Collections.Generic.List[string]
function Ok([string] $What) { $script:Pass++; Write-Host "  PASS  $What" }
function No([string] $What, [string] $Why) {
    $script:Fail++
    Write-Host "  FAIL  $What -- $Why"
    [void] $script:Failures.Add("$What -- $Why")
}
function Check([string] $What, [bool] $Condition, [string] $Why = '') {
    if ($Condition) { Ok $What } else { No $What $Why }
}

# ---------------------------------------------------------------------------
if (-not ('Openi.ProvisionHost' -as [type])) {
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
    public class ProvisionUI : PSHostUserInterface
    {
        /*
            A QUEUE, not a single answer.

            This script asks several different questions in a row -- each
            address, then a blank line to end the list, then the word CREATE to
            confirm. One canned answer would make it impossible to drive, and
            answering by matching on the prompt text would couple the test to
            wording that is allowed to change. Order is the contract.
        */
        public readonly System.Collections.Generic.Queue<string> LineAnswers =
            new System.Collections.Generic.Queue<string>();
        public string SecureAnswer = "";
        public readonly StringBuilder Written = new StringBuilder();

        public override string ReadLine() { return NextLine(); }

        public string NextLine()
        {
            return LineAnswers.Count > 0 ? LineAnswers.Dequeue() : "";
        }

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
                    answers[d.Name] = PSObject.AsPSObject(NextLine());
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
        private readonly ProvisionRawUI _raw = new ProvisionRawUI();
        public override PSHostRawUserInterface RawUI { get { return _raw; } }
    }

    /*
        Enough of a raw interface to satisfy the cmdlets this test drives.
        Nothing here is drawn; the buffer is a fiction of a fixed size and the
        colours are whatever was last set.
    */
    public class ProvisionRawUI : PSHostRawUserInterface
    {
        private ConsoleColor _fg = ConsoleColor.Gray;
        private ConsoleColor _bg = ConsoleColor.Black;
        private Coordinates _cursor = new Coordinates(0, 0);
        private Coordinates _window = new Coordinates(0, 0);
        private Size _buffer = new Size(120, 400);
        private Size _windowSize = new Size(120, 50);
        private string _title = "OpeniProvisionHost";
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

    public class ProvisionHost : PSHost
    {
        private readonly Guid _id = Guid.NewGuid();
        public readonly ProvisionUI TheUI = new ProvisionUI();

        public override string Name { get { return "OpeniProvisionHost"; } }
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
# The listener. Canned answers chosen by a mode, and every request recorded.

# ---------------------------------------------------------------------------
# ONE listener, started once, whose answers depend only on WHICH ADDRESS is
# being asked about.
#
# WHY NOT A MODE THE TEST SWITCHES BETWEEN RUNS.
#
# That was tried three ways and every one of them failed on Windows PowerShell
# 5.1 while passing on PowerShell 7:
#
#   * a Hashtable passed through AddArgument() was not shared with the serve
#     runspace, so the loop kept answering with the first run's mode;
#   * a single-element ArrayList IS a collection, and PowerShell unrolls a
#     collection when binding it to a scriptblock parameter;
#   * a StringBuilder shared correctly but is not thread-safe, and the serve
#     loop read it while the test thread was clearing and refilling it.
#
# Giving each run its own listener removed the shared state but introduced a
# worse problem: tearing a runspace down while its pipeline is still blocked in
# GetContext() killed the whole process after the first run, so the test simply
# stopped mid-way and reported nothing.
#
# The scenario is a property of the ADDRESS, so it is encoded there. One
# listener, started once and stopped once, no mutable state, no per-run
# teardown, and nothing to marshal between runspaces. Each fictitious address
# selects its own behaviour.

# Fictitious, on an approved domain so the domain guard passes. One process
# provisions one list, so one pair of addresses serves every scenario -- what
# differs between them is how the LISTENER answers, not who is being asked
# about.
$ADDRESS = 'first.person@openi-analytics.com'
$ADDRESS_TWO = 'second.person@haskell.com'

$script:Captured = New-Object System.Collections.ArrayList

$serve = {
    param($listenerRef, $capturedRef, $scenario, $ADDRESS)
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

        # WHICH address this request is about, read back out of the request
        # itself. A run covering two people asks about each in turn, and a
        # double that answered with one fixed address would hand the second
        # person the first person's record -- which the script under test
        # rightly refuses as a mismatch. The double has to be as specific as
        # the real API is.
        $subject = $ADDRESS
        if ($bodyText -match '"email"\s*:\s*"([^"]+)"') {
            $subject = $Matches[1]
        } elseif ($request.RawUrl -match '(?:filter|eq)[=.]([^&]+)') {
            $subject = [System.Uri]::UnescapeDataString($Matches[1])
        }

        $payload =
            if ($request.RawUrl -like '*auth_invite_allowlist*') {
                # The one scenario in which nobody is on the list.
                if ($scenario -eq 'unlisted') { '[]' }
                else { '[{"email_normalized":"' + $subject + '"}]' }
            } elseif ($request.RawUrl -like '*admin/users?filter*') {
                if ($scenario -eq 'existing') {
                    '{"users":[{"id":"00000000-0000-4000-8000-000000000009","email":"' + $subject + '"}]}'
                } else { '{"users":[]}' }
            } else {
                # The create-user response. A full user record, never printed.
                '{"id":"00000000-0000-4000-8000-000000000001","email":"' + $subject + '","role":"authenticated"}'
            }

        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'application/json'
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
}

$listener = New-Object System.Net.HttpListener
$origin = $null
foreach ($candidate in 8141..8200) {
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

$runspace = [runspacefactory]::CreateRunspace()
$runspace.Open()
$server = [powershell]::Create()
$server.Runspace = $runspace
[void] $server.AddScript($serve).AddArgument($listener).AddArgument($script:Captured).
    AddArgument($Scenario).AddArgument($ADDRESS)
[void] $server.BeginInvoke()

function Invoke-Provisioning {
    <#
        One complete run of the real script, with the prompts answered in
        order: each address, a blank line to end the list, then the
        confirmation.
    #>
    param([string[]] $Addresses, [string] $Confirm = 'CREATE')

    $before = $script:Captured.Count

    $shim = New-Object Openi.ProvisionHost
    foreach ($address in $Addresses) { $shim.TheUI.LineAnswers.Enqueue($address) }
    $shim.TheUI.LineAnswers.Enqueue('')          # ends the address list
    $shim.TheUI.LineAnswers.Enqueue($Confirm)    # the confirmation
    $shim.TheUI.SecureAnswer = $FAKE_SECRET

    $runspaceForScript = [runspacefactory]::CreateRunspace($shim)
    $runspaceForScript.Open()
    $shell = [powershell]::Create()
    $shell.Runspace = $runspaceForScript
    $command = $shell.AddCommand($ScriptPath, $false).
        AddParameter('SupabaseOriginForLoopbackTest', $origin)
    if ($Branch) { $command = $command.AddParameter('Branch', $Branch) }
    [void] $command
    try { $shell.Invoke() } catch { }
    $errors = ($shell.Streams.Error | ForEach-Object { $_.ToString() }) -join "`n"
    $shell.Dispose()
    $runspaceForScript.Close()

    $requests = @()
    if ($script:Captured.Count -gt $before) {
        $requests = @($script:Captured[$before..($script:Captured.Count - 1)])
    }
    return [pscustomobject]@{
        Output   = $shim.TheUI.Written.ToString()
        Errors   = $errors
        Requests = $requests
    }
}

function Show([string] $Title, $Run) {
    Write-Host "`n== $Title" -ForegroundColor Cyan
    Write-Host ($Run.Output -replace [regex]::Escape($FAKE_SECRET), '<SECRET>')
    if ($Run.Errors) {
        Write-Host '-- error stream --'
        Write-Host ($Run.Errors -replace [regex]::Escape($FAKE_SECRET), '<SECRET>')
    }
}

try {
    # =====================================================================
    if ($Scenario -eq 'happy') {
    # 1. THE HAPPY PATH
    $happy = Invoke-Provisioning -Addresses @($ADDRESS, $ADDRESS_TWO)
    Show 'What the script printed (happy path)' $happy

    Write-Host "`n== No email is sent, by any endpoint"
    foreach ($path in $EMAIL_SENDING_PATHS) {
        Check "never requests $path" (
            -not (@($happy.Requests) | Where-Object { $_.RawUrl -like "$path*" })
        ) 'an email-sending endpoint was called'
    }

    Write-Host "`n== The create request"
    $creates = @($happy.Requests | Where-Object {
        $_.Method -eq 'POST' -and $_.RawUrl -eq '/auth/v1/admin/users'
    })
    Check 'one create per address' ($creates.Count -eq 2) "saw $($creates.Count)"

    foreach ($create in $creates) {
        $label = 'create'
        Check "$label goes to the Admin create-user endpoint" ($create.RawUrl -ceq '/auth/v1/admin/users')
        Check "$label sets email_confirm true" ($create.Body -match '"email_confirm"\s*:\s*true') $create.Body

        # THE CENTRAL NEGATIVE. No password, of any spelling, anywhere.
        Check "$label carries no password field" (
            $create.Body -notmatch '(?i)"password"'
        ) 'a password field is present'
        Check "$label carries no temporary-password field" (
            $create.Body -notmatch '(?i)temp|generated_password|initial_password'
        ) 'a temporary password field is present'

        # No role, and no metadata that could become one.
        Check "$label grants no role" ($create.Body -notmatch '(?i)"role"|app_metadata|"claims"') $create.Body

        Check "$label sends the secret only as apikey" (
            $create.Headers.ContainsKey('apikey') -and -not $create.Headers.ContainsKey('Authorization')
        ) 'the header construction is wrong'
        Check "$label uses the operator User-Agent" ($create.UserAgent -ceq $EXPECTED_USER_AGENT) $create.UserAgent
    }

    Write-Host "`n== The allowlist is checked BEFORE anything is created"
    $allowlistIndexes = @()
    $createIndexes = @()
    for ($i = 0; $i -lt $happy.Requests.Count; $i++) {
        if ($happy.Requests[$i].RawUrl -like '*auth_invite_allowlist*') { $allowlistIndexes += $i }
        if ($happy.Requests[$i].RawUrl -eq '/auth/v1/admin/users' -and $happy.Requests[$i].Method -eq 'POST') {
            $createIndexes += $i
        }
    }
    Check 'the allowlist is queried for every address' ($allowlistIndexes.Count -eq 2) "saw $($allowlistIndexes.Count)"
    Check 'every allowlist check precedes every creation' (
        $allowlistIndexes.Count -gt 0 -and $createIndexes.Count -gt 0 -and
        ($allowlistIndexes | Measure-Object -Maximum).Maximum -lt ($createIndexes | Measure-Object -Minimum).Minimum
    ) 'an account was created before the list was fully checked'

    Write-Host "`n== Nothing sensitive is printed"
    Check 'the secret is not in the output' ($happy.Output -notlike "*$FAKE_SECRET*") 'secret printed'
    Check 'no user record is printed' ($happy.Output -notmatch '"id"\s*:|"role"\s*:') 'a response body reached the console'
    Check 'no password is printed' ($happy.Output -notmatch '(?i)password is|temporary password|generated password') 'a password reached the console'
    Check 'the run reports what it did' ($happy.Output -match 'created:\s*2') $happy.Output
    Check 'it states that no email was sent' ($happy.Output -match 'No email was sent') 'the summary does not say so'

    # =====================================================================
    }

    if ($Scenario -eq 'unlisted') {
    # 2. AN ADDRESS THAT IS NOT ALLOWLISTED
    $refused = Invoke-Provisioning -Addresses @($ADDRESS)
    Show 'What the script printed (not allowlisted)' $refused

    Write-Host "`n== A non-allowlisted address creates nothing"
    Check 'no account is created' (
        -not (@($refused.Requests) | Where-Object { $_.Method -eq 'POST' -and $_.RawUrl -like '*admin/users*' })
    ) 'an account was created for an address that is not on the list'
    Check 'the refusal says so' ($refused.Output -match 'not on auth_invite_allowlist') $refused.Output
    Check 'and no email endpoint is touched either' (
        -not (@($refused.Requests) | Where-Object { $u = $_.RawUrl; $EMAIL_SENDING_PATHS | Where-Object { $u -like "$_*" } })
    ) 'an email-sending endpoint was called'

    # =====================================================================
    }

    if ($Scenario -eq 'existing') {
    # 3. AN ADDRESS THAT ALREADY HAS AN ACCOUNT
    $idempotent = Invoke-Provisioning -Addresses @($ADDRESS)
    Show 'What the script printed (already exists)' $idempotent

    Write-Host "`n== An existing account is left exactly as it is"
    Check 'nothing is created' (
        -not (@($idempotent.Requests) | Where-Object { $_.Method -eq 'POST' -and $_.RawUrl -like '*admin/users*' })
    ) 'it created a second account'
    Check 'nothing is updated' (
        -not (@($idempotent.Requests) | Where-Object { $_.Method -in 'PUT', 'PATCH', 'DELETE' })
    ) 'it modified an existing account'
    Check 'it is reported as existing' ($idempotent.Output -match 'already has an account') $idempotent.Output

    # =====================================================================
    }

    if ($Scenario -eq 'unconfirmed') {
    # 4. REFUSING TO CONFIRM CREATES NOTHING
    $aborted = Invoke-Provisioning -Addresses @($ADDRESS) -Confirm 'yes'
    Write-Host "`n== Confirmation must be exact"
    Check 'anything other than CREATE aborts' ($aborted.Output -match 'Not confirmed') $aborted.Output
    Check 'and nothing is created' (
        -not (@($aborted.Requests) | Where-Object { $_.Method -eq 'POST' })
    ) 'it created an account without confirmation'
    Check 'the key is never even requested' (
        $aborted.Output -notmatch 'Supabase secret key \(sb_secret'
    ) 'it asked for the key before the list was confirmed'
    }
}
catch {
    <#
        A TERMINATING ERROR IS A TEST RESULT, NOT AN ABSENCE OF ONE.

        Without this the script died after a run, the summary and the FAILURES
        section never printed, and the CI log ended mid-sentence -- so the step
        said "did not pass" and nothing said why. That cost a diagnosis cycle on
        an interpreter that has to be reached through CI.
    #>
    No 'the test itself ran to completion' "$($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)"
}
finally {
    # Stopped, not disposed. Disposing a runspace whose pipeline is still
    # blocked in GetContext() killed the process outright on Windows PowerShell
    # 5.1 -- the test simply stopped mid-way and reported nothing. Stopping the
    # listener is enough; the process is about to exit anyway.
    if ($listener.IsListening) { $listener.Stop() }
    try { $listener.Close() } catch { }
}

Write-Host ''
Write-Host "$script:Pass passed, $script:Fail failed"
if ($script:Fail -gt 0) {
    Write-Host ''
    Write-Host 'FAILURES'
    foreach ($failure in $script:Failures) { Write-Host "  $failure" }
    exit 1
}
exit 0
