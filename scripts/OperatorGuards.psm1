<#
.SYNOPSIS
    The refusals every operator script on this project shares.

.DESCRIPTION
    Both `Invoke-HostedValidation.ps1` and `Send-BootstrapInvitation.ps1` handle
    the Supabase secret key and both act against a specific commit of a specific
    repository. The checks that make either of those safe are identical, so they
    live here once rather than being copied and drifting apart — a guard that
    exists in two places is a guard that will eventually be strengthened in one.

    Nothing in this module prints, stores, or returns a secret. `Use-Plain`
    hands one to a scriptblock for the duration of a single call and zeroes the
    unmanaged buffer on the way out; everything else deals in SecureString.
#>

Set-StrictMode -Version Latest

function Assert-NoObservation {
    <#
        Refuse to run anywhere the console could be recorded.

        Every one of these would capture what the redactors protect: a
        transcript writes console output to a file, verbose and debug streams
        echo request detail, a breakpoint can read process memory, and script
        tracing prints expanded lines including headers.
    #>
    [CmdletBinding()]
    param()

    if ($VerbosePreference -ne 'SilentlyContinue') {
        throw 'Refusing to run with verbose output enabled: it would echo request detail.'
    }
    if ($DebugPreference -ne 'SilentlyContinue') {
        throw 'Refusing to run with debug output enabled: it would echo request detail.'
    }
    if (Get-PSBreakpoint) {
        throw 'Refusing to run with debugger breakpoints set: a breakpoint can read process memory.'
    }
    if (Test-Path variable:PSDebugContext) {
        throw 'Refusing to run inside the debugger.'
    }
    # A caller can force -Verbose or -Debug onto every command from here.
    foreach ($key in @($PSDefaultParameterValues.Keys)) {
        if ($key -match ':(Verbose|Debug)$' -and $PSDefaultParameterValues[$key]) {
            throw "Refusing to run: `$PSDefaultParameterValues sets $key, which would echo request detail."
        }
    }

    # There is no public way to read the current trace level, so switch it off
    # rather than test for it. Anything traced so far happened before any prompt,
    # so no secret has been shown.
    Set-PSDebug -Off

    # Stop-Transcript throws when none is running, which is how one is detected.
    # If one WAS running it is now stopped, and we still refuse — the operator
    # should start a clean session rather than trust a partially captured one.
    $transcribing = $false
    try { Stop-Transcript | Out-Null; $transcribing = $true } catch { $transcribing = $false }
    if ($transcribing) {
        throw 'A PowerShell transcript was running and has been stopped. Start a clean session and run again.'
    }
}

function Invoke-OperatorGit {
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Arguments)
    $output = & git @Arguments 2>&1
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($output -join "`n").Trim() }
}

function Assert-CorrectCheckout {
    <#
        Refuse to act on behalf of a tree that is not the pull request.

        Returns the head SHA. Throws with a specific reason otherwise; the
        caller is expected to let that reach the operator, because every one of
        these is a mistake worth naming.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Repository,
        [Parameter(Mandatory)] [string] $Branch,
        [string] $ExpectedHead,
        [scriptblock] $Report = { param($message) Write-Host $message }
    )

    $top = Invoke-OperatorGit rev-parse --show-toplevel
    if ($top.Code -ne 0) { throw 'Not inside a git repository. cd into the clone and run again.' }
    & $Report "  note  repository root: $($top.Text)"

    $remote = (Invoke-OperatorGit remote get-url origin).Text
    # Accept https and ssh spellings of the same repository, and a trailing .git.
    $normalised = ($remote -replace '^git@github\.com:', '' `
                           -replace '^https://github\.com/', '' `
                           -replace '\.git$', '').Trim()
    if ($normalised -ne $Repository) {
        throw "origin is '$normalised', expected '$Repository'. This script must not run against another repository."
    }
    & $Report "  PASS  origin is $Repository"

    $dirty = (Invoke-OperatorGit status --porcelain).Text
    if ($dirty) {
        throw "The working tree is not clean. Acting on behalf of a tree that differs from the pull request proves nothing about the pull request.`n$dirty"
    }
    & $Report '  PASS  working tree is clean'

    $current = (Invoke-OperatorGit rev-parse --abbrev-ref HEAD).Text
    if ($current -ne $Branch) {
        throw "On branch '$current', expected '$Branch' (the head branch of PR #9)."
    }
    & $Report "  PASS  on $Branch"

    $fetch = Invoke-OperatorGit fetch origin $Branch
    if ($fetch.Code -ne 0) { throw "Could not fetch origin/$Branch : $($fetch.Text)" }

    $head = (Invoke-OperatorGit rev-parse HEAD).Text
    $remoteHead = (Invoke-OperatorGit rev-parse FETCH_HEAD).Text
    if ($head -ne $remoteHead) {
        throw "HEAD is $head but origin/$Branch is $remoteHead. Pull, then run again — the pull request is the remote branch."
    }
    & $Report "  PASS  HEAD matches origin/$Branch"

    if ($ExpectedHead) {
        if ($head -ne $ExpectedHead) { throw "HEAD is $head but -ExpectedHead was $ExpectedHead." }
        & $Report '  PASS  HEAD matches the supplied expected head'
    }

    & $Report "  head: $head"
    return $head
}

function Read-SecretValue {
    <#
        The ONLY way either script takes a confidential value.

        -AsSecureString hides the typed characters and never places them on a
        command line, so they reach neither the console buffer nor PSReadLine's
        history file.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Prompt)

    $value = Read-Host -Prompt $Prompt -AsSecureString
    if (-not $value -or $value.Length -eq 0) { throw "$Prompt is required." }
    return $value
}

function Use-Plain {
    <#
        Materialise a SecureString for exactly as long as the caller needs it.

        The BSTR is zeroed on the way out. The .NET String handed to the
        scriptblock cannot be zeroed — strings are immutable and the runtime
        owns the copy — which is a limitation of the platform, not a choice made
        here. Keeping its lifetime to a single call is the mitigation.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [securestring] $Secure,
        [Parameter(Mandatory)] [scriptblock] $Body
    )

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        try { & $Body $plain } finally { $plain = $null }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Export-ModuleMember -Function Assert-NoObservation, Assert-CorrectCheckout,
    Invoke-OperatorGit, Read-SecretValue, Use-Plain
