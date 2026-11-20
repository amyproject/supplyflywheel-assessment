/**
 * Seed content for the default assessment template (PRD §5–§6).
 * Pure data: shared by server, seed script and tests. Attempts snapshot this at start,
 * so editing it later never changes how an old attempt reads.
 */

export type CategoryCode = "A" | "B" | "C" | "D" | "E";

export interface Category {
  code: CategoryCode;
  name_zh: string;
  name_en: string;
  /** Percentage weight; all categories sum to 100. */
  weight: number;
}

export interface Question {
  code: string;
  category: CategoryCode;
  order: number;
  prompt_zh: string;
  prompt_en: string;
  rubric_zh: string;
  rubric_en: string;
  soft_limit_seconds: number;
  hard_limit_seconds: number | null;
}

export const CATEGORIES: Category[] = [
  { code: "A", name_zh: "供应商开发与技术理解", name_en: "Supplier development & technical depth", weight: 30 },
  { code: "B", name_zh: "采购谈判与成本优化", name_en: "Negotiation & cost optimization", weight: 20 },
  { code: "C", name_zh: "制造与规模化", name_en: "Manufacturing & scale-up", weight: 20 },
  { code: "D", name_zh: "质量与跨境风险", name_en: "Quality & cross-border risk", weight: 20 },
  { code: "E", name_zh: "管理能力与真实经验", name_en: "Leadership & real experience", weight: 10 },
];

export const SCENARIO = {
  title_zh: "案例：美国机器人初创企业的中国供应链搭建",
  title_en: "Case: building a China supply chain for a US robotics startup",
  body_zh:
    "一家位于旧金山的机器人初创公司正在研发六轴机械臂，已经完成初步原型设计，希望通过中国供应链降低成本并加快交付。",
  body_en:
    "A San Francisco robotics startup is developing a six-axis robotic arm. The first prototype is designed, and the team wants a China supply chain to cut cost and speed up delivery.",
  facts_zh: [
    "首批订单：100台",
    "未来目标：1,000台/年",
    "首批交付目标：90天",
    "采购范围：核心零部件 + 组装",
    "客户已有初步BOM，但缺乏中国供应商资源，不清楚哪些部件适合直接采购、定制生产或联合开发。",
  ],
  facts_en: [
    "First order: 100 units",
    "Target: 1,000 units per year",
    "First delivery target: 90 days",
    "Scope: core components + assembly",
    "The client has a preliminary BOM but no China supplier network, and doesn't know which parts to buy off the shelf, have custom-made, or co-develop.",
  ],
  note_zh: "所有数字均为虚构的案例假设。",
  note_en: "All numbers are fictional case assumptions.",
};

const q = (
  code: string,
  order: number,
  prompt_zh: string,
  prompt_en: string,
  rubric_zh: string,
  rubric_en: string,
): Question => ({
  code,
  category: code[0] as CategoryCode,
  order,
  prompt_zh,
  prompt_en,
  rubric_zh,
  rubric_en,
  soft_limit_seconds: 90,
  hard_limit_seconds: null,
});

export const QUESTIONS: Question[] = [
  q("A1", 1, "你接到这个项目后，前两周会如何开展供应商开发？", "When you take on this project, how would you run supplier development in the first two weeks?", "需求澄清、BOM分析、长名单、筛选、RFQ计划", "Requirement clarification, BOM analysis, long list, screening, RFQ plan"),
  q("A2", 2, "客户需要谐波减速器、伺服电机、编码器和关节模组，你会去哪里找供应商？", "The client needs harmonic reducers, servo motors, encoders and joint modules. Where would you look for suppliers?", "产业集群、供应商分类、可验证的筛选渠道", "Industrial clusters, supplier tiers, verifiable screening channels"),
  q("A3", 3, "客户提供的BOM不完整，你会向美国工程团队确认哪些信息？", "The client's BOM is incomplete. What would you confirm with the US engineering team?", "扭矩、精度、负载、尺寸、接口、寿命、可靠性", "Torque, precision, payload, dimensions, interfaces, lifetime, reliability"),
  q("A4", 4, "如果中国供应商推荐便宜40%的替代电机，你如何判断能否采用？", "A Chinese supplier recommends an alternative motor that is 40% cheaper. How do you decide whether to adopt it?", "性能、兼容性、测试、认证、工程变更控制", "Performance, compatibility, testing, certification, engineering change control"),
  q("B1", 5, "客户只需要100套零部件，但供应商MOQ为1,000套，你会如何谈判？", "The client needs only 100 sets, but the supplier's MOQ is 1,000. How would you negotiate?", "样品费、分批交付、阶梯报价、替代供应商", "Sample fees, split deliveries, tiered pricing, alternative suppliers"),
  q("B2", 6, "三家供应商分别报价低、交期短和质量好，你如何选择？", "Three suppliers offer, respectively, the lowest price, the shortest lead time and the best quality. How do you choose?", "总拥有成本、风险、技术符合性、决策矩阵", "Total cost of ownership, risk, technical fit, decision matrix"),
  q("B3", 7, "如果客户希望降低BOM成本20%，你会如何推进？", "The client wants to cut BOM cost by 20%. How would you drive it?", "成本拆解、替代料、设计优化、采购杠杆", "Cost breakdown, alternative materials, design optimization, purchasing leverage"),
  q("B4", 8, "供应商要求预付70%，而美国客户只接受30%，你如何协调？", "The supplier wants 70% prepayment; the US client accepts only 30%. How do you reconcile them?", "付款节点、验收、信用与合同风险", "Payment milestones, acceptance criteria, credit and contract risk"),
  q("C1", 9, "这个项目应该采用OEM/CM、ODM还是JDM？为什么？", "Should this project use OEM/CM, ODM or JDM? Why?", "设计归属、联合开发、知识产权与代工模式", "Design ownership, joint development, IP and manufacturing model"),
  q("C2", 10, "从100台试产扩大到1,000台，你会如何制定量产计划？", "How would you plan the ramp from a 100-unit pilot to 1,000 units?", "NPI、DFM、工装、产能、良率、爬坡", "NPI, DFM, tooling, capacity, yield, ramp"),
  q("C3", 11, "如果供应商样品合格，但量产不良率达到8%，你如何处理？", "Samples passed, but the mass-production defect rate is 8%. What do you do?", "遏制、根因分析、CAPA、验证与追踪", "Containment, root-cause analysis, CAPA, verification and tracking"),
  q("C4", 12, "客户要求90天交付，但关键零件需要120天，你如何解决？", "The client needs delivery in 90 days, but a critical part takes 120. How do you solve it?", "关键路径、替代料、并行工作、风险沟通", "Critical path, alternative parts, parallel work, risk communication"),
  q("D1", 13, "你会如何判断一家机器人零部件工厂是否真正具备制造能力？", "How would you judge whether a robotics component factory truly has the manufacturing capability it claims?", "工艺、设备、检测、案例、质量体系核验", "Process, equipment, inspection, references, quality-system verification"),
  q("D2", 14, "如果供应商拒绝工厂审核，你会怎么处理？", "What would you do if a supplier refuses a factory audit?", "风险升级、第三方审核、替代方案", "Risk escalation, third-party audit, alternatives"),
  q("D3", 15, "如果产品涉及美国出口管制、制裁或额外进口关税，你会怎么处理？", "How would you handle US export controls, sanctions or additional import tariffs on the product?", "分类、原产地、交易方筛查、专业合规支持", "Classification, country of origin, party screening, professional compliance support"),
  q("D4", 16, "客户担心中国供应商复制其设计，你如何保护知识产权？", "The client worries a Chinese supplier will copy its design. How do you protect the IP?", "NDA、图纸权限、模具归属、合同与访问控制", "NDA, drawing access, tooling ownership, contracts and access control"),
  q("E1", 17, "请介绍一个你从零开发供应商并完成交付的真实案例。", "Describe a real case where you developed a supplier from scratch through to delivery.", "可核实的规模、周期、成果、个人贡献", "Verifiable scale, timeline, outcome, personal contribution"),
  q("E2", 18, "你目前能直接联系哪些机器人零部件制造商？", "Which robotics component manufacturers can you contact directly today?", "真实网络；不得要求披露前雇主保密信息", "A real network; never ask for a former employer's confidential information"),
  q("E3", 19, "如果同时有五家美国机器人客户，你如何管理优先级？", "With five US robotics clients at once, how would you manage priorities?", "项目管理、风险分级、资源协调、沟通", "Project management, risk tiering, resource coordination, communication"),
];

export const SCORE_LABELS = {
  zh: { 1: "薄弱/空泛", 2: "有限", 3: "合格", 4: "扎实/可执行", 5: "卓越/有证据" },
  en: { 1: "Weak / vague", 2: "Limited", 3: "Adequate", 4: "Strong / actionable", 5: "Exceptional / evidence-based" },
} as const;
