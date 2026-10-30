export function buildBotRuntimeToolInstructions(toolNames: readonly string[], isProjectSession: boolean): string {
  const available = new Set(toolNames);
  const rules = ["只允许调用本次执行实际提供的工具；不要猜测、拼写或调用未提供的工具。"];

  if (isProjectSession) {
    rules.push("你正在所属 Project 的 Session 中执行已分配工作；不要自行创建或派发其他项目任务。");
  } else {
    if ([...available].some(name => name.startsWith("bot_project_") && name !== "bot_project_directory" && name !== "bot_project_search")) {
      rules.push("bot_project_<项目ID> 只用于感知该项目存在。它只返回数据库已保存的项目信息，不能读取项目，也不能写入项目；没有项目 Agent 仍表示项目存在，但不表示可以派发。");
    }
    if (available.has("bot_project_directory")) {
      rules.push("你是协调 Agent。bot_project_directory 是当前总对话绑定 Project/Agent 的权威运行时目录，处理项目需求前调用它确认范围与角色；该工具只提供感知/路由元数据，不提供项目文件或操作能力。不要从角色说明、cwd 或历史消息扩大范围。");
    } else {
      rules.push("本次执行未提供 bot_project_directory，不能推断可用 Project/Agent 范围；不得声称已核实项目存在或权限。");
    }
    if (available.has("bot_create_task")) {
      if (available.has("bot_start_work") && available.has("bot_continue_work")) {
        rules.push("项目源码、文件、测试、运行状态的读取或修改一律通过 Work→bot_create_task→项目 Session。普通聊天不创建 Work；明确需要项目协作时，直接用户请求只调用一次 bot_start_work，后续意见只调用一次 bot_continue_work 关联准确的 open Work。Work 成功后再派 Task，每个 Task 必须明确选择 reuse(sessionId) 或 new(projectId/agentId/topic/creationReason)。追问、答复、重试及相关新 Task 优先复用原 Session，Session 忙碌时排队；只有首次使用、独立主题或确有并行需要才新建并说明原因。应用回执会返回实际 Project/Agent/Session 与复用结果；不得把排队当完成，也不得在复用失败时换成新建。");
      } else {
        rules.push("本轮由协调内部事件或既有工作唤醒；没有 bot_start_work/bot_continue_work，不能新建或改挂 Work。先用 bot_status 确认准确 open Work；只有当前事件已有明确 Work 时才可用 bot_create_task 派发续办。项目操作仍必须进入项目 Session。");
      }
    } else {
      rules.push("本次执行没有 bot_create_task，当前不能派发项目任务；仍可使用 Project Directory 说明本会话范围。若请求需要项目操作，说明本轮调度或角色能力不允许派发，不要自行读取项目，也不要声称已创建任务。");
    }
    rules.push("协调会话没有 Project 源文件搜索/读取/修改/测试工具。动态项目存在性工具、bot_project_directory、bot_session_directory、bot_session_context 和 bot_agent_definition 只供了解范围、角色及协作状态；不能据此声称检查了源码。Bot 工作区文件工具若因与 Project 根目录重叠而未注入，也不得尝试从其他入口读取该项目。");
  }

  if (available.has("bot_message")) {
    rules.push("bot_message 仅用于当前总对话内角色之间的问题/答复，不用于创建或派发项目任务。");
  } else {
    rules.push("本次执行未提供 bot_message；不要尝试调用它，也不要声称已向其他角色发送或送达消息。");
  }

  return `本次运行工具约束：\n${rules.map(rule => `- ${rule}`).join("\n")}`;
}
