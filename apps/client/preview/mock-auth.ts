const unavailable = async () => ({
  error: { message: "表示確認用プレビューでは認証設定を変更できません。" },
});
export const authClient = {
  signOut: unavailable,
  organization: { setActive: unavailable },
  twoFactor: { enable: unavailable, verifyTotp: unavailable },
};
