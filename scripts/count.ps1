$root = (Get-Location).Path + '\'
$files = Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.css,*.sql,*.sh | Where-Object { $_.FullName -notmatch 'node_modules|\\\.git|pnpm-lock|\\data\\' }
$rows = foreach ($f in $files) {
    $rel = $f.FullName.Replace($root, '')
    $lines = (Get-Content -LiteralPath $f.FullName).Count
    [PSCustomObject]@{ Rel = $rel; Lines = $lines; Dir = (($rel -split '\\')[0..1] -join '\') }
}
Write-Output ("TOTAL files={0} lines={1}" -f $rows.Count, (($rows | Measure-Object Lines -Sum).Sum))
$rows | Group-Object Dir | Sort-Object { -($_.Group | Measure-Object Lines -Sum).Sum } | ForEach-Object {
    '{0,-45} {1,5} files {2,8} lines' -f $_.Name, $_.Count, ($_.Group | Measure-Object Lines -Sum).Sum
}
