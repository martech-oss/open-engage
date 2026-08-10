export const workspaceErrors = {
  UNAUTHORIZED: {
    status: 401,
    message: "ログインが必要です",
  },
  INVALID_API_KEY: {
    status: 401,
    message: "APIキーが無効です",
  },
  WORKSPACE_REQUIRED: {
    status: 403,
    message: "利用可能なワークスペースがありません",
  },
  ORIGIN_MISMATCH: {
    status: 403,
    message: "許可されていないOriginです",
  },
} as const;

export const forbiddenError = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;

export const authedErrors = { ...workspaceErrors, ...forbiddenError } as const;

export const briefContextErrors = {
  BRIEF_NOT_FOUND: { status: 404, message: "施策ブリーフが見つかりません" },
  BRIEF_NOT_APPROVED: { status: 409, message: "承認済みの施策ブリーフが必要です" },
  BRIEF_REVISION_CONFLICT: { status: 409, message: "施策ブリーフのrevisionが一致しません" },
} as const;

export const projectBriefNotFoundError = {
  PROJECT_BRIEF_NOT_FOUND: { status: 404, message: "施策ブリーフが見つかりません" },
} as const;

export const projectBriefStateErrors = {
  INVALID_BRIEF_STATE: { status: 409, message: "現在の状態ではこの操作を実行できません" },
  BRIEF_WRITE_CONFLICT: {
    status: 409,
    message: "施策ブリーフが更新されています。最新の内容を再読み込みしてください",
  },
} as const;

export const projectBriefMemberError = {
  INVALID_BRIEF_MEMBER: { status: 422, message: "担当者または承認者が無効です" },
} as const;
