function Test-LocalPortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            $Port
        )
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        if ($null -ne $listener) {
            try { $listener.Stop() } catch { }
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
