$ErrorActionPreference = 'Stop'

$models = @('qwen2.5:14b','aya:8b','gemma2:9b','mistral-nemo:12b')
$cases = @(
  @{Name='case1'; Text='שלום לכולם היום אנחנו ניפגש בשעה שמונה בערב ונדון על התוכנית החדשה אני מבקש מכל אחד לשלוח את העידכון שלו עד מחר בבוקר תודה רבה'},
  @{Name='case2'; Text='אתמול דברתי עם הלקוח והוא אמר שהמערכת עובדת טוב אבל יש כמה בעיות קטנות בממשק משתמש שצריך לטפל בהם בהקדם האפשרי כדי לא לעכב את העליה לאוויר'},
  @{Name='case3'; Text='בישיבה האחרונה החלטנו להעביר את הנתונים לשרת חדש כי השרת הישן נהיה איטי מאוד וזה משפיע על כל הצוות במיוחד בשעות עומס ולכן חשוב לסיים את המעבר השבוע'}
)
$systemPrompt = 'אתה עורך לשון מקצועי בעברית. המשימה: לתקן ניסוח, שגיאות כתיב, דקדוק ופיסוק בלבד. כללי חובה: 1) אסור להוסיף מידע חדש. 2) אסור למחוק מידע מהותי. 3) אסור לקצר או להרחיב תוכן. 4) שמור ככל האפשר על אותה משמעות, אותה רשימת עובדות ואותו סדר. החזר רק את הטקסט המתוקן.'

function Tokenize([string]$s) {
  return ($s.ToLower() -replace '[^\p{L}\p{Nd}\s]',' ' -split '\s+' | Where-Object { $_ -ne '' })
}

$results = @()
foreach ($m in $models) {
  foreach ($c in $cases) {
    $bodyObj = @{
      model = $m
      stream = $false
      messages = @(
        @{ role = 'system'; content = $systemPrompt },
        @{ role = 'user'; content = $c.Text }
      )
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Depth 8

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ok = $true
    $out = ''
    $errMsg = ''

    try {
      $resp = Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/chat' -ContentType 'application/json' -Body $jsonBody -TimeoutSec 240
      $out = [string]$resp.message.content
      if ([string]::IsNullOrWhiteSpace($out)) {
        $ok = $false
        $errMsg = 'Empty output'
      }
    } catch {
      $ok = $false
      $errMsg = $_.Exception.Message
    }

    $sw.Stop()
    $latMs = [math]::Round($sw.Elapsed.TotalMilliseconds,0)

    $inLen = [math]::Max(1, $c.Text.Length)
    $outLen = [math]::Max(1, $out.Length)
    $lenDriftPct = [math]::Round(([math]::Abs($outLen - $inLen) / $inLen) * 100, 2)

    $inTok = Tokenize $c.Text
    $outTok = Tokenize $out
    $inSet = [System.Collections.Generic.HashSet[string]]::new($inTok)
    $outSet = [System.Collections.Generic.HashSet[string]]::new($outTok)
    $overlap = 0
    foreach ($t in $inSet) {
      if ($outSet.Contains($t)) { $overlap++ }
    }
    $preservePct = if ($inSet.Count -gt 0) { [math]::Round(($overlap / $inSet.Count) * 100, 2) } else { 0 }

    $results += [pscustomobject]@{
      model = $m
      case = $c.Name
      ok = $ok
      latency_ms = $latMs
      preserve_pct = $preservePct
      len_drift_pct = $lenDriftPct
      input_text = $c.Text
      output_text = $out
      error = $errMsg
    }
  }
}

$summary = $results | Group-Object model | ForEach-Object {
  $g = $_.Group
  [pscustomobject]@{
    model = $_.Name
    success_rate_pct = [math]::Round((($g | Where-Object ok).Count / $g.Count) * 100, 2)
    avg_latency_ms = [math]::Round((($g | Measure-Object latency_ms -Average).Average), 0)
    avg_preserve_pct = [math]::Round((($g | Measure-Object preserve_pct -Average).Average), 2)
    avg_len_drift_pct = [math]::Round((($g | Measure-Object len_drift_pct -Average).Average), 2)
  }
} | Sort-Object avg_preserve_pct -Descending

$summaryPath = 'offline_edit_summary.json'
$resultsPath = 'offline_edit_results.json'
$summary | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 $summaryPath
$results | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $resultsPath

Write-Output 'BENCHMARK_DONE'
Write-Output $summaryPath
Write-Output $resultsPath
