/**
 * 注册退回码 → 给用户看的话 + 该把哪一栏描红。
 * 服务端（redirect `/register?e=xxx`）与注册表单共用这一份，免得两边对不上。
 * field 缺省表示"没有具体到某一栏"，只在顶部提示。
 */
export interface RegisterErrorInfo {
  message: string;
  field?: "username" | "password" | "email" | "captcha_answer" | "invite";
}

export const REGISTER_ERRORS: Record<string, RegisterErrorInfo> = {
  user: {
    message: "用户名须为 2–20 位字母、数字、下划线或汉字。",
    field: "username",
  },
  pass: { message: "密码至少 6 位。", field: "password" },
  passspace: {
    message: "密码首尾不能有空格，请去掉首尾空格后再试。",
    field: "password",
  },
  taken: {
    message: "该雅号已被他人先行注册（含学者的曾用名，依规矩不可重领）。可换用下方建议的名字。",
    field: "username",
  },
  invite: {
    message: "管理者的邀请函无效、已用或已作废。",
    field: "invite",
  },
  regrate: {
    message: "注册过于频繁，已触发防刷限制。请稍候十分钟再试，或联系管理者。",
  },
  captcha: {
    message: "验证码答错了，请重新算出式子的得数。",
    field: "captcha_answer",
  },
  email: {
    message: "邮箱格式不正确，请检查（例如 you@example.com）。",
    field: "email",
  },
};
