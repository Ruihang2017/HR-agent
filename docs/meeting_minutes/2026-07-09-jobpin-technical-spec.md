# Jobpin 本地招聘助手技术文档

## 1. 产品定位

Jobpin 是一个本地运行的老板专用招聘助手。

系统只有一个角色：老板。没有 HR、Admin、多租户、复杂权限矩阵、云端后台。

核心目标：

- 管理某个岗位的招聘资料。
- 分析候选人简历与岗位 JD 的匹配度。
- 生成面试题、记录面试、辅助排序。
- 沉淀老板偏好、公司记忆、岗位经验。
- 生成邀请邮件、入职邮件、法律文件、onboarding 文档。
- 数据永久保存在本地电脑。

系统不和 Jobpin 外部平台强绑定。后续如需接入 Jobpin，可通过插件、导入导出或同步层实现。

## 2. 部署形态

产品以本地安装包形式运行。

推荐形态：

- 前端：Electron 桌面应用。
- 本地服务：内嵌 local server，例如 `localhost:xxxx`。
- 数据库：SQLite。
- 文件存储：本地文件夹。
- AI：本地模型优先，Hermes 魔改版本，随 exe 安装或首次安装时下载。
- 邮件：可选 Gmail MCP/API，用于读取简历邮件、发送邀请和 onboarding 邮件。

注意：Gmail 本身不是本地服务，但系统只把必要数据落到本地数据库和本地文件夹。

推荐 MVP 技术栈：

```txt
Electron
React / Vue
Node.js local server
SQLite
Local file storage
Local LLM runtime: Hermes modified build
Local STT for voice input
Template engine: Handlebars / Markdown -> PDF/DOCX
```

## 3. 本地目录结构

每个岗位一个文件夹，以岗位名称命名。

```txt
jobpin-data/
  company/
    company_memory.md
    values.md
    boss_preferences.json
    legal_templates/
    onboarding_templates/
  jobs/
    Sales Manager/
      jd.md
      inject.md
      references/
        interview_rules.md
        legal_notes.md
        company_context.md
      question_bank.json
      learned_skills.md
      candidates/
        candidate_001/
          profile.json
          resume.pdf
          resume_text.md
          ai_analysis.json
          interviews/
            2026-07-08-round-1.json
            2026-07-08-notes.md
          emails/
          documents/
```

岗位文件夹内包含：

- `jd.md`：岗位 JD。
- `inject.md`：岗位专用 AI 注入信息。
- `references/`：岗位参考资料、法律注意事项、老板偏好。
- `question_bank.json`：题库。
- `learned_skills.md`：从面试中沉淀出的岗位经验。
- `candidates/`：候选人资料。

## 4. 核心流程

### 4.1 创建岗位

老板输入或上传：

- 岗位名称。
- JD。
- 公司价值观。
- 岗位专用 inject。
- 法律文件模板。
- 面试偏好。

系统生成：

- 岗位文件夹。
- 初始题库。
- 评分维度。
- 候选人分析模板。
- 邮件模板。

### 4.2 候选人导入

候选人来源：

- 老板手动上传简历。
- Gmail MCP/API 自动抓取附件。
- 手动粘贴简历文本。

系统处理：

1. 保存原始简历。
2. 提取文本。
3. 结合 JD、公司价值观、岗位 inject 做分析。
4. 生成候选人初始评分。
5. 加入候选人列表并排序。

候选人分析维度：

- JD 匹配度。
- 必备技能。
- 加分技能。
- 履历连续性。
- 成长轨迹。
- 沟通风格。
- soft skills 证据。
- 风险点。
- 推荐面试问题。
- AI 推荐排序。

不建议把八字、星座、MBTI 作为排序依据。它们可以作为老板手动备注或娱乐性侧面标签，但系统应明确标记为“非决策依据”，避免影响录用排序。

### 4.3 AI 排序

排序应基于岗位相关因素。

```txt
总分 = JD匹配度 + 关键技能 + 相关经验 + 成长轨迹 + 面试表现 + 老板偏好匹配
```

每次排序必须保存快照。

```json
{
  "ranking_id": "rank_2026_07_08_001",
  "job": "Sales Manager",
  "created_at": "2026-07-08T10:00:00+10:00",
  "criteria": ["jd_fit", "experience", "interview_signal", "risk"],
  "result": [
    {
      "candidate_id": "candidate_001",
      "rank": 1,
      "score": 86,
      "reason": "Strong sales management experience and stable job history."
    }
  ]
}
```

保存排序快照的目的：

- 后续可以解释为什么当时这样排。
- 可以比较不同时间点的候选人变化。
- 可以追踪老板最终决定和 AI 建议之间的差异。

### 4.4 邀请面试

老板选择候选人后，系统生成邮件：

- 线上面试邀请。
- 线下面试邀请。
- 改期邮件。
- 拒绝邮件。
- 补材料邮件。

邮件由本地模板生成。MVP 阶段不自动发送关键邮件，必须老板确认后再发送。

### 4.5 第一阶段面试

面试入口：

- 手动输入记录。
- 语音输入，技术上是 STT。
- 可选 TTS 朗读问题。

面试前系统生成：

- 标准面试题。
- 针对候选人简历的问题。
- 针对 JD 风险点的问题。
- 老板喜欢的问题。
- 追问建议。

面试中记录：

- 问题。
- 回答。
- 老板手动备注。
- AI 分析。
- 置信度。
- 是否影响排序。

面试后系统输出：

- 面试总结。
- soft skill 观察。
- 稳定性推断。
- 风险点。
- 推荐追问。
- 是否进入下一轮。
- 重新排序结果。

重要原则：

- 老板手动输入不是 absolute gold truth，只是一个信号源。
- 语音转写和 AI 分析也不是最终事实。
- 每条结论都需要记录来源和置信度。

## 5. 持久记忆设计

记忆分三类，互相隔离。

### 5.1 公司记忆

文件：

```txt
company/company_memory.md
```

保存内容：

- 公司价值观。
- 老板长期偏好。
- 已录用员工画像。
- 不适合公司的风险模式。
- 面试经验。
- 法律注意事项。

### 5.2 岗位记忆

文件：

```txt
jobs/{job_name}/learned_skills.md
```

保存内容：

- 该岗位有效面试题。
- 老板喜欢的问题。
- 常见候选人风险。
- 岗位专属判断标准。
- 历史录用结果反推经验。

### 5.3 候选人记忆

文件：

```txt
jobs/{job_name}/candidates/{candidate_id}/profile.json
```

保存内容：

- 简历。
- AI 分析。
- 面试记录。
- 邮件记录。
- 排序历史。
- 最终决定。

## 6. Skills 沉淀机制

系统每次面试后可以更新岗位经验，但不能直接覆盖。

推荐流程：

1. AI 提出 skill 更新建议。
2. 老板确认。
3. 写入 `learned_skills.md`。
4. 下次生成题库时引用。

示例：

```md
## Sales Manager 面试经验

- 老板偏好候选人能讲清楚过去如何拆销售目标。
- 对只讲结果、不讲过程的人降低稳定性评分。
- 必问：过去一年 pipeline 是怎么搭的？
- 必问：如何处理连续两个月业绩不达标？
```

## 7. 数据库模型 MVP

核心表：

```txt
jobs
candidates
candidate_documents
interviews
interview_questions
interview_answers
ai_analyses
rankings
ranking_items
emails
memory_events
documents
settings
```

关键字段：

```sql
jobs:
  id
  name
  folder_path
  jd_path
  inject_path
  created_at
  updated_at

candidates:
  id
  job_id
  name
  email
  phone
  status
  current_rank
  created_at
  updated_at

candidate_documents:
  id
  candidate_id
  type
  file_path
  extracted_text_path
  created_at

interviews:
  id
  candidate_id
  stage
  mode
  scheduled_at
  transcript_path
  summary_path
  ai_score
  boss_decision
  created_at

rankings:
  id
  job_id
  reason
  created_at

ranking_items:
  id
  ranking_id
  candidate_id
  rank
  score
  reason

memory_events:
  id
  scope
  scope_id
  source_type
  source_id
  content
  approved_by_boss
  created_at
```

SQLite 足够 MVP 使用。

## 8. 法律风险降低设计

这部分不是法律意见。正式用于真实招聘前，应让当地律师确认。

工程上建议这样做：

- AI 不做最终录用决定，只做辅助建议。
- 排序必须可解释，依据必须和岗位相关。
- 不使用年龄、性别、种族、宗教、婚育、残障、国籍等敏感信息做排序。
- 不把星座、八字、MBTI 作为录用依据。
- 面试问题库要避免违法或高风险问题。
- 所有 AI 分析保留版本、时间、输入材料和理由。
- 老板最终决定必须单独记录。
- 候选人数据本地加密保存。
- 支持删除候选人数据。
- 邮件发送前必须人工确认。
- 法律文件模板必须标记版本和适用地区。
- offer、contract、onboarding 文件生成后必须人工审核。

系统提示词中应加入硬性约束：

```txt
你是招聘辅助系统，不是最终决策者。
你只能基于岗位相关证据进行分析。
不得使用受保护属性或与岗位无关的个人特征进行排序。
如果发现输入中包含敏感信息，只能标记为“不得用于决策”。
所有结论必须给出证据来源和置信度。
```

## 9. MVP 范围

第一版只做：

- 本地 Electron 应用。
- 单老板角色。
- 创建岗位文件夹。
- 上传 JD。
- 上传简历。
- AI 候选人分析。
- 候选人排序。
- 生成面试题。
- 手动输入面试记录。
- 面试后重新排序。
- 生成邀请邮件模板。
- 生成 onboarding 邮件模板。
- SQLite 持久化。
- 本地文件永久保存。

第一版暂时不做：

- 多用户权限。
- 云同步。
- 企业后台。
- ATS 集成。
- 自动发 offer。
- 自动拒绝候选人。
- 自动法律判断。
- 视频面试分析。
- 大规模招聘管道。
- 和 Jobpin 强绑定。

## 10. 推荐产品原则

这个系统应该像“老板的本地招聘工作台”，不是 SaaS HR 平台。

关键边界：

- 老板决定，AI 排序。
- 本地保存，不上云。
- 岗位为中心，不是组织架构为中心。
- 记忆独立，可追溯。
- 法律文件可生成，但必须人工审核。
- AI 可以学习老板偏好，但不能学习歧视性偏好。
- 所有候选人结论必须有证据来源。

## 11. 后续拆分任务

建议按以下顺序开发：

1. 初始化 Electron 桌面壳。
2. 建立 local server。
3. 建立 SQLite schema。
4. 实现岗位创建和本地文件夹生成。
5. 实现 JD 上传和存储。
6. 实现简历上传和文本提取。
7. 接入本地 LLM 分析候选人。
8. 实现候选人列表和排序快照。
9. 实现面试题生成。
10. 实现面试记录。
11. 实现岗位 memory 更新建议。
12. 实现邮件模板生成。
13. 实现 onboarding 文档生成。
14. 加入数据加密和备份。

