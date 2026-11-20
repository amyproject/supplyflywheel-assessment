import { tr, type Lang } from "@/lib/i18n";

export function statusLabel(lang: Lang, s: string) {
  const t = tr(lang);
  const map: Record<string, [string, string]> = {
    invited: [t("已邀请", "Invited"), ""],
    in_progress: [t("进行中", "In progress"), "tag-signal"],
    reopened: [t("已重新开放", "Reopened"), "tag-signal"],
    submitted: [t("已提交", "Submitted"), "tag-good"],
    expired: [t("已超时", "Expired"), "tag-watch"],
    archived: [t("已归档", "Archived"), ""],
  };
  return map[s] ?? [s, ""];
}

export function bandLabel(lang: Lang, b: string | null) {
  const t = tr(lang);
  if (!b) return null;
  const map: Record<string, [string, string]> = {
    finalist: [t("强力入围", "Strong finalist"), "tag-good"],
    interview: [t("进一步面试", "Further interview"), "tag-signal"],
    conditional: [t("专项/有条件", "Specialist / conditional"), "tag-watch"],
    not_recommended: [t("不建议担任负责人", "Not recommended for lead"), "tag-risk"],
  };
  return map[b] ?? null;
}

export const EVENT_LABELS: Record<string, [string, string]> = {
  started: ["开始测评", "Started"],
  consent_recording: ["同意录音", "Recording consent"],
  question_open: ["打开题目", "Opened question"],
  question_leave: ["离开题目", "Left question"],
  visibility_hidden: ["切换离开页面", "Left the tab"],
  visibility_visible: ["回到页面", "Returned to tab"],
  copy_blocked: ["尝试复制题目", "Copy attempt"],
  cut_blocked: ["尝试剪切", "Cut attempt"],
  contextmenu_blocked: ["右键菜单", "Context menu"],
  paste_blocked: ["尝试粘贴", "Paste attempt"],
  drop_blocked: ["尝试拖入文本", "Drop attempt"],
  recording_started: ["开始录音", "Recording started"],
  recording_stopped: ["停止录音", "Recording stopped"],
  recording_uploaded: ["录音已上传", "Recording uploaded"],
  recording_deleted: ["删除录音", "Recording deleted"],
  recording_error: ["录音中断", "Recording interrupted"],
  mic_denied: ["麦克风被拒绝", "Mic denied"],
  mic_unsupported: ["浏览器不支持录音", "Recording unsupported"],
  transcribed: ["完成转写", "Transcribed"],
  offline: ["网络断开", "Went offline"],
  online: ["网络恢复", "Back online"],
  accommodation_requested: ["申请便利安排", "Accommodation requested"],
  paste_accommodation_granted: ["开启粘贴", "Paste allowed"],
  paste_accommodation_revoked: ["关闭粘贴", "Paste revoked"],
  expired: ["到达时间上限", "Time cap reached"],
  extended: ["延长时间", "Extended"],
  reopened: ["重新开放", "Reopened"],
  submitted: ["提交", "Submitted"],
};
