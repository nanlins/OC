$root = (Get-Location).Path + '\'
$ext = @('*.ts','*.tsx','*.css','*.sql','*.sh','*.md')
$files = Get-ChildItem -Recurse -File -Include $ext | Where-Object { $_.FullName -notmatch 'node_modules|\\\.git|pnpm-lock|\\data\\' }
$rows = foreach ($f in $files) {
    $rel = $f.FullName.Replace($root, '')
    $lines = (Get-Content -LiteralPath $f.FullName).Count
    [PSCustomObject]@{ Rel = $rel; Lines = $lines; Dir = (($rel -split '\\')[0..1] -join '\') }
}
$out = @()
$out += ("CODE+DOC TOTAL files={0} lines={1}" -f $rows.Count, (($rows | Measure-Object Lines -Sum).Sum))
$code = $rows | Where-Object { $_.Rel -notmatch '\.md$' }
$out += ("CODE ONLY (ts/tsx/css/sql/sh) files={0} lines={1}" -f $code.Count, (($code | Measure-Object Lines -Sum).Sum))
$out += ""
$out += ($rows | Group-Object Dir | Sort-Object { -($_.Group | Measure-Object Lines -Sum).Sum } | ForEach-Object {
    '{0,-50} {1,5} files {2,8} lines' -f $_.Name, $_.Count, ($_.Group | Measure-Object Lines -Sum).Sum
})
$out += ""
$out += "=== Top 25 largest files ==="
$out += ($rows | Sort-Object Lines -Descending | Select-Object -First 25 | ForEach-Object { '{0,7}  {1}' -f $_.Lines, $_.Rel })
$out | Out-File -FilePath scripts\count-out.txt -Encoding utf8
Get-Content scripts\count-out.txt
