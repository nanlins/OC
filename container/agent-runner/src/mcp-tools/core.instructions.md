# core — 消息投递工具

用途：把回复送到渠道（send_message / send_file / edit_message / add_reaction）。

关键约束：
- `send_message` 是默认回话通道；投递目标由宿主路由（destinations ACL）决定，工具不指定任意目标。
- `edit_message` 与流式投递配合（operation=edit），编辑对象是消息 id，不是猜测的文本匹配。
- `send_file` 的文件来自容器工作区（/workspace），出站前经宿主附件安全检查。
- 工具错误不得中断主循环：executeToolCall 捕获并回传错误文本给模型。
