export const env: CloudflareBindings = {
  APP_URL: "http://localhost:5173",
  SERVER: {
    fetch() {
      throw new Error("SERVER.fetch must be mocked by tests that exercise SSR transport");
    },
  } as unknown as CloudflareBindings["SERVER"],
};
