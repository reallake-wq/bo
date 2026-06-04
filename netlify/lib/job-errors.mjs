function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return [value.stage, value.detail, value.error, value.message, value.name, value.status, value.code]
    .filter(Boolean)
    .join(" ");
}

function providerOf(text) {
  if (/tianyancha|天眼查/i.test(text)) return "tianyancha";
  if (/tavily/i.test(text)) return "tavily";
  if (/deepseek/i.test(text)) return "deepseek";
  if (/openai|gpt|chatgpt/i.test(text)) return "openai";
  if (/netlify|gateway|ai gateway/i.test(text)) return "netlify_ai_gateway";
  if (/model|模型|token|billing|quota|insufficient_quota/i.test(text)) return "model";
  if (/search|搜索/i.test(text)) return "search";
  return "";
}

function result(input) {
  return {
    errorType: input.errorType,
    errorProvider: input.errorProvider || "",
    recoverable: Boolean(input.recoverable),
    resumeStrategy: input.resumeStrategy || "manual_review",
    errorCause: input.errorCause,
    nextAction: input.nextAction,
    contactAdmin: Boolean(input.contactAdmin)
  };
}

export function classifyJobError(input = {}) {
  const text = textOf(input);
  const provider = providerOf(text);

  if (/cancelled|canceled|任务已停止|用户已停止|手动停止/i.test(text)) {
    return result({
      errorType: "cancelled_by_user",
      errorProvider: "",
      recoverable: false,
      resumeStrategy: "recreate_if_needed",
      errorCause: "任务被手动停止，不会继续生成正式报告。",
      nextAction: "如仍需要报告，请确认输入信息后重新创建任务。",
      contactAdmin: false
    });
  }

  if (/insufficient_quota|billing|payment|balance|余额不足|账户余额|模型余额|欠费|扣费|token.*不足|tokens.*exhausted/i.test(text)) {
    return result({
      errorType: "model_quota_exhausted",
      errorProvider: provider || "model",
      recoverable: true,
      resumeStrategy: "resume_from_checkpoint_or_retry_failed_step",
      errorCause: "模型调用额度、token 余额或计费状态不足，最终分析/整合无法继续。",
      nextAction: "请管理员检查模型服务余额、Netlify AI Gateway 或相关模型 Key 的计费状态；余额恢复后优先从断点继续或只重跑失败步骤。",
      contactAdmin: true
    });
  }

  if (/rate limit|too many requests|429|限流|请求过多|并发/i.test(text) && !/quota|credit|credits|额度|积分|次数不足/i.test(text)) {
    return result({
      errorType: "rate_limited",
      errorProvider: provider,
      recoverable: true,
      resumeStrategy: "retry_later_from_checkpoint",
      errorCause: "上游接口或模型服务触发限流，通常是短时间请求过多。",
      nextAction: "请等待 5-15 分钟后刷新状态或从断点继续；如频繁出现，请管理员降低并发或检查供应商限流策略。",
      contactAdmin: true
    });
  }

  if (/(天眼查|tianyancha|tavily|search|搜索).*(quota|credit|credits|limit|402|额度|积分|次数不足)|quota|credit|credits|402|额度|积分|次数不足/i.test(text)) {
    const isModel = /model|模型|token|billing|deepseek|openai|gateway/i.test(text) && !/(天眼查|tianyancha|tavily|search|搜索)/i.test(text);
    if (!isModel) {
      return result({
        errorType: "data_source_quota_exhausted",
        errorProvider: provider || "data_source",
        recoverable: true,
        resumeStrategy: "retry_later_or_generate_with_partial_evidence",
        errorCause: "数据源额度不足或接口暂时不可用，证据采集可能未完成。",
        nextAction: "请等待额度恢复，或由管理员补充/更换数据源 Key；如果已有足够证据，可先生成临时报告并标注缺失来源。",
        contactAdmin: true
      });
    }
  }

  if (/timeout|timed out|AbortError|超时|整合模型|最终整合|function timeout|execution timed out|运行预算|total budget exhausted/i.test(text)) {
    return result({
      errorType: /model|模型|整合|analysis|deepseek|openai/i.test(text) ? "model_timeout" : "execution_timeout",
      errorProvider: provider,
      recoverable: true,
      resumeStrategy: /最终整合|整合模型|analysis|模型/i.test(text) ? "retry_final_integration" : "resume_from_checkpoint",
      errorCause: "任务运行时间过长或模型响应超时，可能已完成部分证据采集。",
      nextAction: "请先刷新状态。若仍失败，优先从断点继续或只重跑最终整合，避免重新消耗检索额度。",
      contactAdmin: false
    });
  }

  if (/checkpoint missing|断点缺失|没有可恢复断点|无法进入自动续跑|断点保存失败/i.test(text)) {
    return result({
      errorType: "checkpoint_missing",
      errorProvider: "",
      recoverable: false,
      resumeStrategy: "recreate_job",
      errorCause: "系统没有找到可恢复断点，无法确认从哪一步继续。",
      nextAction: "请重新创建任务；为避免重复消耗额度，重新创建前先确认目标客户、我的企业和补充信息是否正确。",
      contactAdmin: false
    });
  }

  if (/身份|绑定|identity|license|授权|会话|tenant|租户|权限|unauthorized|forbidden|401|403/i.test(text)) {
    return result({
      errorType: "auth_or_context_error",
      errorProvider: "",
      recoverable: true,
      resumeStrategy: "fix_auth_or_context_then_recreate",
      errorCause: "任务缺少租户、授权、目标客户或我的企业绑定信息。",
      nextAction: "请确认授权登录状态、我的企业绑定和目标客户信息；仍无法恢复时联系管理员处理。",
      contactAdmin: true
    });
  }

  if (/not parseable JSON|parseable|JSON|empty content|empty response|model returned empty|输出格式|空响应/i.test(text)) {
    return result({
      errorType: "model_output_invalid",
      errorProvider: provider || "model",
      recoverable: true,
      resumeStrategy: "retry_failed_model_step",
      errorCause: "模型返回为空或格式不符合要求，系统无法完成结构化整合。",
      nextAction: "请刷新状态或重试失败步骤；如果反复出现，请管理员切换模型或检查提示词/输出格式约束。",
      contactAdmin: true
    });
  }

  if (/network|fetch|ECONN|ENOTFOUND|ECONNRESET|EAI_AGAIN|连接|网络|接口|service unavailable|HTTP 5\d\d| 5\d\d/i.test(text)) {
    return result({
      errorType: "network_or_upstream_error",
      errorProvider: provider,
      recoverable: true,
      resumeStrategy: "retry_later_from_checkpoint",
      errorCause: "网络或上游服务临时异常，任务未能完成当前步骤。",
      nextAction: "请刷新状态后重试；如果连续失败，请联系管理员检查服务日志和上游接口状态。",
      contactAdmin: true
    });
  }

  if (/任务不存在|Job route exists but job is missing|job not found|report not found|报告不存在/i.test(text)) {
    return result({
      errorType: "job_or_report_missing",
      errorProvider: "",
      recoverable: false,
      resumeStrategy: "contact_admin",
      errorCause: "任务或报告记录缺失，系统无法继续恢复。",
      nextAction: "请联系管理员，并保留任务 ID、目标客户和失败时间方便排查。",
      contactAdmin: true
    });
  }

  return result({
    errorType: "unknown_error",
    errorProvider: provider,
    recoverable: false,
    resumeStrategy: "manual_review",
    errorCause: text ? "系统记录到失败信息，但无法自动归类具体原因。" : "系统未返回明确失败原因。",
    nextAction: "请先刷新状态；如果仍失败，请联系管理员，并保留任务 ID、目标客户和失败时间方便排查。",
    contactAdmin: true
  });
}

export function enrichJobErrorPatch(patch = {}) {
  if (String(patch.status || "") !== "error") return patch;
  if (patch.errorType && patch.errorCause && patch.nextAction) return patch;
  return {
    ...classifyJobError(patch),
    ...patch
  };
}
