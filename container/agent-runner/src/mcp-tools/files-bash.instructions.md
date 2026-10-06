# files-bash — 文件与命令工具

用途：read_file / write_file / list_files / bash。

关键约束：
- 所有路径 resolve 后必须落在 /workspace 内（前缀校验），越界读取被拒。
- `bash` 在容器沙箱内执行（--cap-drop=ALL），超时 clamp 到 10 分钟上限；结果按 24KB 截断回传。
- 写文件不得覆盖宿主挂载的只读面（container.json / CLAUDE.md 是 RO 挂载）。
- 大文件读取按预算截断，先读头部——不要整文件读入再截。
