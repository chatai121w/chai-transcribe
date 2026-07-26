function Test-LocalPortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)

    # On Windows, IPv4 and IPv6 listeners can coexist on the same numeric port.
    # `localhost` may resolve to either one, so any existing listener makes the
    # port unavailable even when a bind test for the other address succeeds.
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        $existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($null -ne $existing) {
            return $false
        }
    }

    $sockets = [System.Collections.Generic.List[System.Net.Sockets.Socket]]::new()
    try {
        foreach ($address in @(
            [System.Net.IPAddress]::Loopback,
            [System.Net.IPAddress]::IPv6Loopback
        )) {
            $socket = [System.Net.Sockets.Socket]::new(
                $address.AddressFamily,
                [System.Net.Sockets.SocketType]::Stream,
                [System.Net.Sockets.ProtocolType]::Tcp
            )
            $socket.ExclusiveAddressUse = $true
            if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
                $socket.DualMode = $false
            }
            $socket.Bind([System.Net.IPEndPoint]::new($address, $Port))
            $sockets.Add($socket)
        }
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        foreach ($socket in $sockets) {
            try { $socket.Dispose() } catch { }
        }
    }
}

function Resolve-AvailablePort {
    param(
        [Parameter(Mandatory = $true)][int]$PreferredPort,
        [int]$MaxAttempts = 100
    )

    for ($offset = 0; $offset -lt $MaxAttempts; $offset++) {
        $candidate = $PreferredPort + $offset
        if (Test-LocalPortAvailable -Port $candidate) {
            return $candidate
        }
    }

    throw "No available local port found from $PreferredPort through $($PreferredPort + $MaxAttempts - 1)."
}
